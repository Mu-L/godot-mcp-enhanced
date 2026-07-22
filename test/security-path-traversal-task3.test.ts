// test/security-path-traversal-task3.test.ts
// 批次 A 安全修复 Task 3: A3 workflow user:// 分支 .. 段拒绝×3
// 三处 startsWith('user://') 放行分支补 hasTraversalSegments 检查：
//   1. bridge.screenshot.path（写逃逸，dev_loop bridge 步）
//   2. reference_path（读逃逸，screenshot_diff 断言，经 Image.load_from_file）
//   3. frames_dir（读逃逸，frame_degradation 断言，经 DirAccess.open 遍历）
// 参考 test/security-path-traversal-task2.test.ts 的独立文件模式。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ─── Mocks ──────────────────────────────────────────────────────────────────
// executeGdscript 返回 compile_success+run_success 使 dev_loop 到达 bridge/acceptance 步
vi.mock('../src/tools/spawn-helper.js', () => ({
  spawnGodot: vi.fn(async () => ({
    stdout: '', stderr: '', output: '', exitCode: 0, timedOut: false,
  })),
}));
vi.mock('../src/gdscript-executor.js', () => ({
  executeGdscript: vi.fn(async () => ({ compile_success: true, run_success: true, outputs: [] })),
  executeGdscriptTrusted: vi.fn(async () => ({ compile_success: true, run_success: true, outputs: [] })),
  scanGdscriptSandbox: vi.fn(() => []),
}));
vi.mock('../src/tools/game-bridge.js', () => ({
  // ping 返回无 .error → connected=true；take_screenshot 返回无 .error → 截图成功
  sendToBridge: vi.fn(async () => ({ status: 'ok' })),
  setBridgeProjectDir: vi.fn(),
  BRIDGE_READ_ONLY_METHODS: new Set(),
}));

// ─── Import (after mocks) ───────────────────────────────────────────────────
import { handleTool as workflowHandle } from '../src/tools/workflow.js';

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

// ─── Tests ──────────────────────────────────────────────────────────────────
describe('Task 3: A3 workflow user://.. traversal rejection ×3', () => {
  let tmpProj: string;

  beforeEach(() => {
    tmpProj = mkdtempSync(join(tmpdir(), 'task3-sec-'));
    writeFileSync(join(tmpProj, 'project.godot'), '[application]\nname="Test"\n');
  });

  afterEach(() => {
    rmSync(tmpProj, { recursive: true, force: true });
  });

  // ── 1. bridge.screenshot.path（写逃逸）──
  describe('bridge.screenshot.path user://.. 写逃逸被拒', () => {
    it('rejects user://../../evil.png before take_screenshot', async () => {
      // 修复前: startsWith('user://') 放行 → sendToBridge('take_screenshot') 写到 user:// 上级目录
      // 修复后: hasTraversalSegments 拦截 → success:false error 'path traversal blocked'
      const r = await workflowHandle('workflow', {
        action: 'dev_loop',
        project_path: tmpProj,
        code: 'pass',
        bridge: { screenshot: { path: 'user://../../evil.png' } },
      }, makeCtx());
      const parsed = JSON.parse(r!.content[0].text);
      expect(parsed.step2_bridge.screenshot.success).toBe(false);
      expect(parsed.step2_bridge.screenshot.error).toMatch(/traversal/i);
    });
  });

  // ── 2. reference_path（读逃逸，screenshot_diff）──
  describe('screenshot_diff reference_path user://.. 读逃逸被拒', () => {
    it('rejects user://../../evil.png before Image.load_from_file', async () => {
      // 修复前: startsWith('user://') 放行 → referencePath 直传 GDScript Image.load_from_file
      // 修复后: hasTraversalSegments 拦截 → passed:false error 'path traversal blocked'
      const r = await workflowHandle('workflow', {
        action: 'dev_loop',
        project_path: tmpProj,
        code: 'pass',
        acceptance: {
          assertions: [{
            type: 'screenshot_diff',
            description: 'ref-traversal',
            reference_path: 'user://../../evil.png',
          }],
        },
      }, makeCtx());
      const parsed = JSON.parse(r!.content[0].text);
      expect(parsed.acceptance.results[0].passed).toBe(false);
      expect(parsed.acceptance.results[0].error).toMatch(/traversal/i);
    });
  });

  // ── 3. frames_dir（读逃逸，frame_degradation）──
  describe('frame_degradation frames_dir user://.. 读逃逸被拒', () => {
    it('rejects user://../../evil before DirAccess.open traversal', async () => {
      // 修复前: startsWith('user://') 放行 → framesDir 直传 GDScript DirAccess.open 遍历
      // 修复后: hasTraversalSegments 拦截 → passed:false error 'path traversal blocked'
      const r = await workflowHandle('workflow', {
        action: 'dev_loop',
        project_path: tmpProj,
        code: 'pass',
        acceptance: {
          assertions: [{
            type: 'frame_degradation',
            description: 'frames-traversal',
            frames_dir: 'user://../../evil',
          }],
        },
      }, makeCtx());
      const parsed = JSON.parse(r!.content[0].text);
      expect(parsed.acceptance.results[0].passed).toBe(false);
      expect(parsed.acceptance.results[0].error).toMatch(/traversal/i);
    });
  });
});
