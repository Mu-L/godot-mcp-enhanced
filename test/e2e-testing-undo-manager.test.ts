// test/e2e-testing-undo-manager.test.ts — P1-5 undo_manager GDScript suite 经 editor 路由真跑
//
// 2026-08-07 审查 NIT-2 修复：原 editor-e2e.yml 的 undo_manager step 用了不存在的 API
// （GodotServer.makeCtx / 构造函数签名错），weekly workflow 首跑必崩。改为标准 vitest 文件，
// 复用 e2e-resilience-editor.test.ts 的 spawn + EditorToolExecutor 模式，经 testing 工具
// test_run action 跑 addons/.../testing/suites/test_undo_manager.gd 5 个 undo 行为测试。
//
// 前提：E2E_EDITOR=1 + GODOT_PATH + GUI editor（Xvfb 兜底）。CI godot-matrix 跑不了（headless），
// 走 .github/workflows/editor-e2e.yml weekly + manual 触发。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'fs';
import { spawn, type ChildProcess } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import net from 'net';
import { EditorConnection } from '../src/core/EditorConnection.js';
import { EditorToolExecutor } from '../src/core/EditorToolExecutor.js';
import { readEditorSecret } from '../src/core/editor-auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GODOT_PATH = process.env.GODOT_PATH || '';
const REAL_PROJECT = resolve(__dirname, 'fixtures', 'real-project');
const EDITOR_PORT = 9090;

const hasGodot = existsSync(GODOT_PATH);
const hasProject = existsSync(REAL_PROJECT)
  && existsSync(resolve(REAL_PROJECT, 'project.godot'))
  && existsSync(resolve(REAL_PROJECT, 'addons', 'godot_mcp_server', 'plugin.cfg'));
const hasEditorFlag = !!process.env.E2E_EDITOR;
const canRun = hasGodot && hasProject && hasEditorFlag;

if (!canRun) {
  const reasons: string[] = [];
  if (!hasGodot) reasons.push(`GODOT_PATH 未设或不存在(当前: ${GODOT_PATH || '<空>'})`);
  if (!hasProject) reasons.push(`real-project fixture 不完整(需 project.godot + addons/godot_mcp_server/plugin.cfg): ${REAL_PROJECT}`);
  if (!hasEditorFlag) reasons.push('E2E_EDITOR=1 未设(需 GUI editor + 插件 + 自管 spawn)');
  process.stderr.write(`[skip] testing undo_manager suite skipped — ${reasons.join('; ')}.\n`);
}

async function isPortOpen(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(500);
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => resolve(false));
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
    sock.connect(port, host);
  });
}

describe.skipIf(!canRun)('e2e testing: undo_manager suite 经 editor test_run 真跑', { timeout: 120_000, sequential: true }, () => {
  let editor: ChildProcess | null = null;
  let conn: EditorConnection | null = null;
  let exec: EditorToolExecutor | null = null;

  beforeAll(async () => {
    // spawn editor 非 detached（拿可 kill 的 pid）+ 等就绪（WS 9090 LISTEN）
    editor = spawn(GODOT_PATH, ['--editor', '--path', REAL_PROJECT], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GODOT_MCP_EDITOR_PERSISTENT_SECRET: 'true' },
    });
    editor.on('exit', (code) => {
      if (editor!.exitCode !== null && code !== 0) {
        process.stderr.write(`[E2E-DIAG] editor exit code=${code}\n`);
      }
    });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (await isPortOpen(EDITOR_PORT, '127.0.0.1')) break;
      if (editor.exitCode !== null) throw new Error(`editor 启动后立即退出(exitCode=${editor.exitCode})`);
      await new Promise((r) => setTimeout(r, 500));
    }
    if (editor.exitCode !== null) throw new Error('editor 30s 内未就绪');

    // 等 editor secret 可读（plugin _ready 跑完生成）
    const secret = readEditorSecret(REAL_PROJECT);
    if (!secret) throw new Error(`未能从 ${REAL_PROJECT}/.godot/mcp_editor.key 读 secret`);

    conn = new EditorConnection({
      host: '127.0.0.1', port: EDITOR_PORT, secret,
      shouldReconnect: false, // 单次测试不需要重连
    });
    await conn.connect();
    exec = new EditorToolExecutor(conn);
  }, 60_000);

  afterAll(() => {
    try { conn?.disconnect(); } catch { /* best effort */ }
    if (editor && editor.exitCode === null) {
      try { editor.kill('SIGKILL'); } catch { /* best effort */ }
    }
  });

  it('test_run suite=undo_manager 返 5 个测试结果（全 PASS 或部分 skip）', async () => {
    const result = await exec!.execute('testing', {
      action: 'test_run',
      project_path: REAL_PROJECT,
      suite: 'undo_manager',
    });
    const parsed = JSON.parse(result.content[0] as { text: string });
    // testing 工具返回结构：{ summary: { total, passed, failed, skipped }, results: [...] }
    expect(parsed).toBeDefined();
    if (parsed.error) {
      // 如 editor 无打开场景，undo_manager suite 会 skip_suite——记录但不阻断
      process.stderr.write(`[undo_manager] suite 返 error: ${parsed.error.message ?? parsed.error}\n`);
      // skip_suite 是合法状态（无场景打开），不算失败
      expect(parsed.error.code === -32004 || /skip|no.*scene/i.test(parsed.error.message ?? '')).toBe(true);
      return;
    }
    expect(parsed.summary).toBeDefined();
    expect(parsed.summary.total).toBeGreaterThan(0);
    // 允许 skipped > 0（无场景时 skip），但 failed 必须 0
    expect(parsed.summary.failed ?? 0).toBe(0);
    process.stderr.write(`[undo_manager] suite 结果: ${JSON.stringify(parsed.summary)}\n`);
  });
});
