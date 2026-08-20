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

/** 构造 zip64 形态最小 zip:EOCD 字段全 0xFFFFFFFF + EOCD64 locator/记录 + CD 条目
 * 的 csize/usize/localOffset 0xFFFFFFFF + zip64 extra field 真值(批 4b:官方 tpz 即 zip64)。 */
export function buildZip64Sample(zipPath: string): void {
  const name = 'dir/big.bin';
  const nameBuf = Buffer.from(name, 'utf-8');
  const data = Buffer.from('zip64-payload');

  const localOffset = 0;
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(0, 8);            // store
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28);

  const cdOffset = localHeader.length + nameBuf.length + data.length;

  // zip64 extra field(仅 localOffset 真值;csize/usize 用 CD 32 位字段直接写真值,
  // 0xFFFFFFFF 只出现在 localOffset——覆盖 entry64Fix 的 offset 分支)
  const extra = Buffer.alloc(4 + 8);
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(8, 2);
  extra.writeBigUInt64LE(BigInt(localOffset), 4);

  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(0, 10);                    // store
  cd.writeUInt32LE(data.length, 20);          // csize 真值
  cd.writeUInt32LE(data.length, 24);          // usize 真值
  cd.writeUInt16LE(nameBuf.length, 28);
  cd.writeUInt16LE(extra.length, 30);
  cd.writeUInt32LE(0xffffffff, 42);           // localOffset → zip64 extra

  const cdSize = cd.length + nameBuf.length + extra.length;

  const eocd64 = Buffer.alloc(56);
  eocd64.writeUInt32LE(0x06064b50, 0);
  eocd64.writeBigUInt64LE(BigInt(44), 4);     // 本记录 size(minus 12)
  eocd64.writeBigUInt64LE(1n, 32);            // total entries
  eocd64.writeBigUInt64LE(BigInt(cdSize), 40);
  eocd64.writeBigUInt64LE(BigInt(cdOffset), 48);

  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(BigInt(cdOffset + cdSize), 8);  // EOCD64 offset

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt32LE(0xffffffff, 12);         // cdSize → zip64
  eocd.writeUInt32LE(0xffffffff, 16);         // cdOffset → zip64

  const { writeFileSync } = require('fs') as typeof import('fs');
  writeFileSync(zipPath, Buffer.concat([localHeader, nameBuf, data, cd, nameBuf, extra, eocd64, locator, eocd]));
}
