// test/capability/diff-matrix.test.ts
import { describe, it, expect } from 'vitest';
import { diffMatrices } from '../../src/capability/diff-matrix.js';
import type { ToolCapability } from '../../src/capability/schema.js';

const cap = (name: string, extra: Partial<ToolCapability> = {}): ToolCapability => ({
  name,
  group: 'g',
  description: '',
  inputSchema: {},
  requiredParams: [],
  optionalParams: [],
  readonly: false,
  longRunning: false,
  guarded: false,
  securityLevel: 'safe',
  groupRequires: [],
  offlineCapable: true,
  needsGodot: false,
  needsEditor: false,
  gdScriptImpl: {
    headless: { exists: false, path: null },
    editor: { exists: false, path: null },
  },
  relatedDefects: [],
  verification: { l1: 'extracted', l2: 'none', l3: 'unverified', lastRun: null },
  ...extra,
});

describe('diffMatrices', () => {
  it('detects added/removed tools', () => {
    const prev = [cap('a'), cap('b')];
    const curr = [cap('a'), cap('c')];
    const r = diffMatrices(prev, curr);
    expect(r.added).toEqual(['c']);
    expect(r.removed).toEqual(['b']);
    expect(r.hasDrift).toBe(true);
  });

  it('detects securityLevel downgrade (safe → danger-api)', () => {
    const prev = [cap('a', { securityLevel: 'safe' })];
    const curr = [cap('a', { securityLevel: 'danger-api' })];
    const r = diffMatrices(prev, curr);
    expect(r.securityLevelDowngrades).toEqual([{ name: 'a', from: 'safe', to: 'danger-api' }]);
  });

  it('detects requiredParams contract change', () => {
    const prev = [cap('a', { requiredParams: ['x'] })];
    const curr = [cap('a', { requiredParams: ['x', 'y'] })];
    const r = diffMatrices(prev, curr);
    expect(r.contractChanges).toContain('a');
  });

  it('no drift when identical', () => {
    const same = [cap('a')];
    expect(diffMatrices(same, same).hasDrift).toBe(false);
  });

  // P1-2: annotations hint 漂移检测
  it('P1-2: detects idempotentHint flip false → true as annotationChange', () => {
    const prev = [cap('a', { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } })];
    const curr = [cap('a', { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } })];
    const r = diffMatrices(prev, curr);
    expect(r.annotationChanges).toEqual([
      { name: 'a', field: 'idempotentHint', from: false, to: true },
    ]);
    expect(r.hasDrift).toBe(true);
  });

  it('P1-2: undefined annotations treated as all-false (baseline compat)', () => {
    // 老基线 matrix 无 annotations 字段 → 视为全 false。curr 有 idempotentHint=true → 应报 drift
    const prev = [cap('a')]; // 无 annotations
    const curr = [cap('a', { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } })];
    const r = diffMatrices(prev, curr);
    expect(r.annotationChanges).toContainEqual({ name: 'a', field: 'idempotentHint', from: false, to: true });
  });
});
