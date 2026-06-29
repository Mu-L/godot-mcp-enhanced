import { describe, it, expect } from 'vitest';
import { validateScreenshotAssertion } from '../../src/tools/workflow.js';

describe('validateScreenshotAssertion (增强)', () => {
  it('accepts reference_path as optional string', () => {
    const r = validateScreenshotAssertion({ description: 'd', reference_path: 'user://ref.png' });
    expect(r.valid).toBe(true);
  });

  it('rejects non-string reference_path', () => {
    const r = validateScreenshotAssertion({ description: 'd', reference_path: 123 });
    expect(r.valid).toBe(false);
    expect(r.error).toContain('reference_path');
  });

  it('accepts sim_threshold as optional number', () => {
    const r = validateScreenshotAssertion({ description: 'd', reference_path: 'user://r.png', sim_threshold: 0.9 });
    expect(r.valid).toBe(true);
  });

  it('still validates expect_present as string array', () => {
    const r = validateScreenshotAssertion({ description: 'd', expect_present: 'notarray' });
    expect(r.valid).toBe(false);
  });

  it('still requires description', () => {
    const r = validateScreenshotAssertion({ reference_path: 'user://r.png' });
    expect(r.valid).toBe(false);
  });
});
