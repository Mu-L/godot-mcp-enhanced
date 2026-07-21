import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleTool } from '../src/tools/screenshot.js';
import { _resetPathAllowWarned } from '../src/core/path-utils.js';

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
  const origCwd = process.cwd();

  beforeEach(() => {
    allowedDir = mkdtempSync(join(tmpdir(), 'allowed-'));
    outsideDir = mkdtempSync(join(tmpdir(), 'outside-'));
    writeFileSync(join(outsideDir, 'secret.png'), PNG_BYTES);
    vi.stubEnv('GODOT_MCP_UNRESTRICTED', '');   // 清 setup.js 设的 UNRESTRICTED
    delete process.env.ALLOWED_PROJECT_PATHS;    // 默认模式（无白名单）
    process.chdir(allowedDir);                    // cwd 回落 = allowed root
    _resetPathAllowWarned();
  });

  afterEach(() => {
    process.chdir(origCwd);
    vi.unstubAllEnvs();
    delete process.env.ALLOWED_PROJECT_PATHS;
    _resetPathAllowWarned();
    rmSync(allowedDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  });

  it('修复后: project_path=outside image_path=相对 → throw（默认模式防任意目录读）', async () => {
    const result = handleTool('screenshot', {
      action: 'analyze',
      project_path: outsideDir,
      image_path: 'secret.png',
    }, makeCtx());
    // 修复前（leak）: resolveWithinRoot(outsideDir,'secret.png') 读成功（rejects.toThrow 失败 = RED）
    // 修复后: :127 isPathInAllowedRoots(outsideDir)=false（不在 cwd=allowedDir）→ throw
    await expect(result).rejects.toThrow(/not in ALLOWED_PROJECT_PATHS/);
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
