/**
 * 零依赖 zip 提取器(批 2 自写,替代系统 tar 方案——真机实测双杀:
 * Linux GNU tar 不支持 zip 格式;Windows GNU tar 把 `C:\` 绝对路径当
 * host:path 远程语法 "Cannot connect to C:")。
 *
 * 支持子集(覆盖 Godot 官方 release 资产):store(0) + deflate(8),无加密;
 * 不需要 zip64(资产 <4GB)。完整性由外层 SHA512(SHA512-SUMS.txt 同源校验)
 * 保证,内层 CRC32 冗余不校验。路径穿越防护:条目名以 / 开头、含 .. 段、
 * 或含盘符形态 → 拒绝整个 zip。
 */
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { inflateRawSync } from 'zlib';
import { InternalError } from '../core/tool-errors.js';

const EOCD_SIG = 0x06054b50;
const EOCD_MIN_SIZE = 22;
const EOCD_MAX_SCAN = EOCD_MIN_SIZE + 65535;  // EOCD + 最大 comment
const CD_ENTRY_SIG = 0x02014b50;
const LOCAL_HEADER_SIG = 0x04034b50;

interface ZipEntry {
  name: string;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/** 条目名安全校验:拒绝对对路径/盘符/.. 段(路径穿越防护)+ Windows 保留设备名(纵深防御)。 */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

function assertSafeEntryName(name: string): void {
  const normalized = name.replace(/\\/g, '/');
  if (normalized.startsWith('/')) {
    throw new InternalError(`zip entry path traversal (absolute): ${name}`);
  }
  if (/^[a-zA-Z]:/.test(normalized)) {
    throw new InternalError(`zip entry path traversal (drive): ${name}`);
  }
  const segments = normalized.split('/');
  if (segments.some(seg => seg === '..')) {
    throw new InternalError(`zip entry path traversal (..): ${name}`);
  }
  const base = segments.pop() ?? normalized;
  if (WINDOWS_RESERVED.test(base)) {
    throw new InternalError(`zip entry reserved device name: ${name}`);
  }
  // 安全P3-1(2026-08-20 审查):NTFS 交替数据流形态(foo.txt:ads)——盘符正则只认行首
  // `^[a-zA-Z]:`,基名中冒号不拦;win32 writeFileSync 落 NTFS ADS=经典恶意载荷藏匿位。
  // win32 合法文件名不含冒号(盘符已被上游拒且那是整路径级),基名含 : 即拒。
  if (base.includes(':')) {
    throw new InternalError(`zip entry NTFS alternate data stream: ${name}`);
  }
}

function locateEocd(buf: Buffer): number {
  const scanStart = Math.max(0, buf.length - EOCD_MAX_SCAN);
  for (let i = buf.length - EOCD_MIN_SIZE; i >= scanStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new InternalError('zip: end-of-central-directory signature not found (not a zip file?)');
}

function u64le(buf: Buffer, off: number): number {
  return buf.readUInt32LE(off) + buf.readUInt32LE(off + 4) * 0x1_0000_0000;
}

/** zip64 支持(Godot 官方 export templates .tpz 即 zip64):EOCD 的 CD offset/size/条目数
 *  为 0xFFFFFFFF 时,从 EOCD64 locator 前溯 EOCD64 记录取 8 字节真值;CD 条目内
 *  csize/usize/localOffset 为 0xFFFFFFFF 时读 zip64 extra field。 */
function readEocdValues(buf: Buffer, eocd: number): { entryCount: number; cdOffset: number; cdSize: number } {
  let entryCount = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  let cdSize = buf.readUInt32LE(eocd + 12);
  const zip64Needed = cdOffset === 0xffffffff || cdSize === 0xffffffff || entryCount === 0xffff || buf.readUInt16LE(eocd + 8) === 0xffff;
  if (zip64Needed) {
    // EOCD64 locator 恰在 EOCD 前(20 字节):sig 0x07064b50 + ... + EOCD64 offset(8B,偏移 8)
    const locator = eocd - 20;
    if (locator >= 0 && buf.readUInt32LE(locator) === 0x07064b50) {
      const e64 = u64le(buf, locator + 8);
      if (buf.readUInt32LE(e64) === 0x06064b50) {
        entryCount = u64le(buf, e64 + 32);
        cdSize = u64le(buf, e64 + 40);
        cdOffset = u64le(buf, e64 + 48);
      }
    }
    if (cdOffset === 0xffffffff) throw new InternalError('zip: zip64 EOCD not found but needed');
  }
  return { entryCount, cdOffset, cdSize };
}

/** CD 条目的 zip64 extra field(header id 0x0001)按需补真值(顺序:usize,csize,localOffset,disk)。 */
function entry64Fix(buf: Buffer, extraStart: number, extraLen: number, e: { compressedSize: number; uncompressedSize: number; localHeaderOffset: number }): void {
  if (e.compressedSize !== 0xffffffff && e.uncompressedSize !== 0xffffffff && e.localHeaderOffset !== 0xffffffff) return;
  let p = extraStart;
  const end = extraStart + extraLen;
  while (p + 4 <= end) {
    const id = buf.readUInt16LE(p);
    const size = buf.readUInt16LE(p + 2);
    if (id === 0x0001) {
      let q = p + 4;
      if (e.uncompressedSize === 0xffffffff && q + 8 <= end) { e.uncompressedSize = u64le(buf, q); q += 8; }
      if (e.compressedSize === 0xffffffff && q + 8 <= end) { e.compressedSize = u64le(buf, q); q += 8; }
      if (e.localHeaderOffset === 0xffffffff && q + 8 <= end) { e.localHeaderOffset = u64le(buf, q); }  // F-3:末字段,无后续消费不再累加 q
      return;
    }
    p += 4 + size;
  }
}

function readCentralDirectory(buf: Buffer): ZipEntry[] {
  const eocd = locateEocd(buf);
  const { entryCount, cdOffset } = readEocdValues(buf, eocd);
  let offset = cdOffset;  // CD offset
  const entries: ZipEntry[] = [];
  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CD_ENTRY_SIG) {
      throw new InternalError(`zip: corrupt central directory at entry ${i}`);
    }
    const fnLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const fields = {
      compressedSize: buf.readUInt32LE(offset + 20),
      uncompressedSize: buf.readUInt32LE(offset + 24),
      localHeaderOffset: buf.readUInt32LE(offset + 42),
    };
    entry64Fix(buf, offset + 46 + fnLen, extraLen, fields);
    entries.push({
      name: buf.toString('utf-8', offset + 46, offset + 46 + fnLen),
      compression: buf.readUInt16LE(offset + 10),
      compressedSize: fields.compressedSize,
      uncompressedSize: fields.uncompressedSize,
      localHeaderOffset: fields.localHeaderOffset,
    });
    offset += 46 + fnLen + extraLen + commentLen;
  }
  return entries;
}

/** 解压 zip 到 destDir(整读——Godot editor 资产 ~60MB 级,远低于 Node 默认堆压力线)。 */
export async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const buf = readFileSync(zipPath);
  const entries = readCentralDirectory(buf);
  // 先全量校验条目名(任一恶意 → 整包拒绝,不落半解压状态)
  for (const e of entries) {
    if (!e.name.endsWith('/')) assertSafeEntryName(e.name);  // 目录条目无数据,跳过
  }
  mkdirSync(destDir, { recursive: true });
  for (const e of entries) {
    const target = join(destDir, e.name);
    if (e.name.endsWith('/')) {
      mkdirSync(target, { recursive: true });
      continue;
    }
    // 读 local file header,定位数据起点
    const lho = e.localHeaderOffset;
    if (lho + 30 > buf.length || buf.readUInt32LE(lho) !== LOCAL_HEADER_SIG) {
      throw new InternalError(`zip: corrupt local header for entry ${e.name}`);
    }
    const lfhLen = buf.readUInt16LE(lho + 26);
    const lfhExtra = buf.readUInt16LE(lho + 28);
    const dataStart = lho + 30 + lfhLen + lfhExtra;
    const raw = buf.subarray(dataStart, dataStart + e.compressedSize);
    let content: Buffer;
    if (e.compression === 0) {
      content = raw;
    } else if (e.compression === 8) {
      content = inflateRawSync(raw);
    } else {
      throw new InternalError(`zip: unsupported compression method ${e.compression} for ${e.name}`);
    }
    if (content.length !== e.uncompressedSize) {
      throw new InternalError(`zip: size mismatch for ${e.name} (expected ${e.uncompressedSize}, got ${content.length})`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}
