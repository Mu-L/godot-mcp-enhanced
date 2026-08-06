// src/tools/screenshot-detail.ts
// P1-5 视觉成本层级:给 screenshot analyze action 提供三档返回精度(full/thumbnail/ascii)。
// pngjs 纯 JS 解码 PNG(无 native 依赖),缩放/ASCII 手写(nearest-neighbor + 亮度映射)。

import { PNG } from 'pngjs';
import { Buffer } from 'node:buffer';

/** ASCII 亮度字符表:从暗到亮(10 级)。 */
const ASCII_RAMP = ' .:-=+*#%@';

export type DetailLevel = 'full' | 'thumbnail' | 'ascii';

/** 校验 detail 参数,非法值抛错。 */
export function parseDetailLevel(value: unknown): DetailLevel {
  if (value === undefined || value === 'full') return 'full';
  if (value === 'thumbnail' || value === 'ascii') return value;
  throw new Error(`Invalid detail value: ${String(value)}. Must be 'full', 'thumbnail', or 'ascii'.`);
}

/**
 * 解码 PNG buffer 为 RGBA 像素数据。
 * @throws 如果不是有效 PNG
 */
function decodePng(pngBuffer: Buffer): { width: number; height: number; data: Buffer } {
  const png = PNG.sync.read(pngBuffer);
  return { width: png.width, height: png.height, data: png.data };
}

/**
 * Nearest-neighbor 降采样:把任意尺寸 RGBA 图像降采样到 targetWidth × 按比例的 height。
 * 返回降采样后的 RGBA 像素 buffer(每像素 4 字节 RGBA)。
 */
function downsampleRgba(
  src: { width: number; height: number; data: Buffer },
  targetWidth: number,
): { width: number; height: number; data: Buffer } {
  const { width: srcW, height: srcH, data: srcData } = src;
  if (srcW === 0 || srcH === 0) {
    throw new Error('Cannot downsample empty image');
  }
  const dstW = Math.max(1, Math.min(targetWidth, srcW));
  const dstH = Math.max(1, Math.round((dstW / srcW) * srcH));
  const dstData = Buffer.alloc(dstW * dstH * 4);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;

  for (let y = 0; y < dstH; y++) {
    const srcY = Math.min(srcH - 1, Math.floor(y * yRatio));
    for (let x = 0; x < dstW; x++) {
      const srcX = Math.min(srcW - 1, Math.floor(x * xRatio));
      const srcIdx = (srcY * srcW + srcX) * 4;
      const dstIdx = (y * dstW + x) * 4;
      dstData[dstIdx] = srcData[srcIdx] ?? 0;       // R
      dstData[dstIdx + 1] = srcData[srcIdx + 1] ?? 0; // G
      dstData[dstIdx + 2] = srcData[srcIdx + 2] ?? 0; // B
      dstData[dstIdx + 3] = srcData[srcIdx + 3] ?? 0; // A
    }
  }
  return { width: dstW, height: dstH, data: dstData };
}

/**
 * P1-5 thumbnail:把 PNG 降采样到 targetWidth,重新编码为 PNG base64。
 * 返回 { base64, mimeType, width, height }。
 */
export function downsampleToThumbnail(
  pngBuffer: Buffer,
  targetWidth: number,
): { base64: string; mimeType: string; width: number; height: number } {
  const src = decodePng(pngBuffer);
  const dst = downsampleRgba(src, targetWidth);
  // 重新编码为 PNG(pngjs 原生支持)
  const outPng = new PNG({ width: dst.width, height: dst.height });
  outPng.data = dst.data;
  const outBuffer = PNG.sync.write(outPng);
  return {
    base64: outBuffer.toString('base64'),
    mimeType: 'image/png',
    width: dst.width,
    height: dst.height,
  };
}

/**
 * P1-5 ascii:把 PNG 降采样到 cols×rows 网格,每像素亮度映射 ASCII 字符。
 * 返回多行文本(每行 cols 字符,共 rows 行)。
 * 亮度 = 0.299*R + 0.587*G + 0.114*B(ITU-R BT.601)。
 */
export function downsampleToAscii(pngBuffer: Buffer, cols: number, rows: number): string {
  const src = decodePng(pngBuffer);
  const dst = downsampleRgba(src, cols);
  const actualRows = dst.height; // downsampleRgba 按比例算 height,可能不等于 rows
  const lines: string[] = [];

  // 如果降采样后的 height > rows,再做纵向 nearest-neighbor 采样到 rows
  const finalRows = Math.min(rows, actualRows);
  const yRatio = actualRows / finalRows;

  for (let row = 0; row < finalRows; row++) {
    const srcY = Math.min(actualRows - 1, Math.floor(row * yRatio));
    let line = '';
    for (let col = 0; col < dst.width; col++) {
      const idx = (srcY * dst.width + col) * 4;
      const r = dst.data[idx] ?? 0;
      const g = dst.data[idx + 1] ?? 0;
      const b = dst.data[idx + 2] ?? 0;
      const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const charIdx = Math.min(ASCII_RAMP.length - 1, Math.floor(brightness * ASCII_RAMP.length));
      line += ASCII_RAMP[charIdx];
    }
    lines.push(line);
  }
  return lines.join('\n');
}
