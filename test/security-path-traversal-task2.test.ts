// test/security-path-traversal-task2.test.ts
// 批次 A 安全修复 Task 2: A2/A6/A7/A9 TS 路径参数统一 resolveWithinRoot 校验
// 每处补 1 个越权拒绝用例（传 `..` 段期望 throw / error）。
// 参考 test/screenshot-analyze-path-leak.test.ts 的独立文件模式。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ─── Mocks (防御性：路径校验在 spawn 前抛错，不应到达这些 mock) ────────────────
vi.mock('../src/tools/spawn-helper.js', () => ({
  spawnGodot: vi.fn(async () => ({
    stdout: '', stderr: '', output: '', exitCode: 0, timedOut: false,
  })),
}));
vi.mock('../src/gdscript-executor.js', () => ({
  executeGdscript: vi.fn(async () => ({ success: true, outputs: [] })),
  executeGdscriptTrusted: vi.fn(async () => ({ success: true, outputs: [] })),
  scanGdscriptSandbox: vi.fn(() => []),
}));
vi.mock('../src/tools/game-bridge.js', () => ({
  sendToBridge: vi.fn(async () => ({ status: 'ok' })),
  setBridgeProjectDir: vi.fn(),
  BRIDGE_READ_ONLY_METHODS: new Set(),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────────────
import { handleTool as validationHandle } from '../src/tools/validation.js';
import { handleTool as workflowHandle } from '../src/tools/workflow.js';
import { handleTool as sceneHandle } from '../src/tools/scene.js';
import { handleTool as deliveryHandle } from '../src/tools/delivery.js';
import { handleTool as gameDesignHandle } from '../src/tools/game-design.js';
import { handleTool as batchHandle } from '../src/tools/batch-tools.js';

// ─── Context helper ─────────────────────────────────────────────────────────
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

// ─── Shared temp project fixture ────────────────────────────────────────────
describe('Task 2: TS path traversal hardening (A2/A6/A7/A9)', () => {
  let tmpProj: string;

  beforeEach(() => {
    tmpProj = mkdtempSync(join(tmpdir(), 'task2-sec-'));
    writeFileSync(join(tmpProj, 'project.godot'), '[application]\nname="Test"\n');
  });

  afterEach(() => {
    rmSync(tmpProj, { recursive: true, force: true });
  });

  // ─── A2: validation run_and_verify scene ────────────────────────────────
  describe('A2: validation run_and_verify scene traversal', () => {
    it('rejects scene path with `..` segment', async () => {
      // 修复前: cmdArgs.push(scene) 直接传给 godot CLI（越权读项目外 .tscn）
      // 修复后: resolveWithinRoot 抛 Path traversal detected
      await expect(validationHandle('validation', {
        action: 'run_and_verify',
        project_path: tmpProj,
        scene: '../outside/evil.tscn',
      }, makeCtx())).rejects.toThrow(/Path traversal detected/);
    });
  });

  // ─── A6: workflow batch_validate scripts ────────────────────────────────
  describe('A6: workflow batch_validate scripts traversal', () => {
    it('rejects script path with `..` segment', async () => {
      // 修复前: join(projectPath, '../outside') + existsSync → 信息泄露（路径存在性）
      // 修复后: resolveWithinRoot 抛 Path traversal detected
      await expect(workflowHandle('workflow', {
        action: 'batch_validate',
        project_path: tmpProj,
        scripts: ['../outside/evil.gd'],
      }, makeCtx())).rejects.toThrow(/Path traversal detected/);
    });
  });

  // ─── A7: scene create_scene / save_scene / load_sprite ──────────────────
  describe('A7: scene create_scene scene_path traversal', () => {
    it('rejects create_scene scene_path with `..` segment', async () => {
      // 修复前: normalizeUserProjectPath 无 resolveWithinRoot 包裹（越权传给 godot）
      // 修复后: resolveWithinRoot 抛 Path traversal detected
      await expect(sceneHandle('scene', {
        action: 'create_scene',
        project_path: tmpProj,
        scene_path: '../outside/evil.tscn',
      }, makeCtx())).rejects.toThrow(/Path traversal detected/);
    });
  });

  describe('A7: scene save_scene scene_path traversal', () => {
    it('rejects save_scene scene_path with `..` segment', async () => {
      await expect(sceneHandle('scene', {
        action: 'save_scene',
        project_path: tmpProj,
        scene_path: '../outside/evil.tscn',
      }, makeCtx())).rejects.toThrow(/Path traversal detected/);
    });
  });

  describe('A7: scene load_sprite scene_path traversal', () => {
    it('rejects load_sprite scene_path with `..` segment', async () => {
      await expect(sceneHandle('scene', {
        action: 'load_sprite',
        project_path: tmpProj,
        scene_path: '../outside/evil.tscn',
        texture_path: 'res://icon.svg',
        node_path: 'root',
      }, makeCtx())).rejects.toThrow(/Path traversal detected/);
    });
  });

  // ─── A9: delivery / game-design / batch-tools normalize 前置 ─────────────
  describe('A9: delivery verify_delivery scene_path res:// traversal', () => {
    it('rejects res://../outside after normalize', async () => {
      // 修复前: resolveWithinRoot(projectPath, 'res://../outside') — segments 含 '..' 也拒
      // 修复后: normalizeUserProjectPath 先剥 res:// → '../outside' → resolveWithinRoot 拒
      // 此测试为回归保护（确保 normalize 前置不削弱穿越拒绝）
      const result = await deliveryHandle('verify_delivery', {
        project_path: tmpProj,
        scope: 'scene',
        scene_path: 'res://../outside/evil.tscn',
      }, makeCtx());
      const parsed = JSON.parse(result!.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toMatch(/traversal/i);
    });
  });

  describe('A9: game-design validate_gdd gdd_path traversal', () => {
    it('rejects gdd_path with `..` segment', async () => {
      // 回归保护：normalize 前置不削弱穿越拒绝
      await expect(gameDesignHandle('game_design', {
        action: 'validate_gdd',
        project_path: tmpProj,
        gdd_path: '../outside/evil.json',
      }, makeCtx())).rejects.toThrow(/Path traversal detected/);
    });
  });

  describe('A9: batch-tools diff_scenes scene_a traversal', () => {
    it('rejects scene_a with `..` segment', async () => {
      // 回归保护：normalize 前置不削弱穿越拒绝
      await expect(batchHandle('batch', {
        action: 'diff_scenes',
        project_path: tmpProj,
        scene_a: '../outside/evil.tscn',
        scene_b: 'main.tscn',
      }, makeCtx())).rejects.toThrow(/Path traversal detected/);
    });
  });
});
