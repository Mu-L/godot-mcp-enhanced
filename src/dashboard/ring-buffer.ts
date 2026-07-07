// src/dashboard/ring-buffer.ts
// RingBuffer 已提升到 src/core/ring-buffer.ts（fix-forward duplication-across-layers）。
// 此文件保留 re-export 以兼容现有 dashboard import。
export { RingBuffer } from '../core/ring-buffer.js';
