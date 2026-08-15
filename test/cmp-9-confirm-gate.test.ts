import { describe, it, expect } from 'vitest';
import { registerAllModules } from '../src/core/module-loader.js';
import { getActionRisks } from '../src/core/tool-registry.js';
import { requiresConfirmation } from '../src/core/guard.js';

// CMP-9 confirm gate 二期(2026-08-08):验证 engine call_method 触发确认令牌。
//
// 关键发现:confirm gate 已通过 CMP-9-A 的 actionRisks 声明自动生效——
// requiresConfirmation() 读 getActionRisk('engine', 'call_method'),
// 因 actionRisks.call_method = 'write'(非 'read'),返回 true 触发确认。
// 本测试守护这个行为,防回退。

registerAllModules();

describe('CMP-9 confirm gate: engine call_method 触发确认', () => {
  it('CMP-9gate-a: engine call_method actionRisk = write(非 read)', () => {
    const risks = getActionRisks('engine');
    expect(risks?.call_method).toBe('write');
  });

  it('CMP-9gate-b: requiresConfirmation(engine, call_method) = true(触发确认令牌)', () => {
    // call_method 是 write → requiresConfirmation 返回 true
    expect(requiresConfirmation('engine', { action: 'call_method', node_path: 'root', method: 'has_method' })).toBe(true);
  });

  it('CMP-9gate-c: engine 只读 action 不触发确认(class_info/search/get_inheritance)', () => {
    expect(requiresConfirmation('engine', { action: 'class_info', class: 'Node' })).toBe(false);
    expect(requiresConfirmation('engine', { action: 'search', query: 'Node' })).toBe(false);
    expect(requiresConfirmation('engine', { action: 'get_inheritance', class: 'Node' })).toBe(false);
  });

  it('CMP-9gate-d: requiresConfirmation 对无 action 参数返 false(向后兼容)', () => {
    expect(requiresConfirmation('engine', {})).toBe(false);
  });
});
