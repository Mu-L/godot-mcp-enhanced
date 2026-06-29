import { spawn } from 'child_process';
import { forceKillTree } from './process-state.js';
import { buildSafeEnv } from '../helpers.js';

export interface GodotRunResult {
  exitCode: number | null;  // null = 超时被杀
  stdout: string;
  stderr: string;
}

/**
 * spawn Godot headless + 累积 stdio + 超时 forceKillTree 杀进程树,返回 {exitCode,stdout,stderr}。
 *
 * 不做成败判断(exitCode 任值都 resolve),供 runImport(套 code 判断)与 check-gdscript(任意 exit 解析 stderr)共用。
 * 超时 → resolve {exitCode: null}(调用方自行判断);spawn 失败 → reject。
 * 禁止在调用方重写 spawn——继承 forceKillTree 防 CI Godot 卡住留僵尸。
 */
export function runGodotHeadless(
  args: string[],
  godotPath: string,
  timeoutMs: number = 60_000,
): Promise<GodotRunResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(godotPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env: buildSafeEnv() });

    // C-PERF-01: 用 Buffer[] 避免 O(n²) 字符串拼接
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
      // 错误文本保留 "failed to spawn" 子串,与历史 import-check 测试断言兼容
      reject(new Error(`runGodotHeadless: failed to spawn ${godotPath}: ${err.message}`));
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
