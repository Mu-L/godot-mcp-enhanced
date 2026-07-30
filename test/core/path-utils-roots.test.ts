import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve } from 'path';
import {
  getAllowedProjectPaths,
  isPathInAllowedRoots,
  setAllowedRootsFromClient,
  hasDynamicRoots,
  parseFileRootUris,
} from '../../src/core/path-utils.js';
import { isolatePathEnv } from '../helpers/path-isolation.js';

describe('path-utils dynamic roots (Task 1)', () => {
  let restore = () => {};

  beforeEach(() => {
    restore = isolatePathEnv({ allowed: [] });   // 清 UNRESTRICTED + 删 ALLOWED + reset（补 reset，spec 审阅偏差1）
    setAllowedRootsFromClient(null);    // dynamic roots 状态 helper 不管，保留手动
  });
  afterEach(() => {
    restore();
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

describe('path-utils roots security contracts (Task 2)', () => {
  let restore = () => {};

  beforeEach(() => {
    restore = isolatePathEnv({ allowed: [] });
    setAllowedRootsFromClient(null);
  });
  afterEach(() => {
    restore();
    setAllowedRootsFromClient(null);
  });

  it('契约1a: roots 窄于 env → env 完全忽略（作用域缩）', () => {
    // env 放宽到 /e1，但 client roots 只授权 /r1 → /e1 下路径必须被拒
    process.env.ALLOWED_PROJECT_PATHS = resolve('/e1');
    setAllowedRootsFromClient([resolve('/r1')]);
    expect(isPathInAllowedRoots(resolve('/e1/inside'))).toBe(false);  // env 被忽略
    expect(isPathInAllowedRoots(resolve('/r1/inside'))).toBe(true);
  });

  it('契约1b: roots 宽于 env → 作用域扩（env 不束缚 client 声明）', () => {
    // env 只授权 /e1，client roots 扩到 /wide → /wide 下路径放行（信任模型：client 是授权权威）
    process.env.ALLOWED_PROJECT_PATHS = resolve('/e1');
    setAllowedRootsFromClient([resolve('/wide')]);
    expect(isPathInAllowedRoots(resolve('/wide/inside'))).toBe(true);
    expect(isPathInAllowedRoots(resolve('/e1/inside'))).toBe(false);  // env 不再生效
  });

  it('契约2: dynamic roots 也走 realpath 归一（绑 path-sandbox-touctou 不复发）', () => {
    // 含 ".." 与混合分隔符的非规范 root → 经 isPathInAllowedRoots 归一后判定，无法绕 check
    const base = resolve('/rnorm');
    setAllowedRootsFromClient([base.replace(/\\/g, '/') + '/sub/../']);  // 非规范
    // 子路径访问须通过归一后的 base 校验（不因非规范写法绕过/误拒）
    const child = base.replace(/\\/g, '/') + '/file.txt';
    expect(isPathInAllowedRoots(child)).toBe(true);
    // 外部路径仍拒
    expect(isPathInAllowedRoots(resolve('/outside'))).toBe(false);
  });
});
