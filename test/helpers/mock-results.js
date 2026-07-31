/**
 * P1-3（2026-07-31 建）：executeGdscript / spawnGodot mock 结果工厂。
 *
 * 看板指控：22 份测试文件内联 `vi.mock(...gdscript-executor)`，happy mock 对象散落各处，
 * 失败分支零工厂。本文件收敛两类工厂：
 *   - mockSuccessResult(overrides?)：完整 10 字段成功对象，允许覆盖（如业务特定 outputs）
 *   - mockFailureResult(opts)：失败对象，按失败类型（compile/run/sandbox/binary）生成
 *   - mockSuccessSpawn(overrides?)：spawnGodot 成功对象
 *
 * 设计原则：
 *   1. 默认返回完整 ExecuteGdscriptResult 10 字段（对齐 src/gdscript-executor.ts:449-461 接口），
 *      避免「极简对象靠鸭子类型」的隐患（部分测试只写 success+outputs 是 TS 宽容，非刻意）。
 *   2. overrides 浅合并顶层字段；outputs 单独覆盖（不合并，因为业务 outputs 各异）。
 *   3. 不强求所有 22 文件立刻迁移——变体（极简对象/executeGdscriptTrusted）保留各文件自行处理，
 *      工厂只服务「完整成功对象」这一主流形态（约占 18/22）。
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

/**
 * executeGdscript 成功结果工厂。
 * @param {Partial<import('../../src/gdscript-executor.js').ExecuteGdscriptResult>} [overrides]
 * @returns {import('../../src/gdscript-executor.js').ExecuteGdscriptResult}
 */
export function mockSuccessResult(overrides = {}) {
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
  };
}

/**
 * executeGdscript 失败结果工厂（P1-3 阶段 B 用，先建骨架）。
 * 按 kind 生成对应失败形态，对齐 ExecuteGdscriptResult（src/gdscript-executor.ts）的字段形态。
 * 下游 parseGdscriptResult（src/tools/shared/errors.ts）只看字段形态不看 executor 内部行号：
 *   !compile_success → 报 compile_error；!run_success → 报 run_error。
 * 故 kind 对齐的是"字段组合 + 错误文本语义"，非 executor 具体 early-return（行号易漂移，不引）。
 * @param {{ kind?: 'compile'|'run'|'sandbox'|'binary'|'generic', compileError?: string, runError?: string, outputs?: any[] }} [opts]
 */
export function mockFailureResult(opts = {}) {
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
  };
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
 * @param {{ stdout?: string, [k: string]: any }} [overrides]
 */
export function mockSuccessSpawn(overrides = {}) {
  return {
    stdout: "Node 'root/Root/SomeNode' edited successfully",
    stderr: '',
    output: '',
    exitCode: 0,
    timedOut: false,
    ...overrides,
  };
}
