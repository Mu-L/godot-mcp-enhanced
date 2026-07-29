/**
 * E2E Resilience (headless, CI) — 真进程验证 process-state 孤儿清理契约。
 * 补 report4 P0-1③: 强杀后扫孤儿 PID（_spawnedGodotPids）应为空。
 * 与 process-state.test.js:583（假 PID 单元）互补——spawn 真 headless Godot 子进程，
 * 验 killOrphanGodotProcesses 真清理真进程（非 mock isPidAlive）。--headless 无 GUI，CI 可跑。
 *
 * Spike（fixture 驻留）：brief 原 `--path test/e2e-scene` 实测立即退出（fixture 主脚本
 * test_helper.gd 仅 _ready，headless 无主循环保持存活）→ 首断言红（非 bug，是 fixture 问题）。
 * 改用专用 fixture `test/fixtures/e2e-resilience`（main.gd 含 _process 保持主循环存活），
 * 实测 --headless 模式 1.5s/3s 后进程仍存活。fixture 选择理由见 task-1-report.md。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'fs';
import { spawn, type ChildProcess } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  registerSpawnedGodotPid,
  getSpawnedGodotPids,
  killOrphanGodotProcesses,
  resetState,
} from '../src/core/process-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GODOT_PATH = process.env.GODOT_PATH || '';
const hasGodot = existsSync(GODOT_PATH);
// 专用 fixture：main.gd 含 _process 保持 Godot 主循环存活（--headless 下不自动退出）。
// brief 原 e2e-scene fixture 立即退出 → 改用此专用 fixture（spike 解决，详见 report）。
const FIXTURE_PROJECT = resolve(__dirname, 'fixtures/e2e-resilience');

if (!hasGodot) {
  process.stderr.write(
    `[E2E-SKIP] 未找到 GODOT_PATH (${GODOT_PATH})。e2e-resilience-headless 将跳过。设置 GODOT_PATH 启用。\n`,
  );
}

function isPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/**
 * 轮询等待 PID 死亡（最多 timeoutMs）。
 * 必要性：killOrphanGodotProcesses 内部用 spawn('taskkill', ...) 异步触发，函数返回时
 * taskkill 子进程可能尚未完成。直接断言 isPidAlive 会与 taskkill 完成时序竞态。
 * 轮询给 taskkill ~50ms 数量级的执行时间，CI/本地均稳定。
 */
async function waitForPidDeath(pid: number, timeoutMs = 2000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isPidAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

/** spawn 真 headless Godot 驻留子进程（main.gd 的 _process 保持主循环存活，不立即退）。 */
function spawnHeadlessGodot(): ChildProcess {
  return spawn(GODOT_PATH, ['--headless', '--path', FIXTURE_PROJECT], {
    stdio: 'ignore',
    env: { ...process.env },
  });
}

describe.skipIf(!hasGodot)('e2e-resilience (headless): 孤儿进程清理真进程契约', () => {
  let children: ChildProcess[] = [];

  afterEach(async () => {
    for (const c of children) { try { c.kill('SIGKILL'); } catch { /* 已退 */ } }
    children = [];
    resetState();
  }, 30_000);

  it('注册的真 headless Godot 进程被 killOrphanGodotProcesses 清理（集合清空 + 进程真死）', async () => {
    const proc = spawnHeadlessGodot();
    children.push(proc);
    const pid = proc.pid!;

    await new Promise((r) => setTimeout(r, 1500)); // 等就绪
    expect(isPidAlive(pid), 'headless Godot 应已启动并存活').toBe(true);

    registerSpawnedGodotPid(pid); // 模拟 run_project:224 注册
    expect(getSpawnedGodotPids()).toContain(pid);

    const killed = await killOrphanGodotProcesses();

    expect(getSpawnedGodotPids()).not.toContain(pid);
    // taskkill 异步：轮询等死亡再断言（防竞态，详见 waitForPidDeath 注释）
    const died = await waitForPidDeath(pid);
    expect(died, '孤儿清理后进程应已死').toBe(true);
    expect(killed).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it('killOrphanGodotProcesses 幂等：二次调用清 0（resetState 清 throttle 后，集合空→语义幂等）', async () => {
    const proc = spawnHeadlessGodot();
    children.push(proc);
    const pid = proc.pid!;
    await new Promise((r) => setTimeout(r, 1500));
    registerSpawnedGodotPid(pid);

    await killOrphanGodotProcesses();
    // 等首杀完成（taskkill 异步），保证二次调用读到的状态稳定
    await waitForPidDeath(pid);
    // 关键：清 _lastOrphanScanTime（否则二次调用命中 process-state.ts:378 的 30s throttle 短路
    // → return 0，测的是"节流短路"非"集合空→语义幂等"，与 A0 防假绿使命相悖）。
    // resetState 同时清 _spawnedGodotPids（首杀已清空，再清为 no-op）+ _lastOrphanScanTime=0
    // → Date.now()-0 远 > 30s，二次调用进扫描 → 集合已空 → 循环不进 → return 0（真语义幂等）。
    resetState();
    const secondCall = await killOrphanGodotProcesses();
    expect(secondCall, '二次调用应清 0（集合空→语义幂等，非 throttle 短路）').toBe(0);
    expect(getSpawnedGodotPids()).not.toContain(pid);
  }, 30_000);
});
