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
