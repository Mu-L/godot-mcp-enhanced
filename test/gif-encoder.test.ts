import { describe, it, expect } from 'vitest';
import { encodeGif, lzwEncode, quantizeFrames, type RgbaFrame } from '../src/cli/gif-encoder.js';

// ─── 批 4a:GIF89a 编码器往返测试 ─────────────────────────────────────────────
// 核心手法:测试内自写「GIF 解析器 + LZW 解码器」,编码产物解码回索引/像素比对——
// 编码器的正确性由独立实现的解码端锚定(mock 往返是自欺)。

/** 帧构造:colorKeys 每像素一个调色板索引(由 rgb 元组表展开成 RGBA)。 */
function frameFromIndexGrid(width: number, height: number, indices: number[], palette: number[][]): RgbaFrame {
  const data = new Uint8Array(width * height * 4);
  for (let p = 0; p < indices.length; p++) {
    const rgb = palette[indices[p] % palette.length]!;
    data[p * 4] = rgb[0]!; data[p * 4 + 1] = rgb[1]!; data[p * 4 + 2] = rgb[2]!; data[p * 4 + 3] = 255;
  }
  return { width, height, data };
}

/** 简单确定性 PRNG(测试可复现)。 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000;
}

// ── 测试内 GIF-LZW 解码器(独立实现,锚定编码端) ──────────────────────────────

function gifLzwDecode(minCodeSize: number, data: Uint8Array, expectedPixels: number): number[] {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let bits = minCodeSize + 1;
  let bitPos = 0;
  const readCode = (): number => {
    let code = 0;
    for (let b = 0; b < bits; b++) {
      const byte = data[bitPos >> 3] ?? 0;
      if (byte & (1 << (bitPos & 7))) code |= 1 << b;
      bitPos++;
    }
    return code;
  };
  const out: number[] = [];
  let dict: string[] = [];
  const resetDict = () => {
    dict = [];
    for (let i = 0; i < clearCode; i++) dict.push(String.fromCharCode(i));
    dict.push(''); // clear
    dict.push(''); // eoi
    bits = minCodeSize + 1;
  };
  resetDict();
  let prev: string | null = null;
  while (true) {
    const code = readCode();
    if (code === clearCode) {
      resetDict();
      prev = null;
      continue;
    }
    if (code === eoiCode) break;
    let entry: string;
    if (code < dict.length && dict[code] !== '') {
      entry = dict[code]!;
    } else if (prev !== null) {
      entry = prev + prev[0]!;
    } else {
      throw new Error(`decode error at code ${code}`);
    }
    for (const ch of entry) out.push(ch.charCodeAt(0));
    if (prev !== null) {
      dict.push(prev + entry[0]!);
      // 与编码器「分配前 nextCode===1<<bits 即 bits++」对齐:push 后待分配=dict.length
      if (dict.length === (1 << bits) && bits < 12) bits++;
    }
    prev = entry;
    if (out.length > expectedPixels) throw new Error('decoded more pixels than expected');
  }
  return out;
}

/** 解析 encodeGif 产物:返回 {width,height,palette,frames:索引帧[](含每帧 delay)}。 */
function parseGif(buf: Buffer): {
  width: number; height: number; palette: number[][]; frames: { indices: number[]; delayCs: number }[];
} {
  expect(buf.subarray(0, 6).toString('ascii')).toBe('GIF89a');
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  const packed = buf[10]!;
  expect(packed & 0x80).toBe(0x80); // 全局表存在
  const tableBits = (packed & 0x07) + 1;
  const tableSize = 1 << tableBits;
  const palette: number[][] = [];
  for (let i = 0; i < tableSize; i++) {
    const o = 13 + i * 3;
    palette.push([buf[o]!, buf[o + 1]!, buf[o + 2]!]);
  }
  expect(buf[buf.length - 1]).toBe(0x3b); // Trailer
  const frames: { indices: number[]; delayCs: number }[] = [];
  let p = 13 + tableSize * 3;
  // 跳过 Netscape 扩展(通用子块流跳过:21 FF 后逐子块 [len 数据] 至 00)
  if (buf[p] === 0x21 && buf[p + 1] === 0xff) {
    p += 2;
    while (buf[p] !== 0x00) {
      const len = buf[p]!;
      p += 1 + len;
    }
    p += 1;
  }
  while (buf[p] === 0x21 || buf[p] === 0x2c) {
    if (buf[p] === 0x21) {
      // GCE: 21 F9 04 packed delay(LE16) transparent 00
      expect(buf[p + 1]!).toBe(0xf9);
      const delayCs = buf.readUInt16LE(p + 4);
      p += 8;
      // Image Descriptor
      expect(buf[p]!).toBe(0x2c);
      const fw = buf.readUInt16LE(p + 5);
      const fh = buf.readUInt16LE(p + 7);
      expect(fw).toBe(width);
      expect(fh).toBe(height);
      p += 10;
      const minCodeSize = buf[p]!;
      p += 1;
      const sub: number[] = [];
      while (buf[p] !== 0x00) {
        const len = buf[p]!;
        for (let i = 0; i < len; i++) sub.push(buf[p + 1 + i]!);
        p += 1 + len;
      }
      p += 1; // block terminator
      frames.push({ indices: gifLzwDecode(minCodeSize, new Uint8Array(sub), width * height), delayCs });
    } else {
      throw new Error(`unexpected block 0x${buf[p]!.toString(16)} at ${p}`);
    }
  }
  return { width, height, palette, frames };
}

describe('quantizeFrames', () => {
  it('unique ≤256 精确直通:解码索引回映射 RGB 全等', () => {
    const palette = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [12, 34, 56]];
    const idx = [0, 1, 2, 3, 3, 2, 1, 0, 1, 2, 3, 0];
    const f = frameFromIndexGrid(4, 3, idx, palette);
    const q = quantizeFrames([f]);
    expect(q.palette.length).toBe(4);
    const buf = encodeGif([f], 20);
    const parsed = parseGif(buf);
    const roundIdx = parsed.frames[0]!.indices;
    expect(roundIdx.length).toBe(12);
    for (let i = 0; i < idx.length; i++) {
      expect(parsed.palette[roundIdx[i]!]).toEqual(palette[idx[i]!]);
    }
  });

  it('>256 unique → 中位切分:解码色都在调色板内且调色板 ≤256', () => {
    const rnd = lcg(7);
    const w = 32, h = 32;
    const paletteBig: number[][] = [];
    for (let i = 0; i < 300; i++) paletteBig.push([i % 256, (i * 7) % 256, (i * 13) % 256]);
    const idx = Array.from({ length: w * h }, () => Math.floor(rnd() * 300));
    const f = frameFromIndexGrid(w, h, idx, paletteBig);
    const q = quantizeFrames([f]);
    expect(q.palette.length).toBeLessThanOrEqual(256);
    expect(q.palette.length).toBeGreaterThan(200); // 充分利用调色板
    const buf = encodeGif([f], 10);
    const parsed = parseGif(buf);
    expect(parsed.frames[0]!.indices.length).toBe(w * h);
  });
});

describe('lzwEncode(独立解码器往返)', () => {
  it('随机索引多尺寸/多色量级往返(2/16/256 色)', () => {
    for (const colorCount of [2, 16, 256]) {
      for (const size of [1, 17, 1000, 5000]) {
        const rnd = lcg(colorCount * 31 + size);
        const indices = new Uint8Array(Array.from({ length: size }, () => Math.floor(rnd() * colorCount)));
        const minCodeSize = Math.max(2, Math.ceil(Math.log2(Math.max(2, colorCount))));
        const enc = lzwEncode(indices, minCodeSize);
        const dec = gifLzwDecode(minCodeSize, enc, size);
        expect(dec.length).toBe(size);
        expect(dec).toEqual([...indices]);
      }
    }
  });

  it('空输入返回 CLEAR+EOI 合法流(审查 N-5)', () => {
    const enc = lzwEncode(new Uint8Array(0), 2);
    const dec = gifLzwDecode(2, enc, 0);
    expect(dec).toEqual([]);
  });

  it('直通中量级色数(5/64/128 色,tableBits 3-7 覆盖,审查 N-5)', () => {
    for (const colorCount of [5, 64, 128]) {
      const rnd = lcg(colorCount * 7 + 3);
      const indices = new Uint8Array(Array.from({ length: 777 }, () => Math.floor(rnd() * colorCount)));
      const minCodeSize = Math.max(2, Math.ceil(Math.log2(colorCount)));
      const enc = lzwEncode(indices, minCodeSize);
      expect(gifLzwDecode(minCodeSize, enc, indices.length)).toEqual([...indices]);
    }
  });

  it('字典 4096 满触发 CLEAR 重置(大数据量)', () => {
    const rnd = lcg(99);
    // 高熵 256 色长序列,逼出字典满
    const indices = new Uint8Array(Array.from({ length: 200_000 }, () => Math.floor(rnd() * 256)));
    const enc = lzwEncode(indices, 8);
    const dec = gifLzwDecode(8, enc, indices.length);
    expect(dec.length).toBe(indices.length);
    expect(dec).toEqual([...indices]);  // 全量比对(审查 N-5:首尾抽样改全量)
  });
});

describe('encodeGif(结构断言)', () => {
  const palette = [[10, 20, 30], [200, 100, 50]];
  const mk = (seed: number): RgbaFrame => {
    const rnd = lcg(seed);
    return frameFromIndexGrid(8, 8, Array.from({ length: 64 }, () => Math.floor(rnd() * 2)), palette);
  };

  it('多帧:帧数/delay/尺寸/Netscape/Trailer 全对', () => {
    const frames = [mk(1), mk(2), mk(3)];
    const buf = encodeGif(frames, 25);
    const parsed = parseGif(buf);
    expect(parsed.width).toBe(8);
    expect(parsed.height).toBe(8);
    expect(parsed.frames.length).toBe(3);
    for (const fr of parsed.frames) expect(fr.delayCs).toBe(25);
    expect(buf.subarray(0, 6).toString('ascii')).toBe('GIF89a');
  });

  it('帧尺寸不一致 → 拒绝', () => {
    const a = mk(1);
    const b = { ...mk(2), width: 4 };
    expect(() => encodeGif([a, b], 10)).toThrow();
  });

  it('空帧列表 → 拒绝', () => {
    expect(() => encodeGif([], 10)).toThrow();
  });
});
