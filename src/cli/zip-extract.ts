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
}

function locateEocd(buf: Buffer): number {
  const scanStart = Math.max(0, buf.length - EOCD_MAX_SCAN);
  for (let i = buf.length - EOCD_MIN_SIZE; i >= scanStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new InternalError('zip: end-of-central-directory signature not found (not a zip file?)');
}

function readCentralDirectory(buf: Buffer): ZipEntry[] {
  const eocd = locateEocd(buf);
  const entryCount = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);  // CD offset
  const entries: ZipEntry[] = [];
  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CD_ENTRY_SIG) {
      throw new InternalError(`zip: corrupt central directory at entry ${i}`);
    }
    const fnLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    entries.push({
      name: buf.toString('utf-8', offset + 46, offset + 46 + fnLen),
      compression: buf.readUInt16LE(offset + 10),
      compressedSize: buf.readUInt32LE(offset + 20),
      uncompressedSize: buf.readUInt32LE(offset + 24),
      localHeaderOffset: buf.readUInt32LE(offset + 42),
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
