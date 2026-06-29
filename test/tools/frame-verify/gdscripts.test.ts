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

describe('GDScript 注入防御（gdEscape）—— CRITICAL: gdscript-template-injection fix-forward', () => {
  // 闭串注入载荷：企图用 ") 结束字符串字面量并注入任意 GDScript（读任意文件）。
  // 用 String.fromCharCode 构造换行/反斜杠，规避 Edit 转义被解析为字面字符的陷阱。
  const NL = String.fromCharCode(10);
  const BS = String.fromCharCode(92);
  const breakout = ['")', 'FileAccess.open("/etc/passwd", FileAccess.READ)', '#'].join(NL);

  it('extractFrameMetricsScript 转义 framesDir 防闭串注入', () => {
    const s = extractFrameMetricsScript(breakout);
    // 注入载荷不得原样出现（闭串 " 与真实换行均被 gdEscape 转义 → 注入失败）
    expect(s).not.toContain(breakout);
    // 双引号被转义为 \"（证明 gdEscape 生效）
    expect(s).toContain(BS + '"');
  });

  it('referenceSimScript 转义 referencePath 防闭串注入', () => {
    const s = referenceSimScript('user://shot.png', breakout);
    expect(s).not.toContain(breakout);
    expect(s).toContain(BS + '"');
  });

  it('referenceSimScript 转义 screenshotPath 防闭串注入', () => {
    const s = referenceSimScript(breakout, 'user://ref.png');
    expect(s).not.toContain(breakout);
    expect(s).toContain(BS + '"');
  });
});
