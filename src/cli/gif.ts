/**
 * 批 4a:demo GIF CLI——`npx godot-mcp-enhanced gif <project> [options]`。
 * 链路:装 bridge → 起游戏(wait_for_bridge)→ freeze 锁起播 → 循环 N 窗:
 * 按键时间线(每窗开头注入一对 press/release)+ playtest.step 推帧 + take_screenshot →
 * resolveGameDataPath 取本机 PNG → pngjs 解码 → GIF89a 编码落盘。
 * 输入:--keys 显式序列(逗号分隔,小写);默认方向键循环(2048/snake);
 * --keys 或 --seed 未指定 keys 时按 seed 派生取样顺序(Node 侧 LCG,不依赖游戏 RNG)。
 */
import { join, dirname, resolve, sep } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { PNG } from 'pngjs';
import type { ToolContext } from '../types.js';
import { parseGodotConfig } from '../helpers.js';
import { findGodot } from '../core/godot-finder.js';
import * as ps from '../core/process-state.js';
import * as gameBridge from '../tools/game-bridge.js';
import * as runtime from '../tools/runtime.js';
import { sendToBridge, setBridgeProjectDir } from '../tools/game-bridge.js';
import { resolveGameDataPath } from '../tools/game-fs.js';
import { encodeGif, type RgbaFrame } from './gif-encoder.js';
import { confirmYesNo } from './confirm.js';
import { fileURLToPath } from 'url';

const __rootDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function resolveOpsScript(): string {
  const candidates = [
    join(__rootDir, 'build', 'scripts', 'godot_operations.gd'),
    join(__rootDir, 'src', 'scripts', 'godot_operations.gd'),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return candidates[0]!;
}

function makeCtx(): ToolContext {
  return {
    opsScript: resolveOpsScript(),
    findGodot,
    get runningProcess() { return ps.getRunningProcess(); },
    setRunningProcess(proc, skipBusyCheck?) { ps.setRunningProcess(proc, skipBusyCheck); },
    get outputBuffer() { return ps.getOutputBuffer(); },
    setOutputBuffer(buf: string[]) { ps.setOutputBuffer(buf); },
    get processStartTime() { return ps.getProcessStartTime(); },
    setProcessStartTime(t: number) { ps.setProcessStartTime(t); },
    get projectDir() { return ps.getProjectDir(); },
    setProjectDir(d: string) { ps.setProjectDir(d); },
    parseGodotConfig,
  };
}

/** Node 侧 LCG(seed 派生按键取样顺序;不依赖游戏 RNG,冻结策略与游戏随机解耦)。 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000;
}

export async function runGif(args: string[]): Promise<void> {
  const projectPath = args[0];
  if (!projectPath || !existsSync(join(projectPath, 'project.godot'))) {
    console.error('用法: gif <project-path> [--out <path>] [--fps 1-10] [--seconds N] [--keys up,left,…] [--seed N]');
    process.exit(2);
  }
  // B-1(审查):支持 `--name=value` 与 `--name value` 双形式——README 示例是空格形式,
  // 只认等号会静默回落默认值(breakout 的 --keys 失效 → GIF 内容实质错误)
  const opt = (name: string): string | undefined => {
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (a === `--${name}`) return args[i + 1];           // 空格形式(相邻消费)
      if (a.startsWith(`--${name}=`)) return a.split('=').slice(1).join('=');
    }
    return undefined;
  };
  const num = (name: string, fallback: number): number => {
    const v = opt(name);
    if (v === undefined) return fallback;
    const n = Number(v);
    if (!Number.isFinite(n)) {
      console.error(`--${name} 需要数字,收到 "${v}"`);
      process.exit(2);
    }
    return n;
  };
  const outArg = opt('out');
  const fps = Math.max(1, Math.min(10, num('fps', 4)));
  const seconds = Math.max(1, Math.min(30, num('seconds', 8)));
  const seed = num('seed', 42);
  const defaultKeys = ['up', 'right', 'down', 'left'];
  const keys = opt('keys')?.split(',').map(k => k.trim().toLowerCase()).filter(Boolean) ?? defaultKeys;

  const projectAbs = resolve(projectPath);
  const outPath = outArg
    ? resolve(process.cwd(), outArg)
    : join(projectAbs, 'dist', 'demo.gif');
  if (!outPath.startsWith(projectAbs + sep) && outPath !== projectAbs) {
    if (!(await confirmYesNo(`产物在项目外:${outPath}\n确认写入?`))) {
      console.error('已取消(项目内路径免确认,或用默认 dist/demo.gif)');
      process.exit(1);
    }
  }

  const ctx = makeCtx();
  console.log(`🎬 录制 demo GIF:${fps}fps × ${seconds}s = ${fps * seconds} 帧,seed=${seed}`);

  // ── setup(与 qa runner 同款链)───────────────────────────────────────────
  const install = await gameBridge.handleTool('game', { action: 'game_bridge_install', project_path: projectAbs }, ctx);
  const installText = install?.content[0]?.type === 'text' ? install.content[0].text : '';
  if (!installText.includes('already registered') && !installText.includes('success')) {
    console.error(`game_bridge_install 失败: ${installText.slice(0, 200)}`);
    process.exit(1);
  }
  setBridgeProjectDir(projectAbs);
  const run = await runtime.handleTool('runtime', {
    action: 'run_project', project_path: projectAbs, wait_for_bridge: true, bridge_timeout: 20, timeout: 120,
  }, ctx);
  const runText = run?.content[0]?.type === 'text' ? run.content[0].text : '';
  if (!runText.includes('Bridge ready')) {
    console.error(`run_project 失败: ${runText.slice(0, 200)}`);
    process.exit(1);
  }

  const frames: RgbaFrame[] = [];
  const capturedPngPaths: string[] = [];

  try {
    const delayCs = Math.round(100 / fps);
    const rnd = lcg(seed);

    const total = fps * seconds;
    const windowMs = 1000 / fps;
    for (let i = 0; i < total; i++) {
      const windowStart = Date.now();
      const key = keys[Math.floor(rnd() * keys.length)]!;
      // 直播模式注入(非 frozen:send_input_sequence 直接播放)——帧间隔由 wall 定时
      // 近似 fps(demo GIF 无帧级确定性诉求,spec B-1 只要求低频截图循环);
      // frozen+playtest.step 通道会被「game is frozen; unfreeze before stepping」拒
      const seq = await sendToBridge('send_input_sequence', {
        timeline: [
          { at_frame: 1, type: 'key', key, pressed: true },
          { at_frame: 3, type: 'key', key, pressed: false },
        ],
        settle_frames: 0,
      }, 20_000);
      if (seq.error) console.warn(`  ⚠ 按键注入失败(${seq.error.message})`);
      // 注:截图/注入耗时未计入窗口预算,实际帧率略低于 --fps(demo 场景可接受)
      const elapsed = Date.now() - windowStart;
      if (elapsed < windowMs) await new Promise(r => setTimeout(r, windowMs - elapsed));
      const shotUri = `user://mcp_gif_${i}.png`;
      const shot = await sendToBridge('take_screenshot', { path: shotUri }, 15_000);
      const sr = (shot.result ?? {}) as { success?: boolean; path?: string; size?: { x: number; y: number } };
      if (shot.error || sr.success !== true || typeof sr.path !== 'string') {
        console.warn(`  ⚠ 第 ${i + 1} 帧截图失败,跳过`);
        continue;
      }
      const local = resolveGameDataPath(projectAbs, sr.path);
      if (!local) {
        console.warn(`  ⚠ 无法解析 user:// 路径:${sr.path}(残留游戏侧)`);
        continue;
      }
      capturedPngPaths.push(local);
      const png = PNG.sync.read(readFileSync(local));
      frames.push({ width: png.width, height: png.height, data: new Uint8Array(png.data) });
      if ((i + 1) % (fps * 2) === 0) console.log(`  已采集 ${frames.length}/${total} 帧`);
    }
    if (frames.length < 2) {
      // 不用 process.exit:try 内 exit 旁路 finally 的 stop_project → 游戏进程残留(审查 I-1)
      throw new Error(`有效帧不足(${frames.length})`);
    }
    console.log(`  编码 ${frames.length} 帧 → ${outPath}`);
    const gif = encodeGif(frames, delayCs);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, gif);
    console.log(`✓ demo GIF 完成: ${outPath}(${(gif.length / 1024).toFixed(0)} KB,${frames[0]!.width}×${frames[0]!.height},${frames.length} 帧@${fps}fps)`);
  } finally {
    // teardown:停游戏(与 qa 同款,防进程残留)+ 清理 user:// 侧截图残留(审查 N-2)
    for (const f of capturedPngPaths) {
      try { if (existsSync(f)) unlinkSync(f); } catch { /* best-effort */ }
    }
    await runtime.handleTool('runtime', { action: 'stop_project' }, ctx).catch(() => {});
  }
}
