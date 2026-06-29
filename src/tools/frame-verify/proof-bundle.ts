// proof bundle 目录管理 —— 借鉴 recording.ts:67-73 的 recording_<timestamp> 命名模式。
// 把一次验证运行的所有帧 + metrics 归档到 proof/<runId>/。

import * as fs from 'fs';
import * as path from 'path';

/** 单次 proof run 最大字节(B3:防帧捕获失控撑爆磁盘)。 */
const MAX_PROOF_BYTES = 100 * 1024 * 1024; // 100MB

export interface ProofRun {
  runId: string;
  dir: string;   // 绝对路径
  bytes: number; // 已归档字节(B3 配额跟踪)
}

export function createProofRun(projectPath: string): ProofRun {
  // runId 用 Date.now() 保证唯一（TS 服务端可用 Date，非 Workflow 脚本限制范围）
  const runId = `run_${Date.now()}`;
  const dir = path.join(projectPath, 'proof', runId);
  fs.mkdirSync(dir, { recursive: true });
  return { runId, dir, bytes: 0 };
}

export function archiveFrame(run: ProofRun, index: number, pngBuffer: Buffer): string {
  // B3:累计字节,超 100MB 配额拒绝(防失控帧捕获撑爆磁盘)
  run.bytes += pngBuffer.length;
  if (run.bytes > MAX_PROOF_BYTES) {
    throw new Error(`proof bundle 配额超限: ${run.bytes} bytes > ${MAX_PROOF_BYTES}`);
  }
  const name = `frame_${String(index).padStart(2, '0')}.png`;
  fs.writeFileSync(path.join(run.dir, name), pngBuffer);
  return name;
}

export function writeMetrics(run: ProofRun, metrics: Record<string, unknown>): string {
  const name = 'metrics.json';
  fs.writeFileSync(path.join(run.dir, name), JSON.stringify(metrics, null, 2), 'utf-8');
  return name;
}

/** 清理 proof run 临时目录(B1:验证完成后回收,防 proof/ 无限堆积)。
 *  Windows 句柄占用等致 rmSync 失败时忽略(下次 cleanup 兜底)。 */
export function cleanupProofRun(run: ProofRun): void {
  try {
    fs.rmSync(run.dir, { recursive: true, force: true });
  } catch {
    // 忽略:EBUSY/EPERM(Windows 句柄占用)等,残留目录待后续手动/下次清理
  }
}
