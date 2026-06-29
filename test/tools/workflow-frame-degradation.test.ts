import { describe, it, expect } from 'vitest';
import { extractFrameMetricsScript } from '../../src/tools/frame-verify/gdscripts.js';
import { classifyDegradation } from '../../src/tools/frame-verify/degradation.js';
import { createProofRun } from '../../src/tools/frame-verify/proof-bundle.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('frame_degradation 端到端契约（脚本生成 + 判据）', () => {
  it('生成的 GDScript 输出 consecutive_sims/first_frame_sims，classifyDegradation 能消费', () => {
    const script = extractFrameMetricsScript('user://proof/run_x');
    // 脚本必须输出这三个 key（后两个为 JSON 字符串）
    expect(script).toContain('"consecutive_sims"');
    expect(script).toContain('"first_frame_sims"');
    expect(script).toContain('"frame_count"');
  });

  it('GDScript 返回的 metrics 喂给 classifyDegradation 能正确判定退化', () => {
    // 模拟 GDScript 对 9 张全等帧返回的 metrics
    const consecutive = Array(8).fill(0.999);
    const firstFrame = Array(8).fill(1.0);
    const r = classifyDegradation({ frameCount: 9, consecutiveSims: consecutive, firstFrameSims: firstFrame });
    expect(r.degraded).toBe(true);
  });

  it('正常运动帧的 metrics 判定为不退化', () => {
    const consecutive = [0.75, 0.70, 0.68, 0.72, 0.65, 0.60, 0.58, 0.62];
    const firstFrame = [0.75, 0.55, 0.40, 0.30, 0.22, 0.18, 0.15, 0.20];
    const r = classifyDegradation({ frameCount: 9, consecutiveSims: consecutive, firstFrameSims: firstFrame });
    expect(r.degraded).toBe(false);
  });
});

describe('proof-bundle createProofRun 集成（frame_sequence 归档目标）', () => {
  it('createProofRun 在项目内创建 proof/<runId>/ 目录', () => {
    const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-proof-'));
    try {
      const run = createProofRun(tmpProject);
      expect(run.runId).toMatch(/^run_\d+$/);
      expect(run.dir).toContain('proof');
      expect(fs.existsSync(run.dir)).toBe(true);
      expect(run.dir.startsWith(tmpProject)).toBe(true);
    } finally {
      fs.rmSync(tmpProject, { recursive: true, force: true });
    }
  });
});
