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
});
