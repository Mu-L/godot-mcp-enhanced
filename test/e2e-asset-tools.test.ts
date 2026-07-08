/**
 * E2E L2 Asset Tools — 真 Godot editor 端到端验证
 *
 * 验证 asset 工具(create/path/batch/undo/save + 11 shape)在真实 editor +
 * mcp-enhanced 插件 + command_handler 路由下的完整链路。
 *
 * ─── harness 设计(仿 e2e-full-tool-verification.test.ts 的 L2 editor 模式)───
 *
 * 与 e2e-full 的 callTool(直调 mod.handleTool)不同,asset 写动作(create/path/
 * batch/undo/save)在 editor 模式由 ToolDispatcher 盲转到 GD command_handler,
 * 直调 handleTool 只会返 EDITOR_ONLY。故本 harness 直接用 EditorToolExecutor
 * .execute('asset', args) —— 它就是 conn.request('asset', args) 转发到插件,
 * 跳过 ToolDispatcher 的中间件/校验(TS 侧校验已有 T9 单测覆盖),专注验证
 * GD 插件 handle_* 端到端正确性。这是"真 editor 端到端"的本意。
 *
 * ─── 三层守卫(反假绿 IMPORTANT-9b)───
 *
 * 1. hasGodot    — GODOT_PATH 存在(虽不直接 spawn,但表明环境配置完整)
 * 2. hasProject  — real-project fixture 存在(编辑器要打开的项目)
 * 3. E2E_EDITOR  — opt-in:开发者已手工启动 GUI Godot 编辑器 + 加载 mcp-enhanced
 *                  插件 + 打开 real-project 的 3D 场景。CI 不可行(GUI),默认 skip。
 *
 * 未满足时 describe.skipIf 静默跳过 + stderr 告警,绝不假报 pass。
 *
 * ─── 运行方式 ───
 *
 * # 1. 手工启动 Godot 编辑器(开发者本机):
 * #    Godot_v4.6.3-stable_win64_console.exe --editor --path test/fixtures/real-project
 * #    (或 GUI 打开 Godot → 打开 test/fixtures/real-project → 启用 mcp-enhanced 插件
 * #     → 打开 scenes/3d/main_3d.tscn 作为活动场景)
 * # 2. 跑 E2E:
 *    cd D:/GitHub/godot-mcp-enhanced
 *    GODOT_PATH="D:/Godot/Godot_v4.6.3-stable_win64_console.exe" \
 *    E2E_EDITOR=1 \
 *    npx vitest run test/e2e-asset-tools.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { registerAllModules } from '../src/core/module-loader.js';
import { readEditorSecret } from '../src/core/editor-auth.js';
import { EditorConnection } from '../src/core/EditorConnection.js';
import { EditorToolExecutor } from '../src/core/EditorToolExecutor.js';
import * as ps from '../src/core/process-state.js';
import type { ToolResult } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── 守卫条件 ────────────────────────────────────────────────────────────────
const GODOT_PATH = process.env.GODOT_PATH || '';
const hasGodot = existsSync(GODOT_PATH);

// real-project 靶子(mcp-enhanced 既有 fixture,无 autoload,含 3D 场景)
const REAL_PROJECT = resolve(__dirname, 'fixtures', 'real-project');
const hasProject = existsSync(REAL_PROJECT) && existsSync(resolve(REAL_PROJECT, 'project.godot'));

// editor opt-in(需 GUI 编辑器 + 插件已手工启动)
const hasEditorFlag = !!process.env.E2E_EDITOR;

// editor WS 端口(与 addons/godot_mcp_server/websocket_server.gd BASE_PORT 对齐)
const EDITOR_PORT = parseInt(process.env.GODOT_EDITOR_PORT ?? '9090', 10);

const canRunE2E = hasGodot && hasProject && hasEditorFlag;

// ─── 反假绿 stderr 告警(未启用时显式提示,不静默假绿)───
if (!canRunE2E) {
  const reasons: string[] = [];
  if (!hasGodot) reasons.push(`GODOT_PATH 未设或不存在(当前: ${GODOT_PATH || '<空>'})`);
  if (!hasProject) reasons.push(`real-project fixture 不存在: ${REAL_PROJECT}`);
  if (!hasEditorFlag) reasons.push('E2E_EDITOR=1 未设(需手工启动 GUI 编辑器 + 加载 mcp-enhanced 插件)');
  process.stderr.write(
    `[E2E-SKIP] asset E2E(editor)未启用。原因: ${reasons.join('; ')}\n` +
    `  本测试需真实 Godot editor 运行(mcp-enhanced 插件 + WebSocket server 9090 + 打开场景),\n` +
    `  CI 环境(GUI 不可用)默认跳过。开发者本机运行步骤:\n` +
    `    1. 启动编辑器: Godot_v4.6.3-stable_win64_console.exe --editor --path "${REAL_PROJECT}"\n` +
    `       (或在 Godot 项目管理器打开 real-project → 启用 mcp-enhanced 插件)\n` +
    `    2. 打开一个 3D 场景作为活动场景(scenes/3d/main_3d.tscn)\n` +
    `    3. GODOT_PATH="<godot.exe>" E2E_EDITOR=1 npx vitest run test/e2e-asset-tools.test.ts\n`,
  );
}

// ─── harness 装配 ────────────────────────────────────────────────────────────
let editorConn: EditorConnection | null = null;
let editorExec: EditorToolExecutor | null = null;
let _registered = false;

beforeAll(async () => {
  if (!canRunE2E) return; // skip 时 beforeAll 不装配

  if (!_registered) {
    registerAllModules();
    _registered = true;
  }
  ps.resetState();

  // 读 editor secret(插件启动时写到 {project}/.godot/mcp_editor.key)
  const secret = readEditorSecret(REAL_PROJECT);
  if (!secret) {
    throw new Error(
      `[E2E] 未能从 ${join(REAL_PROJECT, '.godot', 'mcp_editor.key')} 读取 editor secret。` +
      `请确认 GUI 编辑器已启动且 mcp-enhanced 插件已加载。`,
    );
  }

  // 建 editor 连接(reconnect:false — 测试期间 editor 应持续运行,断连不重试避免拖慢失败诊断)
  editorConn = new EditorConnection({
    port: EDITOR_PORT,
    host: '127.0.0.1',
    reconnect: false,
    secret,
    connectTimeout: 10_000,
    requestTimeout: 30_000,
  });
  await editorConn.connect();
  editorExec = new EditorToolExecutor(editorConn);

  // 确保 GeneratedAssets 目录存在(save 测试落盘需要)
  mkdirSync(join(REAL_PROJECT, 'GeneratedAssets'), { recursive: true });
}, 30_000);

afterAll(async () => {
  if (editorExec) {
    try { editorExec.destroy(); } catch { /* best effort */ }
    editorExec = null;
  }
  if (editorConn) {
    try { editorConn.disconnect(); } catch { /* best effort */ }
    editorConn = null;
  }
});

// ─── callTool helper(经 EditorToolExecutor 盲转到 GD command_handler)───
// 直接调 executor.execute('asset', args) / execute('editor', args),
// 返回 { text, isError }。text 是 GD 返回的 JSON.stringify(result/error dict)。
async function callAsset(args: Record<string, unknown>): Promise<{ text: string; isError: boolean; parsed: any }> {
  if (!editorExec) throw new Error('editor executor 未装配(canRunE2E=false?)');
  const result: ToolResult = await editorExec.execute('asset', { project_path: REAL_PROJECT, ...args });
  const text = result.content.map(c => (c as { text: string }).text).join('\n');
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* 非 JSON,保持 null */ }
  return { text, isError: result.isError === true, parsed };
}

async function getSceneTree(): Promise<string> {
  if (!editorExec) throw new Error('editor executor 未装配(canRunE2E=false?)');
  const result: ToolResult = await editorExec.execute('editor', {
    project_path: REAL_PROJECT,
    action: 'get_scene_tree',
  });
  return result.content.map(c => (c as { text: string }).text).join('\n');
}

// 解析 GD 返回:成功 → parsed.result;失败 → parsed.error
function unwrap(r: { parsed: any }): any { return r.parsed?.result; }
function errCode(r: { parsed: any }): string | undefined { return r.parsed?.error?.code; }

// 11 shape 名(逐字对齐 schema.ts SHAPE_NAMES + docs/shapes-reference.md)
const SHAPES_11 = [
  'box', 'cylinder', 'sphere', 'prism', 'wall', 'ramp',
  'cone', 'tube', 'torus', 'stairs', 'fence',
] as const;

// ═══════════════════════════════════════════════════════════════════════════════
// E2E L2: asset create / path / batch / undo / save + 11 shape(真 editor)
// ═══════════════════════════════════════════════════════════════════════════════
describe.skipIf(!canRunE2E)('E2E L2 asset(真 Godot editor)', { timeout: 60_000, sequential: true }, () => {

  // ─── 1. create box → node_path + 视口可见 ────────────────────────────────
  it('create box {size:[2,1,1], name:e2e_box} → 返 node_path + scene tree 含 e2e_box', async () => {
    const r = await callAsset({
      action: 'create', shape: 'box',
      params: { size: [2, 1, 1] }, name: 'e2e_box',
    });
    expect(r.isError).toBe(false);
    const result = unwrap(r);
    expect(result).toBeTruthy();
    expect(result.node_path).toBeTruthy();
    expect(String(result.node_path)).toContain('e2e_box');
    // 视口可见:scene tree 快照含节点名
    const tree = await getSceneTree();
    expect(tree).toContain('e2e_box');
  });

  // ─── 2. path fence continuous → N 节点(≥2)────────────────────────────────
  it('path fence continuous {path:[[0,0,0],[6,0,0]], spacing:3} → node_paths.length ≥ 2', async () => {
    const r = await callAsset({
      action: 'path', shape: 'fence',
      params: { length: 3, height: 1.2 },
      path: [[0, 0, 0], [6, 0, 0]],
      mode: 'continuous', spacing: 3,
    });
    expect(r.isError).toBe(false);
    const result = unwrap(r);
    expect(result).toBeTruthy();
    expect(Array.isArray(result.node_paths)).toBe(true);
    expect(result.node_paths.length).toBeGreaterThanOrEqual(2);
  });

  // ─── 3. path continuous ramp → UNSUPPORTED_SHAPE(方案 A 阻塞)─────────────
  it('path continuous ramp → UNSUPPORTED_SHAPE(方案 A,make_ramp 阻塞)', async () => {
    const r = await callAsset({
      action: 'path', shape: 'ramp',
      params: {},
      path: [[0, 0, 0], [4, 0, 0]],
      mode: 'continuous', spacing: 2,
    });
    // 方案 A:continuous ramp 在 place_path 入口被显式拦截,返 UNSUPPORTED_SHAPE
    expect(errCode(r)).toBe('UNSUPPORTED_SHAPE');
  });

  // ─── 4. batch 3 items → 3 节点 + 一次 undo 全消(原子 undo)────────────────
  it('batch [box b1, cone c1, torus t1] → 3 node_paths + undo 全消', async () => {
    const r = await callAsset({
      action: 'batch',
      items: [
        { shape: 'box', name: 'b1' },
        { shape: 'cone', name: 'c1' },
        { shape: 'torus', name: 't1' },
      ],
    });
    expect(r.isError).toBe(false);
    const result = unwrap(r);
    expect(result).toBeTruthy();
    expect(Array.isArray(result.node_paths)).toBe(true);
    expect(result.node_paths).toHaveLength(3);

    // undo 一次 → batch 原子 undo(b1/c1/t1 同一 batch_id,一次弹尽)
    const u = await callAsset({ action: 'undo' });
    expect(u.isError).toBe(false);

    // scene tree 不再含 b1/c1/t1
    const tree = await getSceneTree();
    expect(tree).not.toContain('b1');
    expect(tree).not.toContain('c1');
    expect(tree).not.toContain('t1');
  });

  // ─── 5. batch item 2 非法 shape → 零落地(预校验原子)──────────────────────
  it('batch [box ok1, NONEXISTENT bad] → UNSUPPORTED_SHAPE + 零落地', async () => {
    const before = await getSceneTree();
    const r = await callAsset({
      action: 'batch',
      items: [
        { shape: 'box', name: 'ok1' },
        { shape: 'NONEXISTENT', name: 'bad' },
      ],
    });
    // 预校验原子:item 2 UNSUPPORTED_SHAPE → 整批拒绝
    expect(errCode(r)).toBe('UNSUPPORTED_SHAPE');

    // 零落地:ok1 未出现在 scene tree(before 没有,after 也没有)
    const after = await getSceneTree();
    expect(after).not.toContain('ok1');
    expect(before).not.toContain('ok1'); // sanity:测试前本就没有
  });

  // ─── 6. save → 落盘 + undo 后文件仍在(不变量 1)─────────────────────────────
  it('save pillar → res://GeneratedAssets/pillar.tscn 落盘 + undo 不删(不变量 1)', async () => {
    // 先 create 一个 pillar,拿 node_path
    const cr = await callAsset({
      action: 'create', shape: 'box', name: 'pillar',
    });
    expect(cr.isError).toBe(false);
    const nodePath = String(unwrap(cr).node_path);
    expect(nodePath).toContain('pillar');

    // save 到 res://GeneratedAssets/pillar.tscn
    const resourcePath = 'res://GeneratedAssets/pillar.tscn';
    const sr = await callAsset({
      action: 'save', node_path: nodePath, resource_path: resourcePath,
    });
    expect(sr.isError).toBe(false);
    expect(unwrap(sr).resource_path).toBe(resourcePath);

    // 落盘断言(fs check)— pillar.tscn 文件存在
    const fsPath = join(REAL_PROJECT, 'GeneratedAssets', 'pillar.tscn');
    expect(existsSync(fsPath)).toBe(true);

    // undo(删场景节点,但不删 .tscn 文件 — 不变量 1)
    const u = await callAsset({ action: 'undo' });
    expect(u.isError).toBe(false);

    // undo 后文件仍在(用户可复用的 PackedScene 资产,undo 绝不删)
    expect(existsSync(fsPath)).toBe(true);
  });

  // ─── 7. 11 shape create 全部成功(ramp 单件 PrismMesh)──────────────────────
  it('11 shape create 全部成功(box/cylinder/sphere/prism/wall/ramp/cone/tube/torus/stairs/fence)', async () => {
    for (const shape of SHAPES_11) {
      const name = `e2e_${shape}`;
      const r = await callAsset({ action: 'create', shape, name });
      expect(r.isError).toBe(false);
      const result = unwrap(r);
      expect(result).toBeTruthy();
      expect(result.node_path).toBeTruthy();
      expect(String(result.node_path)).toContain(name);
    }
  });
});
