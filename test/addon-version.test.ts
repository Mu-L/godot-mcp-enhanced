import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readAddonVersion, updateAddon } from '../src/core/addon-version.js';
import { _resetPathAllowWarned } from '../src/core/path-utils.js';

let tmpProject: string;
let savedUnrestricted: string | undefined;

beforeEach(() => {
  savedUnrestricted = process.env.GODOT_MCP_UNRESTRICTED;
  process.env.GODOT_MCP_UNRESTRICTED = 'true';  // 测试绕白名单（memory: test-setup 全局 UNRESTRICTED）
  _resetPathAllowWarned();
  tmpProject = mkdtempSync(join(tmpdir(), 'av-'));
  // updateAddon → validateProjectRoot 检查 project.godot 存在（brief ⚠️ 注释）
  writeFileSync(join(tmpProject, 'project.godot'), '');
});
afterEach(() => {
  if (savedUnrestricted === undefined) delete process.env.GODOT_MCP_UNRESTRICTED;
  else process.env.GODOT_MCP_UNRESTRICTED = savedUnrestricted;
  _resetPathAllowWarned();
  rmSync(tmpProject, { recursive: true, force: true });
});

describe('readAddonVersion', () => {
  it('已安装返回版本', () => {
    mkdirSync(join(tmpProject, 'addons', 'godot_mcp_server'), { recursive: true });
    writeFileSync(join(tmpProject, 'addons', 'godot_mcp_server', 'plugin.cfg'),
      'config_version=5\n[plugin]\nname="MCP Server"\nversion="0.22.0"\nscript="plugin.gd"');
    expect(readAddonVersion(tmpProject)).toEqual({ version: '0.22.0', installed: true });
  });

  it('未安装返回 installed:false', () => {
    expect(readAddonVersion(tmpProject)).toEqual({ version: null, installed: false });
  });

  it('malformed（有 cfg 无 version 行）返回 installed:true version:null', () => {
    mkdirSync(join(tmpProject, 'addons', 'godot_mcp_server'), { recursive: true });
    writeFileSync(join(tmpProject, 'addons', 'godot_mcp_server', 'plugin.cfg'), '[plugin]\nname="X"');
    const r = readAddonVersion(tmpProject);
    expect(r.installed).toBe(true);
    expect(r.version).toBeNull();
  });

  it('isPathInAllowedRoots 拒绝时 throw（UNRESTRICTED 未设）', () => {
    // 临时清空 UNRESTRICTED 触发 deny-by-default，测后恢复
    const saved = process.env.GODOT_MCP_UNRESTRICTED;
    process.env.GODOT_MCP_UNRESTRICTED = '';
    _resetPathAllowWarned();
    try {
      // tmpProject 在 os.tmpdir()，不在 cwd（包根）子树 → deny-by-default 拒绝
      expect(() => readAddonVersion(tmpProject)).toThrow(/不在 ALLOWED_PROJECT_PATHS/);
    } finally {
      process.env.GODOT_MCP_UNRESTRICTED = saved;
      _resetPathAllowWarned();
    }
  });
});

describe('updateAddon', () => {
  it('cp 包内 addon + verifyOk=true', () => {
    const { dest, verifyOk } = updateAddon(tmpProject);
    expect(verifyOk).toBe(true);
    const cfg = readFileSync(join(dest, 'plugin.cfg'), 'utf-8');
    expect(cfg).toContain('[plugin]');
    expect(cfg).toContain('script="plugin.gd"');
    expect(existsSync(join(dest, 'plugin.gd'))).toBe(true);
  });

  it('validateProjectRoot 拒绝（无 project.godot）', () => {
    const noGodotDir = mkdtempSync(join(tmpdir(), 'av-nogodot-'));
    try {
      // beforeEach 已设 UNRESTRICTED='true' 跳过白名单，走到 validateProjectRoot 检查 project.godot
      expect(() => updateAddon(noGodotDir)).toThrow(/no project\.godot/);
    } finally {
      rmSync(noGodotDir, { recursive: true, force: true });
    }
  });
});
