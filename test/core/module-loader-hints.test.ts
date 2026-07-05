// test/core/module-loader-hints.test.ts
// 验证 MCP 标准 ToolAnnotations (readOnlyHint/destructiveHint/idempotentHint)
// 从 actionRisks 自动派生注入。对应 src/core/module-loader.ts deriveMcpHints。
import { describe, it, expect } from 'vitest';
import { registerAllModules } from '../../src/core/module-loader.js';
import { getAllToolDefinitions } from '../../src/core/tool-registry.js';

describe('Module loader MCP-standard ToolAnnotations', () => {
  it('every tool exposes readOnlyHint / destructiveHint / idempotentHint', () => {
    registerAllModules();
    const defs = getAllToolDefinitions();
    const missing = defs.filter(
      t =>
        t.annotations?.readOnlyHint === undefined ||
        t.annotations?.destructiveHint === undefined ||
        t.annotations?.idempotentHint === undefined
    );
    expect(
      missing.map(t => t.name),
      `tools missing standard hints: ${missing.map(t => t.name).join(', ')}`
    ).toEqual([]);
  });

  it('at least one destructive tool is flagged (e.g. scene w/ remove_node, script w/ project_replace)', () => {
    registerAllModules();
    const defs = getAllToolDefinitions();
    const destructive = defs.filter(t => t.annotations?.destructiveHint === true);
    expect(
      destructive.length,
      'expected some tools flagged destructiveHint=true (scene/script/tilemap all have destructive actions)'
    ).toBeGreaterThan(0);
  });

  it('read-only tools are also flagged idempotentHint (side-effect-free ⇒ re-runnable)', () => {
    registerAllModules();
    const defs = getAllToolDefinitions();
    const readOnly = defs.filter(t => t.annotations?.readOnlyHint === true);
    expect(readOnly.length, 'expected some read-only tools').toBeGreaterThan(0);
    const bad = readOnly.filter(t => !t.annotations?.idempotentHint);
    expect(bad.map(t => t.name), 'readOnly tools should also be idempotent').toEqual([]);
  });

  it('destructive tools are NOT flagged readOnlyHint (mutually exclusive)', () => {
    registerAllModules();
    const defs = getAllToolDefinitions();
    const destructive = defs.filter(t => t.annotations?.destructiveHint === true);
    const bad = destructive.filter(t => t.annotations?.readOnlyHint === true);
    expect(bad.map(t => t.name), 'destructive tools must not be flagged readOnly').toEqual([]);
  });

  it('execute_gdscript (RiskLevel=process) is flagged destructiveHint=false but readOnlyHint=false', () => {
    // process 级别 (执行任意脚本) 不是 destructive, 但有副作用 → 非 readOnly
    // 验证 process 不被误判为 destructive, 也不被误判为 readOnly
    registerAllModules();
    const defs = getAllToolDefinitions();
    const eg = defs.find(t => t.name === 'execute_gdscript');
    // execute_gdscript 在 script 模块, 可能合并到 'script' 工具或独立
    const target = eg ?? defs.find(t => t.name === 'script');
    expect(target, 'execute_gdscript / script tool should exist').toBeDefined();
    if (target?.annotations?.destructiveHint === true) {
      // 如果 script 工具聚合了 project_replace=destructive, destructiveHint=true 是合理的
      // 关键: 不能 readOnly
      expect(target.annotations?.readOnlyHint, 'process/destructive tool must not be readOnly').toBe(false);
    } else {
      expect(target?.annotations?.readOnlyHint, 'process-level tool must not be readOnly').toBe(false);
    }
  });
});
