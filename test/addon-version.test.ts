import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, readdirSync, cpSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readAddonVersion, updateAddon } from '../src/core/addon-version.js';
import { isolatePathEnv, asUnrestrictedPath, expectPathDenied } from './helpers/path-isolation.js';

// S3 原子化测试需要 mock fs.cpSync。ESM 命名空间 import 不可 spyOn（property non-configurable），
// 改用 vi.mock 工厂替换 cpSync，默认透传 actual.cpSync；通过全局标志触发 "拷贝后抛错" 语义。
vi.mock('fs', async (importActual) => {
  const actual = await importActual() as typeof import('fs');
  return {
    ...actual,
    cpSync: vi.fn((src, dest, opts) => {
      const throwAfter = (globalThis as { __cpSyncThrowAfter?: string }).__cpSyncThrowAfter;
      if (throwAfter) {
        (globalThis as { __cpSyncThrowAfter?: string }).__cpSyncThrowAfter = undefined;
        actual.cpSync(src, dest, opts);  // 真实拷贝完成
        throw new Error(throwAfter);     // 然后抛错模拟 mid-copy 失败
      }
      return actual.cpSync(src, dest, opts);
    }),
  };
});

let tmpProject: string;
let restore: () => void = () => {};

beforeEach(() => {
  restore = asUnrestrictedPath();   // 刻意 UNRESTRICTED=true（多数测试绕白名单用 tmpProject）
  tmpProject = mkdtempSync(join(tmpdir(), 'av-'));
  // updateAddon → validateProjectRoot 检查 project.godot 存在（brief ⚠️ 注释）
  writeFileSync(join(tmpProject, 'project.godot'), '');
});
afterEach(() => {
  restore();
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
    // 临时清空 UNRESTRICTED 触发 deny-by-default（it 内 isolatePathEnv 自包含 + finally restore）
    const r = isolatePathEnv();
    try {
      // tmpProject 在 os.tmpdir()，不在 cwd（包根）子树 → deny-by-default 拒绝
      expectPathDenied(() => readAddonVersion(tmpProject));
    } finally {
      r();
    }
  });

  it('S1: rejects cfg symlink escaping allowed roots (readAddonVersion)', () => {
    const allowedRoot = mkdtempSync(join(tmpdir(), 'allowed-rd-'));
    const outside = mkdtempSync(join(tmpdir(), 'outside-rd-'));
    // 清 UNRESTRICTED 使路径校验生效 + 设 ALLOWED=allowedRoot（allowlist 仅 allowedRoot，outside 在其外）
    const r = isolatePathEnv({ allowed: [allowedRoot] });

    try {
      mkdirSync(join(outside, 'godot_mcp_server'), { recursive: true });
      writeFileSync(join(outside, 'godot_mcp_server', 'plugin.cfg'),
        'config_version=5\n[plugin]\nversion="9.9.9"\nscript="plugin.gd"');

      const projectDir = join(allowedRoot, 'proj');
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(join(projectDir, 'project.godot'), 'config_version=5');

      // addons → outside (symlink 越界)：readAddonVersion 的 cfg 路径解析跟随到 allowlist 外
      symlinkSync(outside, join(projectDir, 'addons'), process.platform === 'win32' ? 'junction' : 'dir');

      expectPathDenied(() => readAddonVersion(projectDir));
    } finally {
      r();
      rmSync(allowedRoot, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
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

  it('S1: rejects dest symlink escaping allowed roots (updateAddon)', () => {
    // 清 UNRESTRICTED 使路径校验生效 + 设 ALLOWED=allowedRoot
    const allowedRoot = mkdtempSync(join(tmpdir(), 'allowed-'));
    const outside = mkdtempSync(join(tmpdir(), 'outside-'));
    const r = isolatePathEnv({ allowed: [allowedRoot] });

    try {
      mkdirSync(join(outside, 'godot_mcp_server'), { recursive: true });
      writeFileSync(join(outside, 'godot_mcp_server', 'plugin.cfg'), '[plugin]\nscript="plugin.gd"');

      const projectDir = join(allowedRoot, 'proj');
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(join(projectDir, 'project.godot'), 'config_version=5');

      // addons → outside (symlink 越界)
      symlinkSync(outside, join(projectDir, 'addons'), process.platform === 'win32' ? 'junction' : 'dir');

      expectPathDenied(() => updateAddon(projectDir));
    } finally {
      r();
      rmSync(allowedRoot, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('S1: first-install (dest not exist) still resolves and writes within root', () => {
    const projectDir = join(tmpdir(), 'proj-clean');
    try {
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(join(projectDir, 'project.godot'), 'config_version=5');
      // 无 addons/ 目录（首装），dest 不存在
      const r = updateAddon(projectDir);
      expect(r.verifyOk).toBe(true);
      expect(existsSync(join(projectDir, 'addons', 'godot_mcp_server', 'plugin.cfg'))).toBe(true);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

// S3: updateAddon 原子化（staging + 校验 + 备份 + 平台 rename + 回滚）
// 目标：cpSync 中途失败不留下破损 addon（旧 dest 保持原状，无 staging 残留）。
describe('updateAddon S3 atomic', () => {
  const OLD_CFG = 'config_version=5\n[plugin]\nname="OLD"\nversion="0.0.1"\nscript="plugin.gd"';

  function prepopulateDest(projectDir: string): void {
    mkdirSync(join(projectDir, 'addons', 'godot_mcp_server'), { recursive: true });
    writeFileSync(join(projectDir, 'addons', 'godot_mcp_server', 'plugin.cfg'), OLD_CFG);
    writeFileSync(join(projectDir, 'addons', 'godot_mcp_server', 'old.marker'), 'old');
  }

  function stagingLeftovers(projectDir: string): string[] {
    return readdirSync(projectDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name.includes('.addon-staging-'))
      .map(e => e.name);
  }

  afterEach(() => {
    // 清理全局 cpSync mock 标志
    (globalThis as { __cpSyncThrowAfter?: string }).__cpSyncThrowAfter = undefined;
  });

  it('S3: cpSync 到 staging 失败 → 旧 dest 完整保留（备份回滚）+ 无 staging 残留', () => {
    prepopulateDest(tmpProject);
    // 触发 "拷贝完成后抛错" 语义（模拟 mid-copy 失败，dest 会被旧 impl 直接覆盖）
    (globalThis as { __cpSyncThrowAfter?: string }).__cpSyncThrowAfter = 'simulated mid-copy failure';

    expect(() => updateAddon(tmpProject)).toThrow(/simulated mid-copy failure/);

    // 旧 dest 内容必须原封不动
    const cfgAfter = readFileSync(join(tmpProject, 'addons', 'godot_mcp_server', 'plugin.cfg'), 'utf-8');
    expect(cfgAfter).toBe(OLD_CFG);
    expect(readFileSync(join(tmpProject, 'addons', 'godot_mcp_server', 'old.marker'), 'utf-8')).toBe('old');
    // 不留 staging 残留
    expect(stagingLeftovers(tmpProject)).toEqual([]);
  });

  it('S3: 首装（dest 不存在）staging 失败 → 无 dest 无 staging 残留', () => {
    (globalThis as { __cpSyncThrowAfter?: string }).__cpSyncThrowAfter = 'simulated first-install staging failure';

    expect(() => updateAddon(tmpProject)).toThrow(/simulated first-install staging failure/);

    // 首装失败不应创建任何 dest 文件
    expect(existsSync(join(tmpProject, 'addons', 'godot_mcp_server', 'plugin.cfg'))).toBe(false);
    expect(stagingLeftovers(tmpProject)).toEqual([]);
  });

  it('S3: 成功更新（含旧 dest 备份路径）后清理 staging 与 .bak', () => {
    prepopulateDest(tmpProject);
    const r = updateAddon(tmpProject);
    expect(r.verifyOk).toBe(true);
    // 新版本写入 dest
    const cfg = readFileSync(join(tmpProject, 'addons', 'godot_mcp_server', 'plugin.cfg'), 'utf-8');
    expect(cfg).toContain('[plugin]');
    expect(cfg).toContain('script="plugin.gd"');
    // 不留 staging
    expect(stagingLeftovers(tmpProject)).toEqual([]);
    // 不留备份（成功后清理）
    expect(existsSync(join(tmpProject, 'addons', 'godot_mcp_server.bak'))).toBe(false);
  });

  it('cpSync 默认透传不影响 A-RCE T1 既有测试（mock 工厂回归守护）', () => {
    // 确认 vi.mock('fs') 默认 cpSync 透传：updateAddon 正常成功
    expect(cpSync).toBeDefined();
    const r = updateAddon(tmpProject);
    expect(r.verifyOk).toBe(true);
  });
});
