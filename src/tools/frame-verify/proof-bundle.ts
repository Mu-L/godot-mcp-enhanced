// proof bundle 目录管理 —— 借鉴 recording.ts:67-73 的 recording_<timestamp> 命名模式。
// 把一次验证运行的所有帧 + metrics 归档到 proof/<runId>/。

import * as fs from 'fs';
import * as path from 'path';

export interface ProofRun {
  runId: string;
  dir: string;   // 绝对路径
}

export function createProofRun(projectPath: string): ProofRun {
  // runId 用 Date.now() 保证唯一（TS 服务端可用 Date，非 Workflow 脚本限制范围）
  const runId = `run_${Date.now()}`;
  const dir = path.join(projectPath, 'proof', runId);
  fs.mkdirSync(dir, { recursive: true });
  return { runId, dir };
}

export function archiveFrame(run: ProofRun, index: number, pngBuffer: Buffer): string {
  const name = `frame_${String(index).padStart(2, '0')}.png`;
  fs.writeFileSync(path.join(run.dir, name), pngBuffer);
  return name;
}

export function writeMetrics(run: ProofRun, metrics: Record<string, unknown>): string {
  const name = 'metrics.json';
  fs.writeFileSync(path.join(run.dir, name), JSON.stringify(metrics, null, 2), 'utf-8');
  return name;
}
