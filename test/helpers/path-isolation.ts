/**
 * 路径安全测试 env 隔离 helper（E-95）。
 *
 * 三件套：isolatePathEnv 返回 restore 函数（调用方 afterEach 调）/ asUnrestrictedPath / expectPathDenied。
 * cwd 用闭包捕获 origCwd（非模块级单例，多 describe 嵌套安全）。
 *
 * 设计决策（Task 1 TDD）：内部注册 afterEach 方案经实测不可靠——vitest 不支持在 beforeEach
 * 回调内动态调 afterEach 注册 hook（恢复验证 it FAIL，UNRESTRICTED 未恢复）。改返回 restore，
 * 调用方 `let restore; beforeEach(() => restore = isolatePathEnv(...)); afterEach(() => restore())`。
 *
 * ⚠️ footgun：vi.stubEnv 只记录 stubEnv 调用的键，restore 的 unstubAllEnvs 只恢复这些键。
 * 若 it 内用 process.env.X = 'true'（直接赋值而非 stubEnv），afterEach restore 不会清该赋值，
 * 跨 it 残留依赖下个 beforeEach 的 stubEnv 覆盖。故 it 内改 env 优先用 vi.stubEnv。
 */
import { vi, expect } from 'vitest';
import { _resetPathAllowWarned } from '../../src/core/path-utils.js';

/** 姿态A 隔离（deny-by-default）：清 UNRESTRICTED + 可选 ALLOWED + 可选 chdir + reset。返回 restore。 */
export function isolatePathEnv(opts: { allowed?: string[]; cwd?: string } = {}): () => void {
  vi.stubEnv('GODOT_MCP_UNRESTRICTED', '');
  const origCwd = opts.cwd ? process.cwd() : undefined;
  if (opts.allowed !== undefined) {
    if (opts.allowed.length) process.env.ALLOWED_PROJECT_PATHS = opts.allowed.join(';');
    else delete process.env.ALLOWED_PROJECT_PATHS;
  }
  if (opts.cwd) process.chdir(opts.cwd);
  _resetPathAllowWarned();
  return () => {
    vi.unstubAllEnvs();
    if (origCwd !== undefined) process.chdir(origCwd);
    delete process.env.ALLOWED_PROJECT_PATHS;
    _resetPathAllowWarned();
  };
}

/** 姿态B 刻意 unrestricted：测 bypass 行为（如 path-utils-roots 测 allow-all）。返回 restore。 */
export function asUnrestrictedPath(): () => void {
  vi.stubEnv('GODOT_MCP_UNRESTRICTED', 'true');
  _resetPathAllowWarned();
  return () => {
    vi.unstubAllEnvs();
    _resetPathAllowWarned();
  };
}

/** deny 断言：防 includes 恒真 / length>0 假绿，必须匹配路径拒绝错误（中英文 + PATH_NOT_ALLOWED）。 */
export function expectPathDenied(fn: () => unknown): void {
  expect(fn).toThrow(/PATH_NOT_ALLOWED|ALLOWED_PROJECT_PATHS|outside allowed|escapes allowed|不在.*ALLOWED|越界/i);
}
