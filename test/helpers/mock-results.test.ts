/**
 * P1-3 阶段 B（2026-07-31）：mock-results 工厂自测。
 *
 * 工厂被 16+ 测试文件复用，本身必须有保障。验证：
 *   - mockSuccessResult：默认 10 字段 + overrides 覆盖
 *   - mockFailureResult：4 类 kind 的字段正确性（对齐 src/gdscript-executor.ts 真实失败分支）
 *   - mockSuccessSpawn：默认字段 + overrides
 */
import { describe, it, expect } from 'vitest';
import { mockSuccessResult, mockFailureResult, mockSuccessSpawn } from './mock-results.js';

describe('mockSuccessResult', () => {
  it('默认返回完整 10 字段成功对象', () => {
    const r = mockSuccessResult();
    expect(r).toMatchObject({
      success: true,
      compile_success: true,
      compile_error: '',
      errors: [],
      run_success: true,
      run_error: '',
      outputs: [],
      raw_output: '',
      duration_ms: 100,
    });
  });

  it('overrides 覆盖指定字段（outputs 业务特定）', () => {
    const r = mockSuccessResult({
      outputs: [{ key: 'result', value: '{"ok":true}' }],
      duration_ms: 5,
    });
    expect(r.outputs).toEqual([{ key: 'result', value: '{"ok":true}' }]);
    expect(r.duration_ms).toBe(5);
    // 未覆盖字段保持默认
    expect(r.success).toBe(true);
    expect(r.compile_success).toBe(true);
  });
});

describe('mockFailureResult', () => {
  it('kind=compile：compile_success=false + compile_error 非空', () => {
    const r = mockFailureResult({ kind: 'compile' });
    expect(r.success).toBe(false);
    expect(r.compile_success).toBe(false);
    expect(r.run_success).toBe(false);
    expect(r.compile_error).not.toBe('');
  });

  it('kind=run：编译过（compile_success=true）但运行失败', () => {
    const r = mockFailureResult({ kind: 'run', runError: 'null ref' });
    expect(r.compile_success).toBe(true);
    expect(r.run_success).toBe(false);
    expect(r.run_error).toBe('null ref');
  });

  it('kind=sandbox：compile_error 含 sandbox violation', () => {
    const r = mockFailureResult({ kind: 'sandbox' });
    expect(r.compile_success).toBe(false);
    expect(r.compile_error).toContain('Sandbox violation');
  });

  it('kind=binary：compile_error 含 binary not found', () => {
    const r = mockFailureResult({ kind: 'binary' });
    expect(r.compile_success).toBe(false);
    expect(r.compile_error).toContain('binary not found');
  });

  it('kind=generic（默认）：全失败字段', () => {
    const r = mockFailureResult();
    expect(r.success).toBe(false);
    expect(r.compile_success).toBe(false);
    expect(r.run_success).toBe(false);
  });

  it('自定义 compileError 覆盖默认', () => {
    const r = mockFailureResult({ kind: 'compile', compileError: 'custom error' });
    expect(r.compile_error).toBe('custom error');
  });
});

describe('mockSuccessSpawn', () => {
  it('默认返回成功 spawn 对象', () => {
    const r = mockSuccessSpawn();
    expect(r.exitCode).toBe(0);
    expect(r.timedOut).toBe(false);
    expect(r.stderr).toBe('');
  });

  it('overrides 覆盖 stdout', () => {
    const r = mockSuccessSpawn({ stdout: 'custom output' });
    expect(r.stdout).toBe('custom output');
    expect(r.exitCode).toBe(0);
  });
});
