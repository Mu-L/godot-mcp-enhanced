// src/tools/qa/index.ts — QA 测试套件编排工具（v0.30 B 批）
//
// 定位：把既有原语（bridge 输入/等待/断言、确定性 playtest、截图证据）编排成
// "规范 → 执行 → 报告 → 回归 diff" 的闭环，对标商业 AI QA 工具（StraySpark 模式）
// 的免费开源实现。三个 action：
//   run    — 执行套件（inline spec / spec 文件），落盘 ~/.godot-mcp/qa-reports
//   report — 读报告（'latest'/'prev'/路径/文件名）
//   diff   — 两份报告按用例对比（回归/修复/新增/移除）
//
// 安全：run 声明 'process' 风险（安装 bridge + 起游戏 + 输入/写状态），
// 经 ToolDispatcher 的 confirm+audit 门一次性覆盖整个套件（与 confirm_and_execute
// 对已确认操作直调模块的语义一致）；report/diff 只读。
// call 步骤受 bridge 只读白名单 + GODOT_MCP_BRIDGE_EXTRA_METHODS 约束，不绕过。

import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Tool } from '@modelcontextprotocol/server';
import type { ToolResult, ToolContext } from '../../types.js';
import { textResult } from '../../types.js';
import { opsErrorResult } from '../shared.js';
import { requireProjectPath } from '../../helpers.js';
import { isPathInAllowedRoots } from '../../core/path-utils.js';
import { parseQaSuite } from './spec.js';
import { runQaSuite } from './runner.js';
import { writeReport, readReport, listReports, diffReports, type QaReport } from './report.js';

// C-1 惯例：导出 TOOL_NAMES 供 scripts/check-tool-groups.mjs 归组对账（audit 第 4 次游离教训）
const TOOL_NAMES = ['qa'] as const;
export { TOOL_NAMES };

export function getToolDefinitions(): Tool[] {
  return [{
    name: 'qa',
    description: 'QA 测试套件编排：结构化测试规范 → 自动安装 bridge → 运行游戏 → 逐步执行 → 聚合报告 + 回归 diff。'
      + '步骤类型：input/wait/wait_frames/freeze/unfreeze/step_until/snapshot/restore/set/call/'
      + 'watch_start|stop/monitor_start|stop/assert/screenshot/sleep；断言 8 种与各字段语义见 schema 字段 description。'
      + '报告落 ~/.godot-mcp/qa-reports/<run_id>.{json,md}。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['run', 'report', 'diff'],
          description: 'run=执行套件；report=读报告；diff=对比两份报告找回归',
        },
        // run
        // assert 8 种(node_state/scene_structure/screen_text/perf/screenshot_diff/signal/errors/monitor)
        // 的字段级语义在 spec.ts zod 注释与 runtime-assert schema description(Task 6),此处只做索引级概述,避免双份维护
        spec: { type: 'object', description: 'run: inline 套件 spec 对象。步骤为 discriminated union(type 字段决定形态)：input(method+params,bridge 原生参数)、wait(wait_for_node/wait_for_property 轮询)、wait_frames(1-60 帧确定性推进)、freeze/unfreeze、step_until(结构化条件{path,property,op,value}[]，规避 RCE)、snapshot/restore、set(写节点属性)、call(bridge 只读白名单方法，写方法需 GODOT_MCP_BRIDGE_EXTRA_METHODS)、watch_start(node_path+signal_name，单套件单 watch)、watch_stop、monitor_start(node_path+properties[]，单套件单 monitor)、monitor_stop、screenshot(证据落报告目录)、sleep。步骤带 label 便于 diff 对齐' },
        spec_path: { type: 'string', description: 'run: spec 文件路径(.json 或含 ```qa-spec 围栏的 .md)，大套件建议用文件避免 token 截断；须在 ALLOWED_PROJECT_PATHS 白名单内' },
        project_path: { type: 'string', description: 'run: 项目路径(覆盖 spec 内的 project_path；spec 未写时必填)' },
        // report / diff
        report_path: { type: 'string', description: 'report: 报告路径或 run_id；latest=最新，prev=次新' },
        base_path: { type: 'string', description: 'diff: 基线报告(默认 prev)' },
        head_path: { type: 'string', description: 'diff: 对比报告(默认 latest)' },
      },
      required: ['action'],
    },
  }];
}

export const TOOL_META = {
  'qa': {
    readonly: false,
    long_running: true,
    actionRisks: {
      run: 'process' as const,  // 装 bridge + 起游戏 + 输入/写游戏状态：dispatcher 层 confirm+audit 一次覆盖
      report: 'read' as const,
      diff: 'read' as const,
    },
  },
};

export async function handleTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult | null> {
  if (name !== 'qa') return null;
  const action = args.action as string;

  try {
    switch (action) {
      case 'run':
        return await handleRun(args, ctx);
      case 'report':
        return handleReport(args);
      case 'diff':
        return handleDiff(args);
      default:
        return opsErrorResult('UNKNOWN_ACTION', `Unknown action: ${action}（可用：run/report/diff）`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return opsErrorResult('QA_ERROR', `qa.${action} 失败: ${msg}`);
  }
}

// ─── run ─────────────────────────────────────────────────────────────────────

async function handleRun(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  let specInput: unknown;
  let specSource: QaReport['suite']['spec_source'] = 'inline';
  if (args.spec !== undefined && args.spec !== null) {
    specInput = args.spec;
  } else if (typeof args.spec_path === 'string' && args.spec_path) {
    // 审查 Important-1 修复：spec_path 是文件读取入口，必须与 project_path 同标准过
    // ALLOWED_PROJECT_PATHS 白名单（此前是全 src/tools 唯一 readFileSync(args.*) 直读口子）
    const specAbs = resolve(args.spec_path);
    if (!isPathInAllowedRoots(specAbs)) {
      return opsErrorResult('INVALID_PATH',
        `spec_path 不在 ALLOWED_PROJECT_PATHS 白名单内: ${specAbs}。把 spec 文件放进白名单根内，或改用 inline spec 参数。`);
    }
    try {
      specInput = readFileSync(specAbs, 'utf-8');
      specSource = 'file';
    } catch (err) {
      return opsErrorResult('INVALID_PARAMS', `spec_path 不可读: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    return opsErrorResult('INVALID_PARAMS', 'run 需要 spec（inline 对象）或 spec_path（文件路径）');
  }

  const parsed = parseQaSuite(specInput);
  if (!parsed.ok || !parsed.suite) {
    return opsErrorResult('INVALID_SPEC', parsed.error ?? 'spec 解析失败');
  }
  const suite = parsed.suite;

  const rawProject = (typeof args.project_path === 'string' && args.project_path) || suite.project_path;
  if (!rawProject) {
    return opsErrorResult('INVALID_PARAMS', '缺少 project_path（工具参数或 spec 内至少提供一处）');
  }
  let projectPath: string;
  try {
    projectPath = requireProjectPath({ project_path: rawProject });
  } catch (err) {
    return opsErrorResult('INVALID_PATH', err instanceof Error ? err.message : String(err));
  }

  const report = await runQaSuite(suite, projectPath, ctx, specSource);
  const paths = writeReport(report);

  // 响应只带摘要 + 紧凑步骤表（完整 mismatch/证据在报告文件里，防响应膨胀）
  const stepsCondensed = report.steps.map(s => ({
    index: s.index,
    label: s.label,
    type: s.type,
    status: s.status,
    detail: s.detail?.slice(0, 120),
    skip_reason: s.skip_reason,
    screenshot: s.evidence?.screenshot_path,
  }));
  return textResult(JSON.stringify({
    success: true,
    data: {
      run_id: report.run_id,
      // CLI nightly（同套件上次基线 diff）与 audit 留痕需要；报告 json 内同源
      suite_name: report.suite.name,
      project_path: report.suite.project_path,
      summary: report.summary,
      setup_error: report.setup_error,
      recording: report.recording_path,
      steps: stepsCondensed,
      report: paths,
    },
    warnings: report.teardown_warnings ?? [],
  }));
}

// ─── report ──────────────────────────────────────────────────────────────────

function handleReport(args: Record<string, unknown>): ToolResult {
  const ref = typeof args.report_path === 'string' && args.report_path ? args.report_path : 'latest';
  try {
    const report = readReport(ref);
    return textResult(JSON.stringify({ success: true, data: { report } }));
  } catch (err) {
    return opsErrorResult('REPORT_NOT_FOUND', err instanceof Error ? err.message : String(err),
      { suggestion: `可用报告: ${listReports().slice(0, 10).join(', ') || '(无)'}` });
  }
}

// ─── diff ────────────────────────────────────────────────────────────────────

function handleDiff(args: Record<string, unknown>): ToolResult {
  const baseRef = typeof args.base_path === 'string' && args.base_path ? args.base_path : 'prev';
  const headRef = typeof args.head_path === 'string' && args.head_path ? args.head_path : 'latest';
  try {
    const base = readReport(baseRef);
    const head = readReport(headRef);
    if (base.run_id === head.run_id) {
      return opsErrorResult('INVALID_PARAMS', `base 与 head 是同一份报告 (${base.run_id})`);
    }
    return textResult(JSON.stringify({ success: true, data: diffReports(base, head) }));
  } catch (err) {
    return opsErrorResult('REPORT_NOT_FOUND', err instanceof Error ? err.message : String(err),
      { suggestion: `可用报告: ${listReports().slice(0, 10).join(', ') || '(无)'}` });
  }
}
