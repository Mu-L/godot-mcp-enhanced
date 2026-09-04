import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { handleTool } from '../src/tools/screenshot.js';
import { isolatePathEnv } from './helpers/path-isolation.js';

// analyze 走 existsSync/readFileSync（非 captureScreenshot），无需 mock screenshot.js

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    opsScript: '/fake/ops.gd',
    findGodot: vi.fn(async () => '/usr/bin/godot'),
    runningProcess: null, setRunningProcess: vi.fn(),
    outputBuffer: [], setOutputBuffer: vi.fn(),
    processStartTime: 0, setProcessStartTime: vi.fn(),
    projectDir: '', setProjectDir: vi.fn(),
    parseGodotConfig: vi.fn(() => ({})),
    ...overrides,
  } as any;
}

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ─── #1: projectPath 默认模式可读任意目录（leak）──────────────────────────────
describe('screenshot analyze path-leak #1: projectPath 校验（默认模式）', () => {
  let allowedDir: string;
  let outsideDir: string;
  let restore: () => void = () => {};

  beforeEach(() => {
    allowedDir = mkdtempSync(join(tmpdir(), 'allowed-'));
    outsideDir = mkdtempSync(join(tmpdir(), 'outside-'));
    writeFileSync(join(outsideDir, 'secret.png'), PNG_BYTES);
    // 默认模式：清 UNRESTRICTED + 删 ALLOWED + chdir(allowedDir)（cwd 回落 = allowed root）
    restore = isolatePathEnv({ allowed: [], cwd: allowedDir });
  });

  afterEach(() => {
    restore();
    rmSync(allowedDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  });

  it('修复后: project_path=outside image_path=相对 → throw（默认模式防任意目录读）', async () => {
    const result = handleTool('screenshot', {
      action: 'analyze',
      project_path: outsideDir,
      image_path: 'secret.png',
    }, makeCtx());
    // 反馈 2026-08-19 修复: 原生 Error → PathError(PATH_NOT_ALLOWED 结构化,消息含白名单提示)
    await expect(result).rejects.toThrow(/outside allowed project roots/);
  });

  it('反向: project_path=allowed(cwd) 不误拒', async () => {
    writeFileSync(join(allowedDir, 'shot.png'), PNG_BYTES);
    const result = await handleTool('screenshot', {
      action: 'analyze',
      project_path: allowedDir,
      image_path: 'shot.png',
    }, makeCtx());
    expect(result).not.toBeNull();
    expect(result!.content.some((c: any) => c.type === 'image')).toBe(true);
  });
});

// ─── #2: allowOutside imagePath 可读 allowed roots 外（leak）──────────────────
describe('screenshot analyze path-leak #2: allowOutside imagePath 校验', () => {
  let allowedDir: string;
  let outsideDir: string;
  let restore: () => void = () => {};

  beforeEach(() => {
    allowedDir = mkdtempSync(join(tmpdir(), 'allowed-'));
    outsideDir = mkdtempSync(join(tmpdir(), 'outside-'));
    writeFileSync(join(outsideDir, 'secret.png'), PNG_BYTES);
    // 白名单模式：清 UNRESTRICTED + 设 ALLOWED=allowedDir（allowOutside=true 但限 roots）
    restore = isolatePathEnv({ allowed: [allowedDir] });
  });

  afterEach(() => {
    restore();
    rmSync(allowedDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  });

  it('修复后: allowOutside image_path=outside 绝对路径 → throw（防 allowed roots 外读）', async () => {
    const result = handleTool('screenshot', {
      action: 'analyze',
      image_path: join(outsideDir, 'secret.png'),
    }, makeCtx());
    // :136 isPathInAllowedRoots(outside)=false（不在 ALLOWED=allowedDir）→ throw
    await expect(result).rejects.toThrow(/outside allowed project roots/);
  });

  it('反向: image_path=allowed 内不误拒', async () => {
    writeFileSync(join(allowedDir, 'shot.png'), PNG_BYTES);
    const result = await handleTool('screenshot', {
      action: 'analyze',
      image_path: join(allowedDir, 'shot.png'),
    }, makeCtx());
    expect(result).not.toBeNull();
    expect(result!.content.some((c: any) => c.type === 'image')).toBe(true);
  });
});

// ─── #3: roots 提示与判定同源(审查 NIT-2→I-E 红测)────────────────────────────
// mutation 锚定:把 describeAllowedRoots 改回「无条件列 cwd」(NIT-2 修复前形态)则
// 「不含 cwd」断言红;判定与提示的归一化链拆开(复刻式)则 realpath 失败条目断言失去保护。
describe('screenshot analyze path-leak #3: throwPathNotAllowed roots 与 isPathInAllowedRoots 同源', () => {
  it('allowlist 非空:消息含 allowlist 条目、不含 cwd(NIT-2:cwd 此时不放行,列它=误导)', async () => {
    const allowDir = mkdtempSync(join(tmpdir(), 'allow-'));
    const cwdDir = mkdtempSync(join(tmpdir(), 'cwdnotlisted-'));
    const outsideDir = mkdtempSync(join(tmpdir(), 'outside-'));
    writeFileSync(join(outsideDir, 'secret.png'), PNG_BYTES);
    const restore = isolatePathEnv({ allowed: [allowDir], cwd: cwdDir });
    try {
      let msg = '';
      try {
        await handleTool('screenshot', {
          action: 'analyze',
          image_path: join(outsideDir, 'secret.png'),
        }, makeCtx());
        expect.unreachable('should throw PathError');
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).toMatch(/outside allowed project roots/);
      expect(msg).toContain(basename(allowDir));      // I-E: 提示列 allowlist 条目
      expect(msg).not.toContain(basename(cwdDir));    // NIT-2: allowlist 非空不列 cwd
      expect(msg).not.toContain(outsideDir);          // P2-17: 不回显越权绝对路径
    } finally {
      restore();
      rmSync(allowDir, { recursive: true, force: true });
      rmSync(cwdDir, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('allowlist 为空:消息含 cwd fallback(此时 cwd 即放行根)', async () => {
    const cwdDir = mkdtempSync(join(tmpdir(), 'cwdfallback-'));
    const outsideDir = mkdtempSync(join(tmpdir(), 'outside-'));
    writeFileSync(join(outsideDir, 'secret.png'), PNG_BYTES);
    const restore = isolatePathEnv({ allowed: [], cwd: cwdDir });
    try {
      let msg = '';
      try {
        // 走 project_path 校验路径(空 allowlist 下 image_path 走 resolveWithinRoot 分支,
        // throwPathNotAllowed 不经 image_path 可达;project_path 路径 #1 测试已证默认模式可达)
        await handleTool('screenshot', {
          action: 'analyze',
          project_path: outsideDir,
          image_path: 'secret.png',
        }, makeCtx());
        expect.unreachable('should throw PathError');
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).toMatch(/outside allowed project roots/);
      expect(msg).toContain(basename(cwdDir));        // 空 allowlist → cwd 是唯一放行根,提示列它
      expect(msg).not.toContain(outsideDir);
    } finally {
      restore();
      rmSync(cwdDir, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
