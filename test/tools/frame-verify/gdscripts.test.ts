import { describe, it, expect } from 'vitest';
import { extractFrameMetricsScript, referenceSimScript } from '../../../src/tools/frame-verify/gdscripts.js';

describe('extractFrameMetricsScript', () => {
  it('embeds framesDir into the script', () => {
    const s = extractFrameMetricsScript('user://proof/run_1');
    expect(s).toContain('user://proof/run_1');
  });

  it('uses 32x32 resize and L2 normalization', () => {
    const s = extractFrameMetricsScript('user://x');
    expect(s).toContain('resize(32, 32)');
    expect(s).toContain('32 * 32 * 3');
    // L2 归一化：除以 sqrt(sum_sq)+eps
    expect(s).toMatch(/sqrt\(sum_sq\)/);
  });

  it('lists frame_*.png sorted and outputs consecutive + first_frame sims as JSON', () => {
    const s = extractFrameMetricsScript('user://x');
    expect(s).toContain('frame_');
    expect(s).toContain('.png');
    expect(s).toContain('JSON.stringify');
    expect(s).toContain('"consecutive_sims"');
    expect(s).toContain('"first_frame_sims"');
    expect(s).toContain('"frame_count"');
  });

  it('guards against empty dir (frame_count < 2 returns error)', () => {
    const s = extractFrameMetricsScript('user://x');
    expect(s).toContain('< 2');
  });
});

describe('referenceSimScript', () => {
  it('computes cosine sim between screenshot and reference embeddings', () => {
    const s = referenceSimScript('user://shot.png', 'user://ref.png');
    expect(s).toContain('user://shot.png');
    expect(s).toContain('user://ref.png');
    expect(s).toContain('resize(32, 32)');
    expect(s).toContain('"reference_sim"');
  });
});
