import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  installOverride,
  uninstallOverride,
  uninstallAllOverrides,
  deriveOverrideEntry,
  installOverrides,
  OVERRIDE_AUTOLOAD_PREFIX,
} from '../src/core/overrides.js';

// P2-1 overrides 测试:验证 autoload 注入/卸载逻辑 + 路径白名单 + 幂等
// 用真实 tmp 目录建 mock 项目(绕过 isPathInAllowedRoots 需 UNRESTRICTED)

const OLD_UNRESTRICTED = process.env.GODOT_MCP_UNRESTRICTED;
let tmpRoot: string;
let projectDir: string;
let sourceScriptDir: string;

beforeEach(() => {
  process.env.GODOT_MCP_UNRESTRICTED = 'true'; // 测试环境绕过白名单
  tmpRoot = join(tmpdir(), `overrides-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  projectDir = join(tmpRoot, 'MyProject');
  sourceScriptDir = join(tmpRoot, 'sources');
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(sourceScriptDir, { recursive: true });
  // mock project.godot
  writeFileSync(join(projectDir, 'project.godot'),
    'config_version=5\n[application]\nconfig/name="Test"\n', 'utf-8');
});

afterEach(() => {
  if (OLD_UNRESTRICTED === undefined) delete process.env.GODOT_MCP_UNRESTRICTED;
  else process.env.GODOT_MCP_UNRESTRICTED = OLD_UNRESTRICTED;
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('P2-1 overrides.ts', () => {
  describe('deriveOverrideEntry', () => {
    it('derives autoload key and dest script name from source path', () => {
      const entry = deriveOverrideEntry('/some/path/debug_log.gd', '/project');
      expect(entry.autoloadKey).toBe('autoload/MCPOVERRIDE_debug_log');
      expect(entry.destScriptName).toBe('mcpoverride_debug_log.gd');
      expect(entry.destScriptPath).toBe(join('/project', 'mcpoverride_debug_log.gd'));
    });

    it('sanitizes non-alphanumeric characters in stem', () => {
      const entry = deriveOverrideEntry('/path/my-debug hook.gd', '/project');
      expect(entry.autoloadKey).toBe('autoload/MCPOVERRIDE_my_debug_hook');
    });
  });

  describe('installOverride', () => {
    it('installs script into project [autoload] section and copies script', () => {
      const srcScript = join(sourceScriptDir, 'log.gd');
      writeFileSync(srcScript, 'extends Node\n', 'utf-8');

      const entry = installOverride(srcScript, projectDir);
      expect(entry).not.toBeNull();
      expect(entry!.autoloadKey).toBe('autoload/MCPOVERRIDE_log');

      // 脚本拷贝到项目根
      expect(existsSync(join(projectDir, 'mcpoverride_log.gd'))).toBe(true);

      // project.godot 含 autoload 条目
      const config = readFileSync(join(projectDir, 'project.godot'), 'utf-8');
      expect(config).toMatch(/autoload\/MCPOVERRIDE_log="\*res:\/\/mcpoverride_log\.gd"/);
    });

    it('is idempotent — second install returns null', () => {
      const srcScript = join(sourceScriptDir, 'log.gd');
      writeFileSync(srcScript, 'extends Node\n', 'utf-8');

      const first = installOverride(srcScript, projectDir);
      const second = installOverride(srcScript, projectDir);
      expect(first).not.toBeNull();
      expect(second).toBeNull();
    });

    it('creates [autoload] section if missing', () => {
      const srcScript = join(sourceScriptDir, 'hook.gd');
      writeFileSync(srcScript, 'extends Node\n', 'utf-8');

      installOverride(srcScript, projectDir);
      const config = readFileSync(join(projectDir, 'project.godot'), 'utf-8');
      expect(config).toMatch(/\[autoload\]/);
      expect(config).toMatch(/autoload\/MCPOVERRIDE_hook/);
    });

    it('appends to existing [autoload] section', () => {
      // 项目已有 [autoload] 段
      writeFileSync(join(projectDir, 'project.godot'),
        'config_version=5\n\n[autoload]\n\n[application]\nconfig/name="Test"\n', 'utf-8');
      const srcScript = join(sourceScriptDir, 'snap.gd');
      writeFileSync(srcScript, 'extends Node\n', 'utf-8');

      installOverride(srcScript, projectDir);
      const config = readFileSync(join(projectDir, 'project.godot'), 'utf-8');
      // MCPOVERRIDE 在 [autoload] 后、[application] 前
      const autoloadIdx = config.indexOf('[autoload]');
      const overrideIdx = config.indexOf('MCPOVERRIDE_snap');
      const appIdx = config.indexOf('[application]');
      expect(overrideIdx).toBeGreaterThan(autoloadIdx);
      expect(overrideIdx).toBeLessThan(appIdx);
    });

    it('throws if source script not found', () => {
      expect(() => installOverride(join(sourceScriptDir, 'nope.gd'), projectDir))
        .toThrow(/source script not found/i);
    });

    it('throws if project.godot not found', () => {
      const srcScript = join(sourceScriptDir, 'log.gd');
      writeFileSync(srcScript, 'extends Node\n', 'utf-8');
      const emptyDir = join(tmpRoot, 'empty');
      mkdirSync(emptyDir, { recursive: true });
      expect(() => installOverride(srcScript, emptyDir))
        .toThrow(/project\.godot not found/i);
    });
  });

  describe('uninstallOverride', () => {
    it('removes autoload entry and deletes copied script', () => {
      const srcScript = join(sourceScriptDir, 'log.gd');
      writeFileSync(srcScript, 'extends Node\n', 'utf-8');
      installOverride(srcScript, projectDir);

      const removed = uninstallOverride(srcScript, projectDir);
      expect(removed).toBe(true);
      expect(existsSync(join(projectDir, 'mcpoverride_log.gd'))).toBe(false);
      const config = readFileSync(join(projectDir, 'project.godot'), 'utf-8');
      expect(config).not.toMatch(/MCPOVERRIDE_log/);
    });

    it('returns false if override not registered', () => {
      const srcScript = join(sourceScriptDir, 'log.gd');
      writeFileSync(srcScript, 'extends Node\n', 'utf-8');
      const removed = uninstallOverride(srcScript, projectDir);
      expect(removed).toBe(false);
    });
  });

  describe('uninstallAllOverrides', () => {
    it('removes all MCPOVERRIDE_* entries', () => {
      // 装两个 override
      for (const name of ['a', 'b']) {
        const src = join(sourceScriptDir, `${name}.gd`);
        writeFileSync(src, 'extends Node\n', 'utf-8');
        installOverride(src, projectDir);
      }
      const count = uninstallAllOverrides(projectDir);
      expect(count).toBe(2);
      const config = readFileSync(join(projectDir, 'project.godot'), 'utf-8');
      expect(config).not.toMatch(/MCPOVERRIDE_/);
    });

    it('returns 0 if no overrides', () => {
      expect(uninstallAllOverrides(projectDir)).toBe(0);
    });
  });

  describe('installOverrides (batch)', () => {
    it('installs multiple scripts atomically', () => {
      const paths = ['x', 'y'].map(n => {
        const p = join(sourceScriptDir, `${n}.gd`);
        writeFileSync(p, 'extends Node\n', 'utf-8');
        return p;
      });
      const installed = installOverrides(paths, projectDir);
      expect(installed.length).toBe(2);
    });

    it('throws atomically if any source missing (none installed)', () => {
      const good = join(sourceScriptDir, 'good.gd');
      writeFileSync(good, 'extends Node\n', 'utf-8');
      const bad = join(sourceScriptDir, 'bad.gd');
      expect(() => installOverrides([good, bad], projectDir))
        .toThrow(/source script not found/i);
      // good 也不应被装(atomic)
      const config = readFileSync(join(projectDir, 'project.godot'), 'utf-8');
      expect(config).not.toMatch(/MCPOVERRIDE_good/);
    });
  });

  describe('OVERRIDE_AUTOLOAD_PREFIX constant', () => {
    it('uses MCPOVERRIDE_ prefix for easy cleanup identification', () => {
      expect(OVERRIDE_AUTOLOAD_PREFIX).toBe('autoload/MCPOVERRIDE_');
    });
  });

  // N-2 (P2-4 审查): 路径白名单强制测试 —— 不设 UNRESTRICTED 时越权路径必须抛错
  describe('path allowlist enforcement (N-2)', () => {
    it('installOverride 拒绝越权源脚本路径(不设 UNRESTRICTED)', () => {
      delete process.env.GODOT_MCP_UNRESTRICTED;
      // 越权路径:/outside/allow/evil.gd(不在 tmpRoot 也不在 cwd)
      const outside = join(tmpdir(), `outside-${Date.now()}.gd`);
      writeFileSync(outside, 'extends Node\n', 'utf-8');
      expect(() => installOverride(outside, projectDir)).toThrow(/not in allowed roots/i);
      // 清理
      try { require('fs').unlinkSync(outside); } catch { /* best effort */ }
    });

    it('installOverride 拒绝越权目标项目路径(不设 UNRESTRICTED)', () => {
      delete process.env.GODOT_MCP_UNRESTRICTED;
      const srcScript = join(sourceScriptDir, 'log.gd');
      writeFileSync(srcScript, 'extends Node\n', 'utf-8');
      // projectDir 在 tmpRoot,但 UNRESTRICTED 关闭后须 ALLOWED_PROJECT_PATHS 显式允许
      expect(() => installOverride(srcScript, projectDir)).toThrow(/not in allowed roots/i);
    });
  });
});
