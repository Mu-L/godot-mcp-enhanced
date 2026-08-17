// test/qa-screenshot-diff-step.test.ts — qa runner 的 assert screenshot_diff 步骤传参(Task PR-1a Task 7)
//
// 传参断言必须在独立文件 mock runtime-assert(ESM 命名导出无法 vi.spyOn;
// qa-runner.test.ts 用真实现验降级语义,本文件 mock 后精确断言 reference/threshold/
// max_diff_ratio/project_path/evidence_path 到达 assertScreenshotDiff + PASSED evidence 回填)。
// mock 惯例对照 qa-runner.test.ts 适配(偏离 brief 原文处见 task-7-report):
// - runtime handleTool 须返回含 'Bridge ready' 文本(brief 返回 {success:true} JSON → failSetup);
// - suite 走 parseQaSuite(不绕过 zod,threshold 需 spec schema 回加才不被 strip);
// - ctx 字面量补全 projectDir/setProjectDir/parseGodotConfig;
// - GODOT_MCP_QA_REPORTS_DIR 用 mkdtemp tmp(brief 的 'D:/tmp-qarep' 会在 D 盘根建目录)。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { textResult } from '../src/types.js';

vi.mock('../src/tools/game-bridge.js', () => ({
  sendToBridge: vi.fn().mockResolvedValue({ result: {} }),
  setBridgeProjectDir: vi.fn(),
  handleTool: vi.fn().mockResolvedValue(textResult(JSON.stringify({ success: true }))),
}));

vi.mock('../src/tools/runtime.js', () => ({
  handleTool: vi.fn().mockImplementation(async (_n: unknown, args: Record<string, unknown>) =>
    textResult(String(args.action) === 'run_project' ? 'Bridge ready. Running project.' : 'Stopped.')),
}));

vi.mock('../src/tools/runtime-assert.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/tools/runtime-assert.js')>();
  return {
    ...orig,
    // 回显 evidence_path 进 details:一并覆盖 runner PASSED 分支的 evidence 回填(brief Step 3c)
    assertScreenshotDiff: vi.fn(async (a: Record<string, unknown>) =>
      textResult(JSON.stringify({ success: true, passed: true, action: 'screenshot_diff', details: { evidence_path: a.evidence_path } }))),
  };
});

import { assertScreenshotDiff } from '../src/tools/runtime-assert.js';
import { runQaSuite } from '../src/tools/qa/runner.js';
import { parseQaSuite, type QaSuite } from '../src/tools/qa/spec.js';
import { qaReportsDir } from '../src/tools/qa/report.js';
import type { ToolContext } from '../src/types.js';

const PROJECT = 'D:/proj';

function makeCtx(): ToolContext {
  return {
    opsScript: '',
    findGodot: async () => 'godot',
    runningProcess: null,
    setRunningProcess: () => {},
    outputBuffer: [],
    setOutputBuffer: () => {},
    processStartTime: 0,
    setProcessStartTime: () => {},
    projectDir: '',
    setProjectDir: () => {},
    parseGodotConfig: () => ({}),
  };
}

function suite(overrides: Record<string, unknown> = {}): QaSuite {
  const parsed = parseQaSuite({ name: 'sd', project_path: PROJECT, ...overrides });
  if (!parsed.ok || !parsed.suite) throw new Error(parsed.error ?? 'bad suite');
  return parsed.suite;
}

let dir: string;
const prevEnv = process.env.GODOT_MCP_QA_REPORTS_DIR;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qa-sd-step-'));
  process.env.GODOT_MCP_QA_REPORTS_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (prevEnv === undefined) delete process.env.GODOT_MCP_QA_REPORTS_DIR;
  else process.env.GODOT_MCP_QA_REPORTS_DIR = prevEnv;
});

describe('qa runner screenshot_diff 步骤传参', () => {
  it('reference/threshold/max_diff_ratio/project_path/evidence_path 正确传给 assertScreenshotDiff,diff 图路径回填 evidence', async () => {
    const s = suite({
      steps: [
        { type: 'assert', assert: 'screenshot_diff', reference: 'res://refs/a.png', threshold: 0.2, max_diff_ratio: 0.1 },
      ],
    });
    const report = await runQaSuite(s, PROJECT, makeCtx(), 'inline');

    expect(vi.mocked(assertScreenshotDiff)).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(assertScreenshotDiff).mock.calls[0]![0];
    expect(arg.reference).toBe('res://refs/a.png');
    expect(arg.threshold).toBe(0.2);
    expect(arg.max_diff_ratio).toBe(0.1);
    expect(arg.project_path).toBe(PROJECT);
    // evidence_path = join(qaReportsDir(), `${runId}-step0-diff.png`)
    expect(arg.evidence_path).toBe(join(qaReportsDir(), `${report.run_id}-step0-diff.png`));

    // PASSED 分支 evidence 回填(brief Step 3c):details.evidence_path → StepRecord.evidence.screenshot_path
    expect(report.steps[0]!.status).toBe('PASSED');
    expect(report.steps[0]!.evidence?.screenshot_path).toBe(join(qaReportsDir(), `${report.run_id}-step0-diff.png`));
  });

  it('FAILED 时也回填染红图 evidence(Task 8 顺手修 Task 7 审查 Minor①)', async () => {
    // mockResolvedValueOnce 优先于工厂 mockImplementation:单次切 FAILED 形态
    vi.mocked(assertScreenshotDiff).mockResolvedValueOnce(textResult(JSON.stringify({
      success: true, passed: false, action: 'screenshot_diff',
      mismatch: { diff_ratio: { expected: '<=0.2', actual: 0.5 } },
      details: { evidence_path: join(qaReportsDir(), 'fake-diff.png') },
    })));
    const s = suite({
      steps: [
        { type: 'assert', assert: 'screenshot_diff', reference: 'res://refs/a.png', threshold: 0.2 },
      ],
    });
    const report = await runQaSuite(s, PROJECT, makeCtx(), 'inline');

    expect(report.steps[0]!.status).toBe('FAILED');
    // 失败时染红图是排错关键证据:FAILED 返回对象同样回填 evidence(与 PASSED 同款取值)
    expect(report.steps[0]!.evidence?.screenshot_path).toBe(join(qaReportsDir(), 'fake-diff.png'));
    expect(report.steps[0]!.mismatch).toEqual({ diff_ratio: { expected: '<=0.2', actual: 0.5 } });
  });
});
