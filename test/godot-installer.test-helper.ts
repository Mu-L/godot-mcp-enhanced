// 测试 helper:手工拼 minimal zip 字节(store/deflate 条目、自定义条目名),
// 供路径穿越负向测试与 fixture 自生成(遵循仓库「fixture 代码自生成不提交二进制」惯例,
// 同 pngjs globalSetup 模式)。
import { writeFileSync } from 'fs';
import { deflateRawSync } from 'zlib';

interface EntrySpec {
  name: string;
  data: Buffer;          // 目录条目传空 Buffer
  compression: 0 | 8;    // store | deflate
}

/** 按条目清单拼完整 zip(local headers + central directory + EOCD)。 */
export function buildZip(zipPath: string, entries: EntrySpec[]): void {
  const parts: Buffer[] = [];
  const cdParts: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf-8');
    const payload = e.compression === 8 ? deflateRawSync(e.data) : e.data;

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0, 6);
    lfh.writeUInt16LE(e.compression, 8);
    lfh.writeUInt32LE(0, 14);                 // crc32(reader 不校验,置 0)
    lfh.writeUInt32LE(payload.length, 18);
    lfh.writeUInt32LE(e.data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    parts.push(lfh, nameBuf, payload);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(e.compression, 10);
    cd.writeUInt32LE(0, 16);
    cd.writeUInt32LE(payload.length, 20);
    cd.writeUInt32LE(e.data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);             // local header offset
    cdParts.push(cd, nameBuf);

    offset += lfh.length + nameBuf.length + payload.length;
  }

  const cdOffset = offset;
  const cdSize = cdParts.reduce((n, b) => n + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);

  writeFileSync(zipPath, Buffer.concat([...parts, ...cdParts, eocd]));
}

/** 构造仅含一个 store 条目(自定义条目名)的最小 zip——绕过任何工具对路径的合法化处理。 */
export function buildZipWithEntryName(zipPath: string, entryName: string, data: Buffer): void {
  buildZip(zipPath, [{ name: entryName, data, compression: 0 }]);
}

/** 生成正向 fixture 等价物:目录条目 + store 文本 + deflate 二进制(i%251 pattern)。 */
export function buildSampleZip(zipPath: string): void {
  buildZip(zipPath, [
    { name: 'sample_dir/', data: Buffer.alloc(0), compression: 0 },
    { name: 'sample_dir/readme.txt', data: Buffer.from('hello godot zip'), compression: 0 },
    { name: 'sample_dir/bin.dat', data: Buffer.from(Array.from({ length: 1024 }, (_, i) => i % 251)), compression: 8 },
  ]);
}
