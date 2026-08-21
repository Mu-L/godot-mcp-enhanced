/**
 * P1-3（2026-07-31 建）：executeGdscript / spawnGodot mock 结果工厂。
 * G-4（2026-08-20 审查）：改 .ts + satisfies 编译期锚定——接口加/改字段时
 * 工厂默认对象缺字段/类型不符会在 `npm run typecheck:helpers` 红，不再静默测旧契约。
 *
 * 收敛工厂：
 *   - mockSuccessResult(overrides?)：完整 10 字段成功对象，允许覆盖（如业务特定 outputs）
 *   - mockFailureResult(opts)：失败对象，按失败类型（compile/run/sandbox/binary）生成
 *   - mockSuccessSpawn(overrides?)：spawnGodot 成功对象
 *   - mockCrashSpawn / mockTimeoutSpawn / mockCrashResult（P2-F 2026-08-08）
 *
 * 设计原则：
 *   1. 默认返回完整 ExecuteGdscriptResult 10 字段（对齐 src/gdscript-executor.ts 接口），
 *      避免「极简对象靠鸭子类型」的隐患（部分测试只写 success+outputs 是 TS 宽容，非刻意）。
 *   2. overrides 浅合并顶层字段；outputs 单独覆盖（不合并，因为业务 outputs 各异）。
 *   3. 不强求所有消费文件立刻迁移——变体（极简对象/executeGdscriptTrusted）保留各文件自行处理，
 *      工厂只服务「完整成功对象」这一主流形态。
 *
 * 用法：
 *   import { mockSuccessResult } from './helpers/mock-results.js';
 *   vi.mock('../src/gdscript-executor.js', () => ({
 *     executeGdscript: vi.fn(() => Promise.resolve(mockSuccessResult())),
 *   }));
 *   // 业务特定 outputs：
 *   executeGdscript: vi.fn(() => Promise.resolve(
 *     mockSuccessResult({ outputs: [{ key: 'perf', value: '{...}' }] })
 *   ));
 */
import type { ExecuteGdscriptResult } from '../../src/gdscript-executor.js';
import type { SpawnResult } from '../../src/tools/spawn-helper.js';

/**
 * executeGdscript 成功结果工厂。Partial 参数在调用点传接口外字段会触发 excess property check。
 */
export function mockSuccessResult(
  overrides: Partial<ExecuteGdscriptResult> = {},
): ExecuteGdscriptResult {
  return {
    success: true,
    compile_success: true,
    compile_error: '',
    errors: [],
    run_success: true,
    run_error: '',
    outputs: [],
    raw_output: '',
    duration_ms: 100,
    ...overrides,
  } satisfies ExecuteGdscriptResult;
}

/**
 * executeGdscript 失败结果工厂（P1-3 阶段 B 用）。
 * 按 kind 生成对应失败形态，对齐 ExecuteGdscriptResult（src/gdscript-executor.ts）的字段形态。
 * 下游 parseGdscriptResult（src/tools/shared/errors.ts）只看字段形态不看 executor 内部行号：
 *   !compile_success → 报 compile_error；!run_success → 报 run_error。
 * 故 kind 对齐的是"字段组合 + 错误文本语义"，非 executor 具体 early-return（行号易漂移，不引）。
 */
export function mockFailureResult(
  opts: {
    kind?: 'compile' | 'run' | 'sandbox' | 'binary' | 'generic';
    compileError?: string;
    runError?: string;
    outputs?: ExecuteGdscriptResult['outputs'];
  } = {},
): ExecuteGdscriptResult {
  const kind = opts.kind ?? 'generic';
  const base = {
    success: false,
    compile_success: false,
    compile_error: opts.compileError ?? '',
    errors: [],
    run_success: false,
    run_error: opts.runError ?? '',
    outputs: opts.outputs ?? [],
    raw_output: '',
    duration_ms: 0,
  } satisfies ExecuteGdscriptResult;
  switch (kind) {
    case 'compile':
      // 字段形态：compile_success:false + compile_error（Godot 编译失败产物，经 parseErrors 填入）
      return { ...base, compile_error: opts.compileError ?? 'Parse error: line 5: unexpected token' };
    case 'run':
      // 字段形态：compile_success:true + run_success:false + run_error（编译过但运行报错）
      return { ...base, compile_success: true, run_success: false, run_error: opts.runError ?? 'Runtime error: null reference' };
    case 'sandbox':
      // 字段形态同 compile，错误文本含 "Sandbox violation"（语义：scanGdscriptSandbox 命中）
      return { ...base, compile_error: opts.compileError ?? 'Sandbox violation: code contains dangerous patterns' };
    case 'binary':
      // 字段形态同 compile，错误文本含 "binary not found"（语义：godot 二进制缺失/非法）
      return { ...base, compile_error: opts.compileError ?? 'Godot binary not found: /fake/godot' };
    default:
      return base;
  }
}

/**
 * spawnGodot 成功结果工厂。
 */
export function mockSuccessSpawn(overrides: Partial<SpawnResult> = {}): SpawnResult {
  return {
    stdout: "Node 'root/Root/SomeNode' edited successfully",
    stderr: '',
    output: '',
    exitCode: 0,
    timedOut: false,
    ...overrides,
  } satisfies SpawnResult;
}

/**
 * P2-F (2026-08-08): spawnGodot 进程崩溃结果工厂。
 * 模拟 Godot 进程因 SIGSEGV/SIGABRT/原生异常崩溃退出（exitCode≠0 + stderr 含信号）。
 * 与 run_error（GDScript 异常）不同：崩溃是进程级，GDScript 层来不及报错。
 */
export function mockCrashSpawn(
  opts: Partial<SpawnResult> & { signal?: string } = {},
): SpawnResult {
  const signal = opts.signal ?? 'SIGSEGV';
  return {
    stdout: '',
    stderr: opts.stderr ?? `Godot process crashed: Received signal ${signal}`,
    output: '',
    exitCode: opts.exitCode ?? (process.platform === 'win32' ? 0xc0000005 : -11), // win32 STATUS_ACCESS_VIOLATION / POSIX SIGSEGV
    timedOut: false,
    ...opts,
  } satisfies SpawnResult;
}

/**
 * P2-F (2026-08-08): spawnGodot 超时结果工厂。
 * 模拟 Godot 进程超时被 forceKillTree 杀掉（timedOut=true + exitCode 被 kill 置非 0）。
 * 与 crash 不同：超时是 TS 侧主动杀，stderr 含 timeout 信息。
 */
export function mockTimeoutSpawn(
  opts: Partial<SpawnResult> & { timeoutMs?: number } = {},
): SpawnResult {
  return {
    stdout: '',
    stderr: opts.stderr ?? `Godot process timed out after ${opts.timeoutMs ?? 30000}ms (force-killed)`,
    output: '',
    exitCode: null, // 被 kill 杀掉的进程 exitCode 通常是 null
    timedOut: true,
    ...opts,
  } satisfies SpawnResult;
}

/**
 * P2-F (2026-08-08): executeGdscript 进程崩溃结果工厂。
 * 模拟 Godot headless 进程崩溃（非 GDScript 错误）——executeGdscript 层捕获后
 * run_success=false + run_error 含崩溃信息（非编译/运行时 GDScript 错误）。
 * 用于测 parseGdscriptResult 对崩溃 stderr 的分类（不应误判为 compile_error）。
 */
export function mockCrashResult(
  opts: Partial<ExecuteGdscriptResult> & { signal?: string } = {},
): ExecuteGdscriptResult {
  const signal = opts.signal ?? 'SIGSEGV';
  return {
    success: false,
    compile_success: true, // 崩溃发生在编译后（进程启动了但崩了），非编译错误
    compile_error: '',
    errors: [],
    run_success: false,
    run_error: opts.run_error ?? `Process crashed: ${signal}`,
    outputs: [],
    raw_output: opts.raw_output ?? `Godot process crashed: Received signal ${signal}`,
    duration_ms: opts.duration_ms ?? 50, // 崩溃通常很快
    ...opts,
  } satisfies ExecuteGdscriptResult;
}
