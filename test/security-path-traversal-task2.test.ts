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

  // ─── I1 (2026-07-23 final review): A2 合法 scene → godot CLI 收到相对路径 ──────
  // 修复前(b592a23): safeScene = resolveWithinRoot(...) → 绝对路径（如 tmpProj\main.tscn）
  //   → cmdArgs.push(绝对路径) → godot CLI 收到项目绝对路径而非项目内相对路径（功能性回归）。
  // 修复后: resolveWithinRoot 仅校验，safeScene = normalized → cmdArgs 收到 'scenes/main.tscn'。
  // 断言: spawnGodot 主调用的 cmdArgs 末尾元素是相对 scene 路径，非项目绝对路径。
  describe('A2: validation run_and_verify 合法 scene 格式(I1 回归保护)', () => {
    it('legitimate scene → cmdArgs 收到相对路径(非绝对)', async () => {
      const { spawnGodot } = await import('../src/tools/spawn-helper.js');
      vi.clearAllMocks();
      const r = await validationHandle('validation', {
        action: 'run_and_verify',
        project_path: tmpProj,
        scene: 'scenes/main.tscn',
      }, makeCtx());
      // 1. 合法路径不应 reject / 报错（功能性不破坏）
      expect(r).toBeDefined();
      // 2. spawnGodot 被调用（tmpProj 无 .gd 文件 → precheck 跳过 → 仅主调用触发一次）
      expect(spawnGodot).toHaveBeenCalled();
      // 3. 主调用 cmdArgs 末尾元素是相对 scene 路径
      //    cmdArgs = ['--headless', '--path', tmpProj, safeScene]（I1 fix 后 safeScene='scenes/main.tscn'）
      const calls = vi.mocked(spawnGodot).mock.calls;
      const mainCall = calls.find(c =>
        Array.isArray(c[1]) && (c[1] as string[]).some(a => a.includes('scenes/main.tscn')));
      expect(mainCall, '主 cmdArgs 应含 scene 路径').toBeDefined();
      const cmdArgs = mainCall![1] as string[];
      const sceneArg = cmdArgs[cmdArgs.length - 1];
      expect(sceneArg).toBe('scenes/main.tscn');  // 相对路径
      // 4. 反向: 非项目绝对路径(I1 bug 复发会让 sceneArg 含 tmpProj)
      expect(sceneArg).not.toMatch(tmpProj.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
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
  // review Important #1: scene_path 含 `..` 不再 throw（slot 泄漏 DoS），
  // 改为 catch + releaseShortRunningSlot + 返 INVALID_PATH 错误结果。
  describe('A7: scene create_scene scene_path traversal', () => {
    it('rejects create_scene scene_path with `..` segment (no throw, releases slot)', async () => {
      // 修复前(b592a23): resolveWithinRoot 裸调抛 Error，slot 不释放
      // 修复后: catch + releaseShortRunningSlot + opsErrorResult('INVALID_PATH')
      const r = await sceneHandle('scene', {
        action: 'create_scene',
        project_path: tmpProj,
        scene_path: '../outside/evil.tscn',
      }, makeCtx());
      expect(r?.isError).toBe(true);
      expect(JSON.parse(r!.content[0].text).error_code).toBe('INVALID_PATH');
    });
  });

  describe('A7: scene save_scene scene_path traversal', () => {
    it('rejects save_scene scene_path with `..` segment (no throw, releases slot)', async () => {
      const r = await sceneHandle('scene', {
        action: 'save_scene',
        project_path: tmpProj,
        scene_path: '../outside/evil.tscn',
      }, makeCtx());
      expect(r?.isError).toBe(true);
      expect(JSON.parse(r!.content[0].text).error_code).toBe('INVALID_PATH');
    });
  });

  describe('A7: scene load_sprite scene_path traversal', () => {
    it('rejects load_sprite scene_path with `..` segment (no throw, releases slot)', async () => {
      const r = await sceneHandle('scene', {
        action: 'load_sprite',
        project_path: tmpProj,
        scene_path: '../outside/evil.tscn',
        texture_path: 'res://icon.svg',
        node_path: 'root',
      }, makeCtx());
      expect(r?.isError).toBe(true);
      expect(JSON.parse(r!.content[0].text).error_code).toBe('INVALID_PATH');
    });
  });

  // review Important #1: slot 释放验证——连续 3 次恶意 scene_path 后第 4 次合法调用
  // 不应 CONCURRENCY_LIMIT（证明 slot 已释放，非 DoS）。
  describe('A7: scene_path slot release (review Important #1)', () => {
    it('3x malicious scene_path then 1x legitimate succeeds (no CONCURRENCY_LIMIT)', async () => {
      // 3 次恶意调用：每次应返 INVALID_PATH，不应 throw，不应泄漏 slot
      for (let i = 0; i < 3; i++) {
        const r = await sceneHandle('scene', {
          action: 'create_scene',
          project_path: tmpProj,
          scene_path: '../outside/evil.tscn',
        }, makeCtx());
        expect(r?.isError).toBe(true);
        expect(JSON.parse(r!.content[0].text).error_code).toBe('INVALID_PATH');
      }
      // 第 4 次合法调用：应成功，不应 CONCURRENCY_LIMIT
      // （若 slot 泄漏，3 次后 count=3=MAX，第 4 次 acquireShortRunningSlot 返 false → CONCURRENCY_LIMIT）
      const ok = await sceneHandle('scene', {
        action: 'create_scene',
        project_path: tmpProj,
        scene_path: 'scenes/new.tscn',
        root_node_type: 'Node2D',
      }, makeCtx());
      expect(ok?.isError).not.toBe(true);
      expect(ok!.content[0].text).toMatch(/create_scene/);
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
