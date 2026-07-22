// execute_gdscript 崩溃取证套件测试（对照 UE 9b128514）
//
// 目标：在 spawn godot 之前，对【原始用户 code】算字节级 SHA-256，生成 executionId，
// 记一条 EXECUTE_BEGIN 结构化审计日志（不含原始 code，对齐 I-10），并把 executionId +
// scriptSha256 回填到结果——崩溃/超时后可凭日志反查到具体执行。
//
// 纯函数 buildExecAuditEvent 单元测试（不跑 godot）+ 源码文本契约测试（锁 log-before-spawn）。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { buildExecAuditEvent } from '../src/gdscript-executor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, '../src/gdscript-executor.ts'), 'utf8');

const base = { scriptPath: '/tmp/session/exec.gd', mode: 'snippet', autoload: false };

// ─── buildExecAuditEvent 单元（纯函数）──────────────────────────────────────

describe('buildExecAuditEvent — execute 取证事件', () => {
  it('对原始 code 算字节级 SHA-256 放入 scriptSha256', () => {
    const code = 'print("hello")';
    const expected = createHash('sha256').update(code, 'utf8').digest('hex');
    expect(buildExecAuditEvent({ ...base, code }).scriptSha256).toBe(expected);
  });

  it('返回 audit=EXECUTE_BEGIN 结构（对照 UE execute_python begin）', () => {
    const evt = buildExecAuditEvent({ ...base, code: 'var x = 1' });
    expect(evt.audit).toBe('EXECUTE_BEGIN');
    expect(evt.executionId).toBeTruthy();
    expect(typeof evt.executionId).toBe('string');
    expect(evt.scriptPath).toBe('/tmp/session/exec.gd');
    expect(evt.mode).toBe('snippet');
    expect(evt.autoload).toBe(false);
  });

  it('每次调用生成唯一 executionId', () => {
    const a = buildExecAuditEvent({ ...base, code: 'x' });
    const b = buildExecAuditEvent({ ...base, code: 'x' });
    expect(a.executionId).not.toBe(b.executionId);
  });

  it('不在事件里放原始 code（I-10 防凭据/敏感串泄露）', () => {
    const evt = buildExecAuditEvent({ ...base, code: 'SECRET_TOKEN_xyz_123' });
    expect(JSON.stringify(evt)).not.toContain('SECRET_TOKEN_xyz_123');
  });

  it('同一段 code 产生稳定 hash（崩溃后可比对溯源）', () => {
    const code = 'print(1)\n_mcp_done()';
    const a = buildExecAuditEvent({ ...base, code });
    const b = buildExecAuditEvent({ ...base, code });
    expect(a.scriptSha256).toBe(b.scriptSha256);
    expect(a.scriptSha256).toHaveLength(64); // sha256 hex
  });
});

// ─── executeGdscript 源码契约（锁 log-before-spawn 结构）─────────────────────

describe('executeGdscript EXECUTE_BEGIN 契约（源码文本）', () => {
  it('在 spawn godot 之前调用 buildExecAuditEvent 并记日志（log-before-exec）', () => {
    const callIdx = SRC.indexOf('buildExecAuditEvent(');
    const spawnIdx = SRC.indexOf('spawn(godotPath');
    expect(callIdx, 'buildExecAuditEvent 未被调用').toBeGreaterThan(-1);
    expect(spawnIdx, 'spawn(godotPath…) 未找到').toBeGreaterThan(-1);
    // 关键不变量：审计调用必须在 spawn 之前（UE 9b128514 的核心——执行前留痕）
    expect(callIdx).toBeLessThan(spawnIdx);
  });

  it('源码含 EXECUTE_BEGIN 审计标签 + scriptSha256', () => {
    expect(SRC).toContain('EXECUTE_BEGIN');
    expect(SRC).toContain('scriptSha256');
  });

  it('ExecuteGdscriptResult 回填 executionId + scriptSha256（崩溃可溯源）', () => {
    // 类型定义或返回字面量里出现这两个字段
    expect(SRC).toMatch(/executionId/);
    expect(SRC).toMatch(/scriptSha256/);
  });
});
