import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getAllowedProjectPaths,
  isPathInAllowedRoots,
  setAllowedRootsFromClient,
  hasDynamicRoots,
  parseFileRootUris,
} from '../../src/core/path-utils.js';

describe('path-utils dynamic roots (Task 1)', () => {
  const origEnv = process.env.ALLOWED_PROJECT_PATHS;
  const origUnrestricted = process.env.GODOT_MCP_UNRESTRICTED;

  beforeEach(() => {
    delete process.env.ALLOWED_PROJECT_PATHS;
    delete process.env.GODOT_MCP_UNRESTRICTED;
    setAllowedRootsFromClient(null);
  });
  afterEach(() => {
    if (origEnv !== undefined) process.env.ALLOWED_PROJECT_PATHS = origEnv;
    else delete process.env.ALLOWED_PROJECT_PATHS;
    if (origUnrestricted !== undefined) process.env.GODOT_MCP_UNRESTRICTED = origUnrestricted;
    setAllowedRootsFromClient(null);
  });

  it('setAllowedRootsFromClient 非空 → getAllowedProjectPaths 返回 roots', () => {
    setAllowedRootsFromClient(['/r1', '/r2']);
    expect(getAllowedProjectPaths()).toEqual(['/r1', '/r2']);
    expect(hasDynamicRoots()).toBe(true);
  });

  it('setAllowedRootsFromClient(null) → 回落 env', () => {
    process.env.ALLOWED_PROJECT_PATHS = '/e1;/e2';
    setAllowedRootsFromClient(null);
    expect(hasDynamicRoots()).toBe(false);
    // env 分支 resolvePath 后（平台相关），断言长度 + 末段
    const got = getAllowedProjectPaths();
    expect(got.length).toBe(2);
    expect(got[0].replace(/\\/g, '/')).toMatch(/\/?e1$/);
  });

  it('setAllowedRootsFromClient([]) 等同 null（回落 env）', () => {
    process.env.ALLOWED_PROJECT_PATHS = '/e1';
    setAllowedRootsFromClient([]);
    expect(hasDynamicRoots()).toBe(false);
    expect(getAllowedProjectPaths().length).toBe(1);
  });

  it('动态优先于 env（同时设两者 → 用 roots）', () => {
    process.env.ALLOWED_PROJECT_PATHS = '/e1';
    setAllowedRootsFromClient(['/r1']);
    expect(getAllowedProjectPaths()).toEqual(['/r1']);
  });

  it('UNRESTRICTED 仍最高优先（绕过 roots + env）', () => {
    setAllowedRootsFromClient(['/r1']);
    process.env.GODOT_MCP_UNRESTRICTED = 'true';
    expect(isPathInAllowedRoots('/anywhere/outside')).toBe(true);
  });

  it('parseFileRootUris: file:// 解析为本地路径，过滤非 file: + 非法 URI', () => {
    const roots = [
      { uri: 'file:///D:/abs/path' },        // 绝对（跨平台可解析形式）
      { uri: 'file:///C:/proj' },            // 绝对（另一盘）
      { uri: 'http://evil.example/x' },      // 非 file: → 过滤
      { uri: 'file://invalid % broken' },    // 非法 → 过滤（fileURLToPath 抛）
    ];
    const got = parseFileRootUris(roots);
    // 2 个有效（两个 file:// 绝对路径），http 与非法被滤
    expect(got.length).toBe(2);
    expect(got.every(p => !p.startsWith('http'))).toBe(true);
  });

  it('parseFileRootUris: 不过滤路径存在性（待建 root 保留）', () => {
    const got = parseFileRootUris([{ uri: 'file:///D:/this/does/not/exist/yet' }]);
    expect(got.length).toBe(1);  // 不存在但 scheme 合法 → 保留（存在性交 check 期）
  });
});
