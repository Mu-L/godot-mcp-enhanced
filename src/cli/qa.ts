/** qa 命令 — CLI 侧 QA 套件执行 / 报告 / 回归 diff（夜间跑批入口）
 *
 * 用法:
 *   godot-mcp-enhanced qa run <spec.json|spec.md> [--project <path>] [--json]
 *   godot-mcp-enhanced qa report [latest|prev|<run_id>]
 *   godot-mcp-enhanced qa diff [base] [head]        （默认 prev vs latest）
 *
 * MCP 工具 qa 的同源 CLI 包装：直接调 tools/qa 的 handleTool（进程内，不起 MCP server），
 * ctx 仿 e2e makeCtx 模式委托 process-state 单例。
 */
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ToolContext } from '../types.js';
import { parseGodotConfig } from '../helpers.js';
import { findGodot } from '../core/godot-finder.js';
import * as ps from '../core/process-state.js';
import * as qaTool from '../tools/qa/index.js';

const __cliDir = dirname(fileURLToPath(import.meta.url));
const __rootDir = join(__cliDir, '..', '..');

function makeCtx(): ToolContext {
  return {
    opsScript: join(__rootDir, 'scripts', 'godot_operations.gd'),
    findGodot,
    get runningProcess() { return ps.getRunningProcess(); },
    setRunningProcess(proc, skipBusyCheck?) { ps.setRunningProcess(proc, skipBusyCheck); },
    get outputBuffer() { return ps.getOutputBuffer(); },
    setOutputBuffer(buf: string[]) { ps.setOutputBuffer(buf); },
    get processStartTime() { return ps.getProcessStartTime(); },
    setProcessStartTime(t: number) { ps.setProcessStartTime(t); },
    get projectDir() { return ps.getProjectDir(); },
    setProjectDir(d: string) { ps.setProjectDir(d); },
    parseGodotConfig,
  };
}

function usage(): void {
  console.log(`godot-mcp-enhanced qa — QA 测试套件（夜间跑批）

用法:
  qa run <spec> [--project <path>] [--json]   执行套件（.json 或含 \`\`\`qa-spec 围栏的 .md）
  qa report [latest|prev|<run_id>]            读报告（默认 latest）
  qa diff [base] [head]                       回归对比（默认 prev vs latest）

退出码: run 按套件结果 0=PASSED / 1=FAILED；参数错误 2。`);
}

function parseFlag(rest: string[], name: string): { value?: string; positional: string[] } {
  const out: string[] = [];
  let value: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === name && rest[i + 1]) {
      value = rest[i + 1];
      i++;
    } else {
      out.push(rest[i]!);
    }
  }
  return { value, positional: out };
}

/** 解析 handleTool 的 textResult JSON；返回 {json, isError} */
async function callQa(action: string, args: Record<string, unknown>): Promise<{ json: Record<string, unknown> | null; text: string; isError: boolean }> {
  const res = await qaTool.handleTool('qa', { action, ...args }, makeCtx());
  if (!res) return { json: null, text: 'null result', isError: true };
  const text = res.content[0]?.type === 'text' ? res.content[0].text : '';
  try {
    return { json: JSON.parse(text) as Record<string, unknown>, text, isError: res.isError === true };
  } catch {
    return { json: null, text, isError: res.isError === true };
  }
}

export async function runQa(args: string[]): Promise<void> {
  const [verb, ...rest] = args;

  if (verb === 'run') {
    const { value: project, positional } = parseFlag(rest, '--project');
    const asJson = rest.includes('--json');
    const specPath = positional[0];
    if (!specPath) {
      usage();
      process.exit(2);
    }
    const runArgs: Record<string, unknown> = { action: 'run', spec_path: specPath };
    if (project) runArgs.project_path = project;
    const { json, text, isError } = await callQa('run', runArgs);
    if (isError || !json || json.success !== true) {
      console.error(text);
      process.exit(2);
    }
    const data = json.data as {
      run_id: string;
      summary: { status: string; passed: number; failed: number; errors: number; skipped: number; total: number; duration_ms: number };
      report: { json_path: string; md_path: string };
    };
    if (asJson) {
      console.log(JSON.stringify(json.data, null, 2));
    } else {
      const s = data.summary;
      console.log(`QA ${data.summary.status}: ${s.passed} passed / ${s.failed} failed / ${s.errors} errors / ${s.skipped} skipped (${(s.duration_ms / 1000).toFixed(1)}s)`);
      console.log(`  report: ${data.report.md_path}`);
    }
    process.exit(data.summary.status === 'PASSED' ? 0 : 1);
  }

  if (verb === 'report') {
    const { json, text, isError } = await callQa('report', { action: 'report', report_path: rest[0] ?? 'latest' });
    if (isError || !json || json.success !== true) {
      console.error(text);
      process.exit(2);
    }
    console.log(JSON.stringify((json.data as { report: unknown }).report, null, 2));
    return;
  }

  if (verb === 'diff') {
    const { json, text, isError } = await callQa('diff', {
      action: 'diff',
      base_path: rest[0] ?? 'prev',
      head_path: rest[1] ?? 'latest',
    });
    if (isError || !json || json.success !== true) {
      console.error(text);
      process.exit(2);
    }
    const d = json.data as { verdict: string; regressions: unknown[]; fixed: unknown[]; added: unknown[]; removed: unknown[]; base_run_id: string; head_run_id: string };
    console.log(`diff ${d.base_run_id} → ${d.head_run_id}: ${d.verdict}`);
    console.log(`  regressions: ${d.regressions.length}, fixed: ${d.fixed.length}, added: ${d.added.length}, removed: ${d.removed.length}`);
    for (const r of d.regressions as { case: string; head_detail?: string }[]) {
      console.log(`  REGRESSION  ${r.case}${r.head_detail ? ` — ${r.head_detail}` : ''}`);
    }
    process.exit(d.verdict === 'REGRESSED' ? 1 : 0);
  }

  usage();
  process.exit(2);
}
