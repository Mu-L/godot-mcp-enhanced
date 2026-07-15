import { spawn } from 'child_process';
import { forceKillTree } from './process-state.js';
import { buildSafeEnv } from '../helpers.js';

export interface BlenderRunResult {
  exitCode: number | null;  // null = 超时被杀
  stdout: string;
  stderr: string;
}

/**
 * spawn blender headless + 累积 stdio + 超时 forceKillTree 杀进程树。
 * 对称 runGodotHeadless。不做成败判断（exitCode 任值都 resolve），调用方自行判断。
 */
export function runBlenderHeadless(
  args: string[],
  blenderPath: string,
  timeoutMs: number = 60_000,
): Promise<BlenderRunResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(blenderPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env: buildSafeEnv() });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    proc.stdout?.on('data', (d: Buffer) => stdoutChunks.push(d));
    proc.stderr?.on('data', (d: Buffer) => stderrChunks.push(d));

    const timer = setTimeout(() => {
      forceKillTree(proc);
      resolve({
        exitCode: null,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
      });
    }, timeoutMs);

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`runBlenderHeadless: failed to spawn ${blenderPath}: ${err.message}`));
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
      });
    });
  });
}
