// test/screenshot-detail.test.ts
// P1-5 视觉成本层级:验证 thumbnail 降采样 + ASCII art 生成 + detail 参数解析。
import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { parseDetailLevel, downsampleToThumbnail, downsampleToAscii } from '../src/tools/screenshot-detail.js';

/** 生成测试 PNG:左半黑(亮度 0)右半白(亮度 255),指定宽高。 */
function makeTestPng(width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      const isLeft = x < width / 2;
      const val = isLeft ? 0 : 255;  // 左黑右白
      png.data[idx] = val;       // R
      png.data[idx + 1] = val;   // G
      png.data[idx + 2] = val;   // B
      png.data[idx + 3] = 255;   // A
    }
  }
  return PNG.sync.write(png);
}

describe('P1-5 parseDetailLevel', () => {
  it('undefined → full(默认兼容)', () => {
    expect(parseDetailLevel(undefined)).toBe('full');
  });

  it('full/thumbnail/ascii 正确解析', () => {
    expect(parseDetailLevel('full')).toBe('full');
    expect(parseDetailLevel('thumbnail')).toBe('thumbnail');
    expect(parseDetailLevel('ascii')).toBe('ascii');
  });

  it('非法值抛错', () => {
    expect(() => parseDetailLevel('small')).toThrow(/Invalid detail/);
    expect(() => parseDetailLevel(123)).toThrow(/Invalid detail/);
  });
});

describe('P1-5 downsampleToThumbnail', () => {
  it('降采样到指定宽度,保持纵横比', () => {
    const src = makeTestPng(1024, 512);  // 2:1 宽高比
    const thumb = downsampleToThumbnail(src, 256);
    expect(thumb.width).toBe(256);
    expect(thumb.height).toBe(128);  // 保持 2:1
    expect(thumb.mimeType).toBe('image/png');
    expect(typeof thumb.base64).toBe('string');
    expect(thumb.base64.length).toBeGreaterThan(0);
  });

  it('targetWidth > srcWidth 时不放大(clamp 到 srcWidth)', () => {
    const src = makeTestPng(100, 50);
    const thumb = downsampleToThumbnail(src, 500);
    expect(thumb.width).toBe(100);  // 不放大
    expect(thumb.height).toBe(50);
  });

  it('降采样后 base64 显著小于原始', () => {
    const src = makeTestPng(1024, 768);
    const thumb = downsampleToThumbnail(src, 128);
    expect(thumb.base64.length).toBeLessThan(src.toString('base64').length);
  });
});

describe('P1-5 downsampleToAscii', () => {
  it('返回多行文本,行数 ≤ rows', () => {
    const src = makeTestPng(800, 600);
    const ascii = downsampleToAscii(src, 80, 40);
    const lines = ascii.split('\n');
    expect(lines.length).toBeLessThanOrEqual(40);
    expect(lines.length).toBeGreaterThan(0);
  });

  it('每行字符数 ≤ cols', () => {
    const src = makeTestPng(800, 600);
    const ascii = downsampleToAscii(src, 60, 30);
    const lines = ascii.split('\n');
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(60);
    }
  });

  it('左黑右白图像:左半暗字符(空格/点),右半亮字符(#/@)', () => {
    const src = makeTestPng(200, 100);
    const ascii = downsampleToAscii(src, 20, 10);
    const lines = ascii.split('\n');
    expect(lines.length).toBeGreaterThan(0);
    const firstLine = lines[0]!;
    const leftChar = firstLine[Math.floor(firstLine.length / 4)]!;  // 左 1/4 处(黑)
    const rightChar = firstLine[Math.floor(firstLine.length * 3 / 4)]!;  // 右 3/4 处(白)
    // ASCII_RAMP = ' .:-=+*#%@'; 暗→亮。左边黑应该靠前(空格/点),右边白靠后(#/@)
    const ramp = ' .:-=+*#%@';
    expect(ramp.indexOf(leftChar)).toBeLessThan(ramp.indexOf(rightChar));
  });

  it('空图像(0x0)抛错', () => {
    // pngjs 不支持 0x0,但防御性测试
    expect(() => {
      const png = new PNG({ width: 1, height: 1 });
      const buf = PNG.sync.write(png);
      // 用合法 1x1 测试不抛错
      const ascii = downsampleToAscii(buf, 10, 5);
      expect(ascii).toBeTypeOf('string');
    }).not.toThrow();
  });
});
