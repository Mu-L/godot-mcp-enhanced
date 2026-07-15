import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock 工厂被提升到文件顶部（早于 import 与 const 初始化），
// 故 mock 变量必须用 vi.hoisted 创建（对称 test/android.test.ts，vitest 4 TDZ 约束）。
// 直接 mock child_process.execFile（promisify 包装层）而非 util.promisify ——
// 更稳、不受 vi.mocked().mockReturnValue API 行为影响（对称 test/godot-finder.test.js）。
const { mockExecFile, mockExistsSync } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockExistsSync: vi.fn((): boolean => false),
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, execFile: mockExecFile };
});

// 仅覆盖 existsSync，保留 fs 其他方法（helpers.ts transitive import mkdirSync/readFileSync）。
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: mockExistsSync };
});

import { isBlenderVersionSignature, findBlender, validateBlenderBinary, clearBlenderPathCache } from '../../src/core/blender-finder.js';

beforeEach(() => {
  clearBlenderPathCache();
  delete process.env.GODOT_BLENDER_PATH;
  mockExecFile.mockReset();
  mockExistsSync.mockReset();
  mockExistsSync.mockReturnValue(false); // 默认路径不存在
});

// execFile 回调签名（promisify 包装前的原始 callback 形式）。
type ExecFileCallback = (err: Error | null, result: { stdout: string; stderr: string } | null) => void;

// Helper：让 execFile mock（callback 签名，被 promisify 包装）成功返回 stdout。
function mockExecFileSuccess(stdout: string): void {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
    const callback = (typeof _opts === 'function' ? _opts : cb) as ExecFileCallback | undefined;
    if (callback) callback(null, { stdout, stderr: '' });
  });
}

// Helper：让 execFile mock 报 spawn 错误。
function mockExecFileError(): void {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
    const callback = (typeof _opts === 'function' ? _opts : cb) as ExecFileCallback | undefined;
    if (callback) callback(new Error('ENOENT'), null);
  });
}

describe('isBlenderVersionSignature', () => {
  it('accepts real Blender --version output', () => {
    expect(isBlenderVersionSignature('Blender 4.2.0\n')).toBe(true);
  });
  it('rejects output without "Blender" keyword (forgeable binary, C-SEC-2)', () => {
    expect(isBlenderVersionSignature('4.2.0\n')).toBe(false);
  });
  it('rejects output without version number', () => {
    expect(isBlenderVersionSignature('Blender\n')).toBe(false);
  });
});

describe('validateBlenderBinary', () => {
  it('returns true for valid signature', async () => {
    mockExecFileSuccess('Blender 4.2.0');
    expect(await validateBlenderBinary('/fake/blender')).toBe(true);
  });
  it('returns false for forged binary (no Blender keyword)', async () => {
    mockExecFileSuccess('4.2.0');
    expect(await validateBlenderBinary('/fake/blender')).toBe(false);
  });
  it('returns false on spawn error', async () => {
    mockExecFileError();
    expect(await validateBlenderBinary('/fake/blender')).toBe(false);
  });
});

describe('findBlender', () => {
  it('uses GODOT_BLENDER_PATH when valid', async () => {
    mockExistsSync.mockReturnValue(true);
    mockExecFileSuccess('Blender 4.2.0');
    process.env.GODOT_BLENDER_PATH = '/opt/blender';
    expect(await findBlender()).toBe('/opt/blender');
  });
  it('throws when nothing found', async () => {
    mockExistsSync.mockReturnValue(false);
    mockExecFileError();
    await expect(findBlender()).rejects.toThrow('Blender not found');
  });
  it('falls back to blender on PATH when GODOT_BLENDER_PATH unset', async () => {
    mockExecFileSuccess('Blender 4.2.0');
    expect(await findBlender()).toBe('blender');
  });
});
