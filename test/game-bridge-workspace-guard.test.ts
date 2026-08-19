// game-bridge-workspace-guard.test.ts — A2 (2026-08-18 反馈 mcp_bridge.gd 工作区污染)
//
// install 曾无条件覆盖项目根 mcp_bridge.gd、uninstall 无条件删除 —— 对 git tracked 且
// 项目自管该文件的项目(CardGame2 场景)造成工作区污染(覆盖出 diff / 删掉 tracked 文件,
// 须 git checkout 恢复)。修复: 内容比对守卫 —— 内容一致(工具托管)才覆盖/删除,
// 不一致(项目自管)保留并明确提示。附带: uninstall 清理全部端口 secret(A1 避让残留)。
// 范式: 真实 fs + tmp 项目(对齐 game-bridge-autoload-key.test.ts)。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { handleTool, resetBridgeState } from '../src/tools/game-bridge.js';
import { asUnrestrictedPath } from './helpers/path-isolation.js';

let tmpRoot: string;
let projectDir: string;
let scriptsDir: string;
let restoreEnv: () => void;

const BASE_CONFIG = 'config_version=5\n[application]\nconfig/name="Test"\n';
const BUNDLED_CONTENT = '# bundled mcp_bridge.gd (tool-managed)\nextends Node\n';
const USER_MODIFIED_CONTENT = '# project-managed, git tracked + local edits\nextends Node\n# custom LOCKOUT changes\n';

beforeEach(() => {
  restoreEnv = asUnrestrictedPath();
  tmpRoot = join(tmpdir(), `bridge-ws-guard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  projectDir = join(tmpRoot, 'MyProject');
  scriptsDir = join(tmpRoot, 'scripts');
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(scriptsDir, { recursive: true });
  writeFileSync(join(scriptsDir, 'mcp_bridge.gd'), BUNDLED_CONTENT, 'utf-8');
  writeFileSync(join(projectDir, 'project.godot'), BASE_CONFIG, 'utf-8');
  resetBridgeState();
});

afterEach(() => {
  restoreEnv();
  resetBridgeState();
  rmSync(tmpRoot, { recursive: true, force: true });
});

const ctx = () => ({ opsScript: join(scriptsDir, 'ops.gd'), projectDir } as never);
const resultText = (r: unknown): string => ((r as { content?: Array<{ text: string }> })?.content?.[0]?.text) ?? '';

describe('A2: game_bridge_install 内容比对守卫', () => {
  it('目标 mcp_bridge.gd 内容与自带版本不同(项目自管)→ 不覆盖,文件保持用户版 + 返回提示', async () => {
    writeFileSync(join(projectDir, 'mcp_bridge.gd'), USER_MODIFIED_CONTENT, 'utf-8');
    const r = await handleTool('game', { action: 'game_bridge_install', project_path: projectDir }, ctx());
    expect(r?.isError).toBeFalsy();
    expect(readFileSync(join(projectDir, 'mcp_bridge.gd'), 'utf-8')).toBe(USER_MODIFIED_CONTENT);  // 未被覆盖
    expect(resultText(r)).toContain('differs from bundled version');
  });

  it('目标 mcp_bridge.gd 内容与自带版本一致(工具托管)→ 覆盖刷新,无警告(升级场景)', async () => {
    writeFileSync(join(projectDir, 'mcp_bridge.gd'), BUNDLED_CONTENT, 'utf-8');
    const r = await handleTool('game', { action: 'game_bridge_install', project_path: projectDir }, ctx());
    expect(r?.isError).toBeFalsy();
    expect(readFileSync(join(projectDir, 'mcp_bridge.gd'), 'utf-8')).toBe(BUNDLED_CONTENT);
    expect(resultText(r)).not.toContain('differs from bundled version');
  });

  it('目标不存在 → 正常拷贝(首次安装)', async () => {
    const r = await handleTool('game', { action: 'game_bridge_install', project_path: projectDir }, ctx());
    expect(r?.isError).toBeFalsy();
    expect(readFileSync(join(projectDir, 'mcp_bridge.gd'), 'utf-8')).toBe(BUNDLED_CONTENT);
  });

  it('已注册(幂等)且内容不同 → 同样不覆盖,already registered 响应带提示', async () => {
    writeFileSync(join(projectDir, 'project.godot'), BASE_CONFIG + '[autoload]\nMCPBridge="*res://mcp_bridge.gd"\n', 'utf-8');
    writeFileSync(join(projectDir, 'mcp_bridge.gd'), USER_MODIFIED_CONTENT, 'utf-8');
    const r = await handleTool('game', { action: 'game_bridge_install', project_path: projectDir }, ctx());
    const text = resultText(r);
    expect(text).toContain('already registered');
    expect(text).toContain('differs from bundled version');
    expect(readFileSync(join(projectDir, 'mcp_bridge.gd'), 'utf-8')).toBe(USER_MODIFIED_CONTENT);
  });
});

describe('A2: game_bridge_uninstall 内容比对守卫', () => {
  function registerAutoload(): void {
    writeFileSync(join(projectDir, 'project.godot'), BASE_CONFIG + '[autoload]\nMCPBridge="*res://mcp_bridge.gd"\n', 'utf-8');
  }

  it('内容与自带版本一致(工具托管)→ 删除(原行为回归)', async () => {
    registerAutoload();
    writeFileSync(join(projectDir, 'mcp_bridge.gd'), BUNDLED_CONTENT, 'utf-8');
    const r = await handleTool('game', { action: 'game_bridge_uninstall', project_path: projectDir }, ctx());
    expect(r?.isError).toBeFalsy();
    expect(existsSync(join(projectDir, 'mcp_bridge.gd'))).toBe(false);
  });

  it('内容不同(项目自管/git tracked)→ 保留文件 + 返回提示(修复点:不再删 tracked 文件)', async () => {
    registerAutoload();
    writeFileSync(join(projectDir, 'mcp_bridge.gd'), USER_MODIFIED_CONTENT, 'utf-8');
    const r = await handleTool('game', { action: 'game_bridge_uninstall', project_path: projectDir }, ctx());
    expect(r?.isError).toBeFalsy();
    expect(existsSync(join(projectDir, 'mcp_bridge.gd'))).toBe(true);  // 保留
    expect(readFileSync(join(projectDir, 'mcp_bridge.gd'), 'utf-8')).toBe(USER_MODIFIED_CONTENT);
    expect(resultText(r)).toContain('kept');
  });

  it('清理全部端口的 secret 文件(A1 避让端口 9081/9082 残留都删)', async () => {
    registerAutoload();
    const godotDir = join(projectDir, '.godot');
    mkdirSync(godotDir, { recursive: true });
    writeFileSync(join(godotDir, 'mcp_bridge_9081.secret'), 'a'.repeat(32), 'utf-8');
    writeFileSync(join(godotDir, 'mcp_bridge_9082.secret'), 'b'.repeat(32), 'utf-8');
    writeFileSync(join(godotDir, 'other_cache.bin'), 'keep-me', 'utf-8');
    const r = await handleTool('game', { action: 'game_bridge_uninstall', project_path: projectDir }, ctx());
    expect(r?.isError).toBeFalsy();
    expect(existsSync(join(godotDir, 'mcp_bridge_9081.secret'))).toBe(false);
    expect(existsSync(join(godotDir, 'mcp_bridge_9082.secret'))).toBe(false);
    expect(existsSync(join(godotDir, 'other_cache.bin'))).toBe(true);  // 非 secret 文件不动
  });
});
