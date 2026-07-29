// test/core/update-checker.test.ts
// S2 readCache 字节上限测试：防大文件 OOM + latest 长度上限
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_CACHE_DIR = join(tmpdir(), 'godot-mcp-test-cache');
const TEST_CACHE_PATH = join(TEST_CACHE_DIR, 'update-cache.json');

function cleanup() {
  if (existsSync(TEST_CACHE_PATH)) {
    unlinkSync(TEST_CACHE_PATH);
  }
}

describe('readCache 字节上限 (C-T4: S2)', () => {
  beforeEach(() => {
    cleanup();
    mkdirSync(TEST_CACHE_DIR, { recursive: true });
  });

  afterEach(cleanup);

  it('应该拒绝 >64KB 的缓存文件', async () => {
    // 创建 >64KB 的恶意缓存文件
    const largeObj = {
      lastCheck: Date.now(),
      latest: '1.0.0' + 'x'.repeat(64 * 1024)  // 用长字符串撑大文件
    };
    writeFileSync(TEST_CACHE_PATH, JSON.stringify(largeObj), 'utf-8');

    // 动态导入，确保每次测试都是最新代码
    const module = await import('../../src/core/update-checker.ts');
    const readCache = (module as any).readCache;  // 访问导出的 readCache

    const result = readCache(TEST_CACHE_PATH);

    // readCache 应该返回 null（拒绝大文件）
    expect(result).toBeNull();
  });

  it('应该拒绝 latest.length > 64 的缓存', async () => {
    // 创建 latest 字段超长的缓存文件（但文件大小 <64KB）
    const largeLatestObj = {
      lastCheck: Date.now(),
      latest: 'v' + '1.0.0-'.repeat(20)  // 约 100 字符，但文件很小
    };
    writeFileSync(TEST_CACHE_PATH, JSON.stringify(largeLatestObj), 'utf-8');

    const module = await import('../../src/core/update-checker.ts');
    const readCache = (module as any).readCache;

    const result = readCache(TEST_CACHE_PATH);

    // readCache 应该返回 null（拒绝超长 latest）
    expect(result).toBeNull();
  });

  it('应该接受正常的缓存文件（latest <= 64 字符）', async () => {
    // 创建正常缓存
    const normalObj = {
      lastCheck: Date.now(),
      latest: '1.2.3'
    };
    writeFileSync(TEST_CACHE_PATH, JSON.stringify(normalObj), 'utf-8');

    const module = await import('../../src/core/update-checker.ts');
    const readCache = (module as any).readCache;

    const result = readCache(TEST_CACHE_PATH);

    // 正常缓存应该被接受
    expect(result).not.toBeNull();
    expect(result).toEqual({
      lastCheck: normalObj.lastCheck,
      latest: '1.2.3'
    });
  });

  it('应该处理损坏的 JSON 返 null（不 throw）', async () => {
    // 写入损坏的 JSON
    writeFileSync(TEST_CACHE_PATH, '{ broken json', 'utf-8');

    const module = await import('../../src/core/update-checker.ts');
    const readCache = (module as any).readCache;

    // 不应该抛出错误，应该返回 null
    expect(() => readCache(TEST_CACHE_PATH)).not.toThrow();
    expect(readCache(TEST_CACHE_PATH)).toBeNull();
  });

  it('应该处理文件不存在返回 null', async () => {
    const module = await import('../../src/core/update-checker.ts');
    const readCache = (module as any).readCache;

    const nonExistentPath = join(TEST_CACHE_DIR, 'non-existent.json');

    expect(readCache(nonExistentPath)).toBeNull();
  });
});
