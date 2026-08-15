// src/tools/qa/runner.ts — QA 套件顺序执行器
//
// 编排既有原语，不复制逻辑：
// - 生命周期：game-bridge handleTool(install) + runtime handleTool(run_project/stop_project)
//   （进程槽守卫/输出缓冲等热路径逻辑不重写；qa.run 本身在 dispatcher 层经 confirm+audit 门）
// - 步骤层：直调已导出的 sendToBridge / pollWaitCondition / computePlaytestTimeoutMs
// - 断言：复用 runtime-assert 导出的 4 个 assert 函数（同源防 drift）
//
// 语义：FAILED = 断言未满足（测试失败）；ERROR = 基础设施失败（bridge 断连/超时/校验拒绝）。
// 两者默认都中止剩余步骤（continue_on_failure=true 继续）；中止的剩余步骤记 SKIPPED。

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { ToolContext, ToolResult } from '../../types.js';
import {
  sendToBridge, setBridgeProjectDir, pollWaitCondition, computePlaytestTimeoutMs,
  validateBridgePath, validateWaitPropertyParams,
} from '../game-bridge.js';
import * as gameBridge from '../game-bridge.js';
import * as runtime from '../runtime.js';
import { assertNodeState, assertSceneStructure, assertScreenText, assertPerf } from '../runtime-assert.js';
import type { QaSuite, QaStep } from './spec.js';
import { makeRunId, qaReportsDir, type QaReport, type StepRecord } from './report.js';

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

/** 解析 ToolResult.content[0].text 为 JSON；失败返回 null（text 可能是纯文本错误） */
function parseToolJson(res: ToolResult): Record<string, unknown> | null {
  const text = res.content[0]?.type === 'text' ? res.content[0].text : undefined;
  if (typeof text !== 'string') return null;
  try {
    const v = JSON.parse(text);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function condense(v: unknown, max = 200): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return (s ?? '').slice(0, max);
}

export interface RunQaResult {
  report: QaReport;
  paths: { json_path: string; md_path: string };
}

/**
 * 执行 QA 套件并落盘报告。
 * @param suite 已校验的套件
 * @param projectPath 已通过白名单校验的绝对路径（index/CLI 层解析）
 * @param ctx 工具上下文（install 用 opsScript；run/stop 用进程槽；progress 可选）
 */
export async function runQaSuite(
  suite: QaSuite,
  projectPath: string,
  ctx: ToolContext,
  specSource: QaReport['suite']['spec_source'],
): Promise<QaReport> {
  const o = suite.options;
  const runId = makeRunId(suite.name);
  const startedAt = new Date();
  const startedMs = Date.now();

  const steps: StepRecord[] = suite.steps.map((s, i) => ({
    index: i,
    label: s.label,
    type: s.type,
    status: 'SKIPPED' as const,
    elapsed_ms: 0,
  }));

  const report: QaReport = {
    version: 1,
    run_id: runId,
    suite: { name: suite.name, project_path: projectPath, started_at: startedAt.toISOString(), spec_source: specSource },
    options: o as unknown as Record<string, unknown>,
    summary: { total: suite.steps.length, passed: 0, failed: 0, errors: 0, skipped: suite.steps.length, status: 'FAILED', duration_ms: 0 },
    steps,
  };

  let gameStarted = false;

  // finalize 放外层 finally：早退（setup error）/正常结束/异常路径都统一结算 summary
  /** setup 失败统一出口：记 setup_error + 全部步骤标 SKIPPED('setup failed') */
  const failSetup = (msg: string): QaReport => {
    report.setup_error = msg;
    for (const s of steps) s.skip_reason = 'setup failed';
    return report;
  };

  try {
    try {
      // ── setup：install → run → 确定性锚点 ──────────────────────────────────
      if (o.auto_install_bridge) {
        const r = await gameBridge.handleTool('game', { action: 'game_bridge_install', project_path: projectPath }, ctx);
        const text = r?.content[0]?.type === 'text' ? r.content[0].text : '';
        const json = parseToolJson(r ?? { content: [] });
        const ok = (json?.success === true) || text.includes('already registered');
        if (!ok) {
          return failSetup(`game_bridge_install 失败: ${condense(text)}`);
        }
      }

      setBridgeProjectDir(projectPath);

      if (o.auto_run) {
        const r = await runtime.handleTool('runtime', {
          action: 'run_project',
          project_path: projectPath,
          wait_for_bridge: true,
          bridge_timeout: o.bridge_timeout_s,
          timeout: o.run_timeout_s,
        }, ctx);
        const text = r?.content[0]?.type === 'text' ? r.content[0].text : '';
        if (!text.includes('Bridge ready')) {
          return failSetup(`run_project 失败: ${condense(text)}`);
        }
        gameStarted = true;
      } else {
        // 连接已运行的游戏：ping 探活，给出可行动的错误
        const resp = await sendToBridge('ping', {}, o.step_timeout_ms);
        if (resp.error) {
          return failSetup(`auto_run=false 但游戏 bridge 不可达 (ping: ${resp.error.message})。确认游戏已运行且已 game_bridge_install。`);
        }
      }

      if (o.seed !== undefined) {
        const resp = await sendToBridge('playtest.seed', { seed: o.seed }, o.step_timeout_ms);
        if (resp.error) return failSetup(`playtest.seed 失败: ${resp.error.message}`);
      }
      if (o.fixed_delta_hz !== undefined) {
        const resp = await sendToBridge('playtest.fixed_delta', { hz: o.fixed_delta_hz }, o.step_timeout_ms);
        if (resp.error) return failSetup(`playtest.fixed_delta 失败: ${resp.error.message}`);
      }

      // ── steps ──────────────────────────────────────────────────────────────
      let aborted: string | undefined;
      for (let i = 0; i < suite.steps.length; i++) {
        const step = suite.steps[i]!;
        const rec = steps[i]!;

        if (aborted) {
          rec.skip_reason = aborted;
          continue;
        }
        const remaining = o.suite_budget_ms - (Date.now() - startedMs);
        if (remaining <= 0) {
          rec.skip_reason = 'suite budget exhausted';
          aborted = 'suite budget exhausted';
          continue;
        }

        ctx.progress?.(i + 1, suite.steps.length, `qa step ${i + 1}/${suite.steps.length}: ${step.type}${step.label ? ` (${step.label})` : ''}`);
        const t0 = Date.now();
        const outcome = await execStep(step, o, runId, i);
        rec.elapsed_ms = Date.now() - t0;
        rec.status = outcome.status;
        rec.detail = outcome.detail;
        rec.mismatch = outcome.mismatch;
        rec.evidence = outcome.evidence;

        if (outcome.status !== 'PASSED' && !o.continue_on_failure) {
          aborted = `aborted after step ${i} (${step.type}${step.label ? ` "${step.label}"` : ''} ${outcome.status})`;
        }
      }
    } finally {
      // ── teardown：尽力收尾，失败只记警告不影响报告判定 ──────────────────────
      if (o.stop_after && gameStarted) {
        try {
          await runtime.handleTool('runtime', { action: 'stop_project' }, ctx);
        } catch (err) {
          report.teardown_warnings = [`stop_project 失败: ${err instanceof Error ? err.message : String(err)}`];
        }
      }
    }
  } finally {
    finalizeSummary(report, startedMs);
  }

  return report;
}

/** 统计 steps 状态 → summary（status = failed/errors/skipped>0 或 setup_error ? FAILED : PASSED） */
function finalizeSummary(report: QaReport, startedMs: number): void {
  let passed = 0, failed = 0, errors = 0, skipped = 0;
  for (const s of report.steps) {
    if (s.status === 'PASSED') passed++;
    else if (s.status === 'FAILED') failed++;
    else if (s.status === 'ERROR') errors++;
    else skipped++;
  }
  const anyNotPassed = failed > 0 || errors > 0 || skipped > 0;
  report.summary = {
    total: report.steps.length,
    passed, failed, errors, skipped,
    status: anyNotPassed || report.setup_error ? 'FAILED' : 'PASSED',
    duration_ms: Date.now() - startedMs,
  };
}

// ─── 单步执行 ────────────────────────────────────────────────────────────────

interface StepOutcome {
  status: 'PASSED' | 'FAILED' | 'ERROR';
  detail?: string;
  mismatch?: Record<string, { expected: unknown; actual: unknown }>;
  evidence?: { screenshot_path?: string };
}

type ResolvedOptions = QaSuite['options'];

async function execStep(step: QaStep, o: ResolvedOptions, runId: string, index: number): Promise<StepOutcome> {
  switch (step.type) {
    case 'input': {
      const pathErr = validateBridgePath(step.params);
      if (pathErr) return err(pathErr);
      const resp = await sendToBridge(step.method, step.params, o.step_timeout_ms);
      if (resp.error) return err(`bridge: ${resp.error.message}`);
      return { status: 'PASSED', detail: `${step.method} ok` };
    }
    case 'wait': {
      const pathErr = validateBridgePath(step.params) ?? validateWaitPropertyParams(step.method, step.params);
      if (pathErr) return err(pathErr);
      const totalMs = step.timeout_ms ?? o.wait_timeout_ms;
      const r = await pollWaitCondition(
        step.method,
        () => sendToBridge(step.method, step.params, Math.min(o.step_timeout_ms, totalMs)),
        totalMs,
        step.interval_ms ?? 500,
      );
      if (r.error) return err(`bridge: ${condense(r.error)}`);
      if (r.wait_completed === true) {
        return { status: 'PASSED', detail: `${step.method} satisfied in ${r.elapsed_ms}ms` };
      }
      return { status: 'FAILED', detail: `${step.method} 未在 ${totalMs}ms 内满足 (last: ${condense(r)})` };
    }
    case 'wait_frames': {
      const resp = await sendToBridge('playtest.step', { frames: step.frames }, computePlaytestTimeoutMs('playtest.step', undefined, o.step_timeout_ms));
      if (resp.error) return err(`bridge: ${resp.error.message}`);
      return { status: 'PASSED', detail: `stepped ${step.frames} frame(s)` };
    }
    case 'freeze':
    case 'unfreeze': {
      const resp = await sendToBridge(`playtest.${step.type}`, {}, o.step_timeout_ms);
      if (resp.error) return err(`bridge: ${resp.error.message}`);
      return { status: 'PASSED', detail: step.type };
    }
    case 'step_until': {
      const params: Record<string, unknown> = { conditions: step.conditions };
      if (step.max_frames !== undefined) params.max_frames = step.max_frames;
      if (step.wall_budget_ms !== undefined) params.wall_budget_ms = step.wall_budget_ms;
      const resp = await sendToBridge('playtest.step_until', params, computePlaytestTimeoutMs('playtest.step_until', step.wall_budget_ms, o.step_timeout_ms));
      if (resp.error) return err(`bridge: ${resp.error.message}`);
      return { status: 'PASSED', detail: condense(resp.result) };
    }
    case 'snapshot':
    case 'restore': {
      const resp = await sendToBridge(`playtest.${step.type}`, {}, o.step_timeout_ms);
      if (resp.error) return err(`bridge: ${resp.error.message}`);
      return { status: 'PASSED', detail: condense(resp.result, 120) || step.type };
    }
    case 'set': {
      const pathErr = validateBridgePath({ path: step.path });
      if (pathErr) return err(pathErr);
      const resp = await sendToBridge('set_node_property', { path: step.path, property: step.property, value: step.value }, o.step_timeout_ms);
      if (resp.error) return err(`bridge: ${resp.error.message}`);
      return { status: 'PASSED', detail: `${step.path}.${step.property} set` };
    }
    case 'call': {
      const pathErr = validateBridgePath({ path: step.path });
      if (pathErr) return err(pathErr);
      const resp = await sendToBridge('call_method', { path: step.path, method: step.method, args: step.args ?? [] }, o.step_timeout_ms);
      if (resp.error) return err(`bridge: ${resp.error.message}（写方法需 GODOT_MCP_BRIDGE_EXTRA_METHODS 放行）`);
      return { status: 'PASSED', detail: condense(resp.result, 120) || `${step.method} ok` };
    }
    case 'assert': {
      const args: Record<string, unknown> = { action: step.assert };
      for (const k of ['path', 'expect', 'tolerance', 'nodes', 'text', 'present', 'baseline'] as const) {
        const v = step[k];
        if (v !== undefined) args[k] = v;
      }
      const fn = step.assert === 'node_state' ? assertNodeState
        : step.assert === 'scene_structure' ? assertSceneStructure
        : step.assert === 'screen_text' ? assertScreenText
        : assertPerf;
      const res = await fn(args);
      const json = parseToolJson(res);
      if (!json) return err(`assert ${step.assert} 返回非 JSON: ${condense(res.content[0]?.type === 'text' ? res.content[0].text : '')}`);
      if (json.success === false) {
        return err(`assert ${step.assert}: ${condense(json.error)}`);
      }
      if (json.passed === true) {
        return { status: 'PASSED', detail: `assert ${step.assert} ok` };
      }
      return {
        status: 'FAILED',
        detail: `assert ${step.assert} mismatch`,
        mismatch: json.mismatch as Record<string, { expected: unknown; actual: unknown }> | undefined,
      };
    }
    case 'screenshot': {
      const resp = await sendToBridge('take_screenshot', {}, o.step_timeout_ms);
      if (resp.error) return err(`bridge: ${resp.error.message}`);
      const r = (resp.result ?? {}) as { image?: string };
      if (typeof r.image !== 'string' || r.image.length === 0) {
        return { status: 'FAILED', detail: 'take_screenshot 未返回 image 数据' };
      }
      const dir = qaReportsDir();
      mkdirSync(dir, { recursive: true });
      const p = join(dir, `${runId}-step${index}.png`);
      writeFileSync(p, Buffer.from(r.image, 'base64'));
      return { status: 'PASSED', detail: 'screenshot saved', evidence: { screenshot_path: p } };
    }
    case 'sleep': {
      await sleep(step.ms);
      return { status: 'PASSED', detail: `slept ${step.ms}ms` };
    }
  }
}

function err(message: string): StepOutcome {
  return { status: 'ERROR', detail: message };
}
