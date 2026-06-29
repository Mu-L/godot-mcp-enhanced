// test/core/tool-registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { registerModule, clearRegistry, getActionRisk, getActionRisks, getToolMeta } from '../../src/core/tool-registry.js';

describe('ToolMeta actionRisks', () => {
  beforeEach(() => clearRegistry());

  it('派生 readonly：全 read → readonly=true', () => {
    registerModule({
      getToolDefinitions: () => [],
      handleTool: async () => null,
      TOOL_META: { demo: { actionRisks: { query: 'read', list: 'read' } } },
    });
    expect(getToolMeta('demo')?.readonly).toBe(true);
  });

  it('派生 readonly：含非 read → readonly=false', () => {
    registerModule({
      getToolDefinitions: () => [],
      handleTool: async () => null,
      TOOL_META: { demo: { actionRisks: { query: 'read', write: 'write' } } },
    });
    expect(getToolMeta('demo')?.readonly).toBe(false);
  });

  it('A-10 隐式注册：TOOL_META 条目既无 actionRisks 也无显式 readonly → readonly=false', () => {
    // A-10 自动注册分支的覆盖补全：当 TOOL_META 提供了空 meta（既无 actionRisks 也无 readonly）
    // 时，派生 readonly 应回退到 false（非 true）。该分支逻辑未在迁移中改动，此处补测试坐实契约。
    registerModule({
      getToolDefinitions: () => [],
      handleTool: async () => null,
      TOOL_META: { demo: {} },
    });
    expect(getToolMeta('demo')?.readonly).toBe(false);
  });

  it('显式 readonly 覆盖派生', () => {
    registerModule({
      getToolDefinitions: () => [],
      handleTool: async () => null,
      TOOL_META: { demo: { readonly: true, actionRisks: { write: 'write' } } },
    });
    expect(getToolMeta('demo')?.readonly).toBe(true);
  });

  it('getActionRisk 返回声明的 risk', () => {
    registerModule({
      getToolDefinitions: () => [],
      handleTool: async () => null,
      TOOL_META: { demo: { actionRisks: { remove: 'destructive' } } },
    });
    expect(getActionRisk('demo', 'remove')).toBe('destructive');
    expect(getActionRisk('demo', 'unknown')).toBeUndefined();
    expect(getActionRisk('absent', 'x')).toBeUndefined();
  });

  it('getActionRisks 返回完整映射', () => {
    registerModule({
      getToolDefinitions: () => [],
      handleTool: async () => null,
      TOOL_META: { demo: { actionRisks: { a: 'read', b: 'write' } } },
    });
    expect(getActionRisks('demo')).toEqual({ a: 'read', b: 'write' });
  });
});
