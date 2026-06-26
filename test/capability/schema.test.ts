// test/capability/schema.test.ts
import { describe, it, expect } from 'vitest';
import { classifySecurityLevel } from '../../src/capability/schema.js';

describe('classifySecurityLevel', () => {
  it('danger-api wins over guarded', () => {
    expect(classifySecurityLevel({ dangerApiHit: true, guarded: true })).toBe('danger-api');
  });
  it('guarded when no danger hit but guarded', () => {
    expect(classifySecurityLevel({ dangerApiHit: false, guarded: true })).toBe('guarded');
  });
  it('safe otherwise', () => {
    expect(classifySecurityLevel({ dangerApiHit: false, guarded: false })).toBe('safe');
  });
});
