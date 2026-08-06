// test/scripts/check-contract.test.ts
// P1-6 check-contract.mjs 纯函数单测:验证 6 项校验的 pass/violation 分支。
import { describe, it, expect } from 'vitest';
import { runChecks, CHECKS } from '../../scripts/check-contract.mjs';

/** 构造一个合规工具(全部校验通过)。 */
function goodTool(name: string = 'good_tool'): Record<string, unknown> {
  return {
    name,
    group: 'core',
    description: 'A compliant tool',
    inputSchema: { type: 'object', properties: { action: { type: 'string' } } },
    readonly: false,
    longRunning: false,
    guarded: false,
    securityLevel: 'safe',
    riskDistribution: { read: 2, write: 1, destructive: 0, process: 0 },
    groupRequires: [],
    offlineCapable: true,
    needsGodot: false,
    needsEditor: false,
    gdScriptImpl: { headless: { exists: false, path: null }, editor: { exists: false, path: null } },
    relatedDefects: [],
    verification: { l1: 'extracted', l2: 'none', l3: 'unverified', lastRun: null },
    size: { descBytes: 10, schemaBytes: 20, totalBytes: 30 },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  };
}

/** 构造 mock matrix(1 个工具)。 */
function matrix(tool: Record<string, unknown>) {
  return { tools: [tool] };
}

describe('P1-6 check-contract runChecks', () => {
  it('合规工具:0 error 0 warning', () => {
    const r = runChecks(matrix(goodTool()));
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.totalChecks).toBe(CHECKS.length);  // 1 工具 × 6 校验
  });

  describe('C1: annotations 三 hint 必填', () => {
    it('缺 annotations → error', () => {
      const t = goodTool(); delete t.annotations;
      const r = runChecks(matrix(t));
      expect(r.errors.some(e => e.id === 'C1' && e.msg.includes('缺 annotations'))).toBe(true);
    });
    it('readOnlyHint 非 boolean → error', () => {
      const t = goodTool(); (t.annotations as Record<string, unknown>).readOnlyHint = 'yes';
      const r = runChecks(matrix(t));
      expect(r.errors.some(e => e.id === 'C1')).toBe(true);
    });
  });

  describe('C2: danger-api + destructive 必 guarded', () => {
    it('danger-api + destructive>0 + guarded=false → error', () => {
      const t = goodTool();
      t.securityLevel = 'danger-api';
      t.riskDistribution = { read: 0, write: 0, destructive: 1, process: 0 };
      t.guarded = false;
      const r = runChecks(matrix(t));
      expect(r.errors.some(e => e.id === 'C2')).toBe(true);
    });
    it('danger-api 但无 destructive action + guarded=false → 通过(组级标注非每工具必 guarded)', () => {
      const t = goodTool();
      t.securityLevel = 'danger-api';
      t.riskDistribution = { read: 2, write: 0, destructive: 0, process: 0 };
      t.guarded = false;
      const r = runChecks(matrix(t));
      expect(r.errors.some(e => e.id === 'C2')).toBe(false);
    });
  });

  describe('C3: safe + guarded 矛盾(warn)', () => {
    it('securityLevel=safe + guarded=true → warning', () => {
      const t = goodTool();
      t.securityLevel = 'safe';
      t.guarded = true;
      const r = runChecks(matrix(t));
      expect(r.warnings.some(w => w.id === 'C3')).toBe(true);
      expect(r.errors.some(e => e.id === 'C3')).toBe(false);  // warn 不 error
    });
  });

  describe('C4: offlineCapable 与 needsGodot 互斥', () => {
    it('offlineCapable=true + needsGodot=true → error', () => {
      const t = goodTool();
      t.offlineCapable = true;
      t.needsGodot = true;
      const r = runChecks(matrix(t));
      expect(r.errors.some(e => e.id === 'C4')).toBe(true);
    });
  });

  describe('C5: description + inputSchema', () => {
    it('description 为空 → error', () => {
      const t = goodTool(); t.description = '';
      const r = runChecks(matrix(t));
      expect(r.errors.some(e => e.id === 'C5' && e.msg.includes('description'))).toBe(true);
    });
    it('inputSchema.properties 缺失 → error', () => {
      const t = goodTool(); t.inputSchema = { type: 'object' };
      const r = runChecks(matrix(t));
      expect(r.errors.some(e => e.id === 'C5' && e.msg.includes('properties'))).toBe(true);
    });
    it('inputSchema.properties={} 通过(无参工具)', () => {
      const t = goodTool(); t.inputSchema = { type: 'object', properties: {} };
      const r = runChecks(matrix(t));
      expect(r.errors.some(e => e.id === 'C5')).toBe(false);
    });
  });

  describe('C6: riskDistribution(warn)', () => {
    it('riskDistribution undefined → warning(非 error)', () => {
      const t = goodTool(); delete t.riskDistribution;
      const r = runChecks(matrix(t));
      expect(r.warnings.some(w => w.id === 'C6')).toBe(true);
      expect(r.errors.some(e => e.id === 'C6')).toBe(false);
    });
    it('riskDistribution 全 0 → warning', () => {
      const t = goodTool();
      t.riskDistribution = { read: 0, write: 0, destructive: 0, process: 0 };
      const r = runChecks(matrix(t));
      expect(r.warnings.some(w => w.id === 'C6')).toBe(true);
    });
  });

  it('多工具混合:1 合规 + 1 违规 → 1 error', () => {
    const good = goodTool('good');
    const bad = goodTool('bad'); bad.description = '';
    const r = runChecks({ tools: [good, bad] });
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]!.tool).toBe('bad');
  });
});
