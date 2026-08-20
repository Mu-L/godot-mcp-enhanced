/**
 * 批 4a:零依赖 GIF89a 编码器(spec B-1 处置:demo GIF 帧来源=bridge 截图,编码全自写)。
 *
 * 量化:合并全部帧采样——unique RGBA ≤256 → 精确直通调色板(零量化误差,色块游戏
 * 常态命中);>256 → 中位切分(median cut)256 色。全局调色板 + 全帧复用。
 * 压缩:GIF 变体 LZW(minCodeSize ≥2,可变码长 9-12,字典 4096 满发 CLEAR 重置),
 * 输出 LSB-first 位打包 + 255 字节子块。
 */
import { InternalError } from '../core/tool-errors.js';

export interface RgbaFrame {
  width: number;
  height: number;
  /** RGBA,长度 = width*height*4 */
  data: Uint8Array;
}

interface Quantized {
  palette: number[][];        // [[r,g,b],...] 长度 ≤256
  indicesPerFrame: Uint8Array[];
}

/** unique 色(取 RGB;截图 alpha 恒 255)收集。 */
function collectUniqueColors(frames: RgbaFrame[]): Map<number, number> {
  const unique = new Map<number, number>(); // rgbKey → count
  for (const f of frames) {
    for (let i = 0; i < f.data.length; i += 4) {
      const key = (f.data[i]! << 16) | (f.data[i + 1]! << 8) | f.data[i + 2]!;
      unique.set(key, (unique.get(key) ?? 0) + 1);
    }
  }
  return unique;
}

/** 中位切分:最大盒子按最长轴排序取中位二分,至 maxColors 盒,各盒取像素平均色。 */
function medianCut(entries: [number, number][], maxColors: number): number[][] {
  type Box = { pixels: [number, number][]; range: [number, number, number] }; // 每通道 min/max
  const makeBox = (pixels: [number, number][]): Box => {
    const range: [number, number, number] = [255, 255, 255];
    const min: [number, number, number] = [255, 255, 255];
    const max: [number, number, number] = [0, 0, 0];
    for (const [key] of pixels) {
      const rgb = [key >> 16 & 255, key >> 8 & 255, key & 255];
      for (let ch = 0; ch < 3; ch++) {
        if (rgb[ch]! < min[ch]!) min[ch] = rgb[ch]!;
        if (rgb[ch]! > max[ch]!) max[ch] = rgb[ch]!;
      }
    }
    for (let ch = 0; ch < 3; ch++) range[ch] = max[ch]! - min[ch]!;
    return { pixels, range };
  };
  let boxes: Box[] = [makeBox(entries)];
  while (boxes.length < maxColors) {
    // 取可分(像素>1)中体积最大盒
    let target = -1;
    let best = -1;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i]!;
      const vol = Math.max(b.range[0]!, b.range[1]!, b.range[2]!);
      if (b.pixels.length > 1 && vol > best) { best = vol; target = i; }
    }
    if (target < 0 || best === 0) break;
    const box = boxes[target]!;
    const axis = box.range.indexOf(best);
    box.pixels.sort((a, b) => ((a[0] >> (16 - 8 * axis)) & 255) - ((b[0] >> (16 - 8 * axis)) & 255));
    const mid = Math.floor(box.pixels.length / 2);
    boxes = boxes.filter((_, i) => i !== target).concat(makeBox(box.pixels.slice(0, mid)), makeBox(box.pixels.slice(mid)));
  }
  return boxes.map((b) => {
    let r = 0, g = 0, bl = 0, total = 0;
    for (const [key, count] of b.pixels) {
      r += (key >> 16 & 255) * count; g += (key >> 8 & 255) * count; bl += (key & 255) * count; total += count;
    }
    return [Math.round(r / total), Math.round(g / total), Math.round(bl / total)];
  });
}

/** 最近色索引(unique key → palette 索引缓存)。 */
function nearestIndex(palette: number[][], cache: Map<number, number>, key: number): number {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const r0 = key >> 16 & 255, g0 = key >> 8 & 255, b0 = key & 255;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const dr = palette[i]![0]! - r0, dg = palette[i]![1]! - g0, db = palette[i]![2]! - b0;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) { bestD = d; best = i; }
  }
  cache.set(key, best);
  return best;
}

export function quantizeFrames(frames: RgbaFrame[], maxColors = 256): Quantized {
  if (frames.length === 0) throw new InternalError('quantizeFrames: no frames');
  const unique = collectUniqueColors(frames);
  const entries = [...unique.entries()];
  let palette: number[][];
  const indexCache = new Map<number, number>();
  if (entries.length <= maxColors) {
    // 精确直通:零量化误差
    palette = entries.map(([key]) => [key >> 16 & 255, key >> 8 & 255, key & 255]);
    entries.forEach(([key], i) => indexCache.set(key, i));
  } else {
    palette = medianCut(entries, maxColors);
  }
  const indicesPerFrame = frames.map((f) => {
    const out = new Uint8Array(f.width * f.height);
    for (let p = 0, i = 0; p < out.length; p++, i += 4) {
      const key = (f.data[i]! << 16) | (f.data[i + 1]! << 8) | f.data[i + 2]!;
      out[p] = nearestIndex(palette, indexCache, key);
    }
    return out;
  });
  return { palette, indicesPerFrame };
}

/** GIF 变体 LZW 编码(minCodeSize ≥2;4096 字典满发 CLEAR 重置)。 */
export function lzwEncode(indices: Uint8Array, minCodeSizeInput: number): Uint8Array {
  const minCodeSize = Math.max(2, minCodeSizeInput);
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const out: number[] = [];
  let cur = 0;
  let curBits = 0;
  const emit = (code: number, bits: number) => {
    cur |= code << curBits;
    curBits += bits;
    while (curBits >= 8) {
      out.push(cur & 255);
      cur >>= 8;
      curBits -= 8;
    }
  };

  let dict = new Map<string, number>();
  let nextCode = eoiCode + 1;
  let bits = minCodeSize + 1;
  const resetDict = () => {
    dict = new Map();
    nextCode = eoiCode + 1;
    bits = minCodeSize + 1;
  };

  emit(clearCode, bits);
  if (indices.length === 0) {
    emit(eoiCode, bits);
    if (curBits > 0) out.push(cur & 255);
    return new Uint8Array(out);
  }

  let prefix = String(indices[0]!);
  for (let i = 1; i < indices.length; i++) {
    const c = indices[i]!;
    const combined = prefix + ',' + c;
    if (dict.has(combined)) {
      prefix = combined;
      continue;
    }
    // emit prefix 的码(单字符码即索引值;多字符查字典)
    emit(prefix.includes(',') ? dict.get(prefix)! : Number(prefix), bits);
    // 位宽增长:分配前检查(omggif 同款)——下一个待分配码达当前位宽上限即增长,
    // 与解码器「push 后 dict.length==1<<bits 时 bits++」精确对齐(早/晚一位都错位)
    if (nextCode === (1 << bits) && bits < 12) bits++;
    dict.set(combined, nextCode);
    nextCode++;
    if (nextCode === 4096) {
      emit(clearCode, bits);
      resetDict();
    }
    prefix = String(c);
  }
  emit(prefix.includes(',') ? dict.get(prefix)! : Number(prefix), bits);
  emit(eoiCode, bits);
  if (curBits > 0) out.push(cur & 255);
  return new Uint8Array(out);
}

/** GIF89a 组装:Netscape 无限循环 + 每帧 GCE 延时(centisecond)。 */
export function encodeGif(frames: RgbaFrame[], delayCs: number): Buffer {
  const { palette, indicesPerFrame } = quantizeFrames(frames);
  const width = frames[0]!.width;
  const height = frames[0]!.height;
  for (const f of frames) {
    if (f.width !== width || f.height !== height) throw new InternalError('encodeGif: frames must share dimensions');
  }
  // 调色板补齐 2^n
  let tableBits = 1;
  while (1 << tableBits < palette.length) tableBits++;
  if (tableBits < 1) tableBits = 1;
  const tableSize = 1 << tableBits;
  const minCodeSize = Math.max(2, tableBits);

  const chunks: Buffer[] = [];
  chunks.push(Buffer.from('GIF89a', 'ascii'));
  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(width, 0);
  lsd.writeUInt16LE(height, 2);
  lsd[4] = 0x80 | ((tableBits - 1) << 4) | (tableBits - 1); // 全局表 + 尺寸
  lsd[5] = 0;  // bg color index
  lsd[6] = 0;  // aspect
  chunks.push(lsd);
  const gct = Buffer.alloc(tableSize * 3);
  palette.forEach((rgb, i) => {
    gct[i * 3] = rgb[0]!;
    gct[i * 3 + 1] = rgb[1]!;
    gct[i * 3 + 2] = rgb[2]!;
  });
  chunks.push(gct);
  // Netscape 无限循环
  chunks.push(Buffer.from([0x21, 0xff, 0x0b]), Buffer.from('NETSCAPE2.0', 'ascii'), Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00]));

  for (const indices of indicesPerFrame) {
    // GCE:disposal=1(留画面),delay,无透明
    const gce = Buffer.alloc(8);
    gce[0] = 0x21; gce[1] = 0xf9; gce[2] = 0x04;
    gce[3] = 0x04;                       // disposal 1 << 2
    gce.writeUInt16LE(Math.max(0, Math.min(0xffff, delayCs)), 4);
    gce[6] = 0; gce[7] = 0;
    chunks.push(gce);
    const desc = Buffer.alloc(10);
    desc[0] = 0x2c;
    desc.writeUInt16LE(0, 1); desc.writeUInt16LE(0, 3);
    desc.writeUInt16LE(width, 5); desc.writeUInt16LE(height, 7);
    desc[9] = 0;
    chunks.push(desc);
    const data = lzwEncode(indices, minCodeSize);
    const sub: Buffer[] = [Buffer.from([minCodeSize])];
    for (let i = 0; i < data.length; i += 255) {
      const slice = data.subarray(i, i + 255);
      sub.push(Buffer.from([slice.length]), Buffer.from(slice));
    }
    sub.push(Buffer.from([0]));
    chunks.push(...sub);
  }
  chunks.push(Buffer.from([0x3b]));
  return Buffer.concat(chunks);
}

// ── 生产级 GIF 解码(demo GIF 首帧像素 diff 验证用;与测试内独立解码器分开实现,
// 保留「测试锚定独立于生产实现」的原则)──────────────────────────────────────

/** 解码 GIF89a(仅支持本编码器产出的形态:全局表+GCE+无交错),返回索引帧与调色板。 */
export function decodeGifFrames(buf: Buffer): { palette: number[][]; frames: { indices: number[]; delayCs: number }[]; width: number; height: number } {
  if (buf.subarray(0, 6).toString('ascii') !== 'GIF89a') throw new InternalError('not a GIF89a');
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  const packed = buf[10]!;
  if (!(packed & 0x80)) throw new InternalError('global color table missing');
  const tableBits = (packed & 0x07) + 1;
  const tableSize = 1 << tableBits;
  const palette: number[][] = [];
  for (let i = 0; i < tableSize; i++) {
    const o = 13 + i * 3;
    palette.push([buf[o]!, buf[o + 1]!, buf[o + 2]!]);
  }
  let p = 13 + tableSize * 3;
  if (buf[p] === 0x21 && buf[p + 1] === 0xff) {
    p += 2;
    while (buf[p] !== 0x00) p += 1 + buf[p]!;
    p += 1;
  }
  const frames: { indices: number[]; delayCs: number }[] = [];
  while (buf[p] === 0x21 && buf[p + 1] === 0xf9) {
    const delayCs = buf.readUInt16LE(p + 4);
    const mcs = buf[p + 8 + 10]!;  // GCE(8) + Image Descriptor(10) 后即 minCodeSize
    p += 8 + 10 + 1;
    const sub: number[] = [];
    while (buf[p] !== 0x00) {
      const len = buf[p]!;
      for (let i = 0; i < len; i++) sub.push(buf[p + 1 + i]!);
      p += 1 + len;
    }
    p += 1;
    frames.push({ indices: gifLzwDecode(mcs, new Uint8Array(sub), width * height), delayCs });
  }
  return { palette, frames, width, height };
}

/** GIF 变体 LZW 解码(与 lzwEncode 对偶)。 */
function gifLzwDecode(minCodeSize: number, data: Uint8Array, maxPixels: number): number[] {
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
  const reset = () => {
    dict = [];
    for (let i = 0; i < clearCode; i++) dict.push(String.fromCharCode(i));
    dict.push(''); // clear
    dict.push(''); // eoi
    bits = minCodeSize + 1;
  };
  reset();
  let prev: string | null = null;
  while (out.length <= maxPixels) {
    const code = readCode();
    if (code === clearCode) { reset(); prev = null; continue; }
    if (code === eoiCode) break;
    let entry: string;
    if (code < dict.length && dict[code] !== '') entry = dict[code]!;
    else if (prev !== null) entry = prev + prev[0]!;
    else throw new InternalError('gif decode: bad code');
    for (const ch of entry) out.push(ch.charCodeAt(0));
    if (prev !== null) {
      dict.push(prev + entry[0]!);
      if (dict.length === (1 << bits) && bits < 12) bits++;
    }
    prev = entry;
  }
  return out;
}
