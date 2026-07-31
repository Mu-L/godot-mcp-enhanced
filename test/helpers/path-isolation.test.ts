import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { isolatePathEnv, asUnrestrictedPath, expectPathDenied } from './path-isolation.js';
import { isPathInAllowedRoots } from '../../src/core/path-utils.js';

const origCwd = process.cwd();

describe('isolatePathEnv', () => {
  let restore: () => void = () => {};
  beforeEach(() => { restore = isolatePathEnv(); });
  afterEach(() => restore());

  it('清 GODOT_MCP_UNRESTRICTED（setup.js 默认 true 被覆盖）', () => {
    expect(process.env.GODOT_MCP_UNRESTRICTED).toBe('');
  });

  it('触发 deny-by-default（isPathInAllowedRoots 对 cwd 外返 false）', () => {
    const outside = process.platform === 'win32' ? 'C:/Windows/System32' : '/etc';
    expect(isPathInAllowedRoots(outside)).toBe(false);
  });
});

describe('isolatePathEnv afterEach 恢复验证', () => {
  it('前一个 describe 的 afterEach(restore) 已恢复 UNRESTRICTED（=setup.js 默认 true）', () => {
    expect(process.env.GODOT_MCP_UNRESTRICTED).toBe('true');
  });
});

describe('isolatePathEnv allowed', () => {
  let restore: () => void = () => {};
  let allowed: string;
  beforeEach(() => { allowed = tmpdir(); restore = isolatePathEnv({ allowed: [allowed] }); });
  afterEach(() => restore());

  it('设 ALLOWED_PROJECT_PATHS（allowed 内放行）', () => {
    expect(process.env.ALLOWED_PROJECT_PATHS).toContain(allowed);
    expect(isPathInAllowedRoots(allowed)).toBe(true);
  });
});

describe('isolatePathEnv allowed:undefined（不动 ALLOWED）', () => {
  let restore: () => void = () => {};
  beforeEach(() => {
    process.env.ALLOWED_PROJECT_PATHS = '/preset-by-caller';
    restore = isolatePathEnv();   // allowed:undefined → 不应删 /preset
  });
  afterEach(() => restore());

  it('不覆盖调用方预设的 ALLOWED_PROJECT_PATHS', () => {
    expect(process.env.ALLOWED_PROJECT_PATHS).toBe('/preset-by-caller');
  });
});

describe('isolatePathEnv cwd', () => {
  let restore: () => void = () => {};
  beforeEach(() => { restore = isolatePathEnv({ cwd: tmpdir() }); });
  afterEach(() => restore());

  it('chdir 到指定目录 + restore 恢复', () => {
    expect(process.cwd()).toBe(tmpdir());
  });

  it('restore 后 cwd 恢复（跨 it 验证）', () => {
    // 前 it 的 afterEach(restore) 应已 chdir 回 origCwd，本 beforeEach 再 chdir tmpdir
    expect(process.cwd()).toBe(tmpdir());
  });
});

describe('cwd 恢复验证', () => {
  it('前一个 describe 的 restore 已 chdir 回 origCwd', () => {
    expect(process.cwd()).toBe(origCwd);
  });
});

describe('asUnrestrictedPath', () => {
  let restore: () => void = () => {};
  beforeEach(() => { restore = asUnrestrictedPath(); });
  afterEach(() => restore());

  it('设 UNRESTRICTED=true（测 bypass 姿态）', () => {
    expect(process.env.GODOT_MCP_UNRESTRICTED).toBe('true');
    expect(isPathInAllowedRoots('/anywhere')).toBe(true);
  });
});

describe('expectPathDenied', () => {
  it('匹配中文路径拒绝错误', () => {
    expectPathDenied(() => { throw new Error('projectPath 不在 ALLOWED_PROJECT_PATHS'); });
  });

  it('匹配 PATH_NOT_ALLOWED', () => {
    expectPathDenied(() => { throw new Error('PATH_NOT_ALLOWED: foo'); });
  });

  it('非路径错误不匹配（防泛化）', () => {
    expect(() => expectPathDenied(() => { throw new Error('some other error'); })).toThrow();
  });
});
