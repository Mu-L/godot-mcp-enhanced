import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A-ATOMIC (2026-09-01) 单测:core/fs-atomic(三份重复原子写实现的合并上移)。
// mock fs 以验证 tmp+rename 编排、mode 保持、Windows 锁定降级三分支。

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  statSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

// logger 有文件句柄副作用,mock 掉(降级分支的 debug 日志不落盘)
vi.mock('../src/core/logger.js', () => ({
  getLogger: () => ({ debug: () => undefined, warn: () => undefined }),
}));

import { writeFileSync, renameSync, statSync, unlinkSync } from 'fs';
import { writeFileAtomicWithMode } from '../src/core/fs-atomic.js';

const writeMock = vi.mocked(writeFileSync);
const renameMock = vi.mocked(renameSync);
const statMock = vi.mocked(statSync);
const unlinkMock = vi.mocked(unlinkSync);
const realPlatform = process.platform;

function setPlatform(p: string): void {
  Object.defineProperty(process, 'platform', { value: p });
}

beforeEach(() => {
  writeMock.mockReset();
  renameMock.mockReset();
  statMock.mockReset();
  unlinkMock.mockReset();
});

afterEach(() => {
  setPlatform(realPlatform);
});

describe('A-ATOMIC: writeFileAtomicWithMode(core/fs-atomic)', () => {
  it('AA-1: 新文件走 tmp+rename,tmp 随机后缀且内容一致', () => {
    statMock.mockImplementation(() => { throw new Error('ENOENT'); });

    writeFileAtomicWithMode(joinPath('p', 'scene.tscn'), 'hello');

    expect(writeMock).toHaveBeenCalledTimes(1);
    const tmp = writeMock.mock.calls[0]![0] as string;
    expect(tmp, 'tmp 不得是目标本身').not.toBe(joinPath('p', 'scene.tscn'));
    expect(tmp, 'tmp 形如 .<name>.<uuid>.tmp').toMatch(/[\\/]\.scene\.tscn\.[0-9a-f-]+\.tmp$/);
    expect(writeMock.mock.calls[0]![1]).toBe('hello');
    expect(writeMock.mock.calls[0]![2]).toBe('utf-8');
    expect(renameMock).toHaveBeenCalledWith(tmp, joinPath('p', 'scene.tscn'));
    expect(unlinkMock).not.toHaveBeenCalled();
  });

  it('AA-2: 目标已存在时保持 mode(对齐官方 servers 562feeb 保留文件权限)', () => {
    statMock.mockReturnValue({ mode: 0o100600 } as never);

    writeFileAtomicWithMode('/p/config.json', '{}');

    expect(writeMock.mock.calls[0]![2]).toMatchObject({ mode: 0o600, encoding: 'utf-8' });
  });

  it('AA-3: Windows rename 失败(IDE 锁定)→ 清理 tmp 并降级直写,不抛', () => {
    setPlatform('win32');
    statMock.mockImplementation(() => { throw new Error('ENOENT'); });
    renameMock.mockImplementation(() => { throw new Error('EPERM: locked by IDE'); });

    expect(() => writeFileAtomicWithMode('/p/a.json', 'x')).not.toThrow();
    expect(writeMock).toHaveBeenCalledTimes(2);  // 1=tmp, 2=降级直写目标
    expect(writeMock.mock.calls[1]![0]).toBe('/p/a.json');
    expect(writeMock.mock.calls[1]![1]).toBe('x');
    expect(unlinkMock).toHaveBeenCalled();
  });

  it('AA-4: 非 Windows rename 失败 → 抛出并清理 tmp(不降级)', () => {
    setPlatform('linux');
    statMock.mockImplementation(() => { throw new Error('ENOENT'); });
    renameMock.mockImplementation(() => { throw new Error('EXDEV'); });

    expect(() => writeFileAtomicWithMode('/p/a.json', 'x')).toThrow('EXDEV');
    expect(writeMock).toHaveBeenCalledTimes(1);  // 只有 tmp 写,无降级直写
    expect(unlinkMock).toHaveBeenCalled();
  });
});

function joinPath(dir: string, name: string): string {
  return process.platform === 'win32' ? `${dir}\\${name}` : `${dir}/${name}`;
}
