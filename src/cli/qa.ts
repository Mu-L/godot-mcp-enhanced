/** qa 命令 — CLI 侧 QA 套件执行 / 报告 / 回归 diff / 夜间跑批（nightly）
 *
 * 用法:
 *   godot-mcp-enhanced qa run <spec.json|spec.md> [--project <path>] [--json]
 *   godot-mcp-enhanced qa nightly <spec-dir> [--project <path>] [--json]
 *   godot-mcp-enhanced qa report [latest|prev|<run_id>]
 *   godot-mcp-enhanced qa diff [base] [head]        （默认 prev vs latest）
 *
 * MCP 工具 qa 的同源 CLI 包装：直接调 tools/qa 的 handleTool（进程内，不起 MCP server），
 * ctx 仿 e2e makeCtx 模式委托 process-state 单例。
 * NIT-7 修复：CLI 直调不经 ToolDispatcher（无 confirm/audit 门），run/nightly 成功后手动
 * appendAuditLine 留痕（best-effort，失败不阻断跑批）——夜间跑批的操作审计可追溯。
 */
import { join, dirname } from 'path';
import { readdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import type { ToolContext } from '../types.js';
import { parseGodotConfig } from '../helpers.js';
import { findGodot } from '../core/godot-finder.js';
import * as ps from '../core/process-state.js';
import * as qaTool from '../tools/qa/index.js';
import { findPreviousReport, diffReports, type QaReport } from '../tools/qa/report.js';
import { appendAuditLine } from '../core/audit-log.js';

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
  qa nightly <spec-dir> [--project <path>] [--json]
                                              跑目录下全部 *.json/*.md spec，每套件与
                                              上次同套件结果 diff，汇总回归清单
  qa report [latest|prev|<run_id>]            读报告（默认 latest）
  qa diff [base] [head]                       回归对比（默认 prev vs latest）

退出码: run/nightly 按套件结果 0=全 PASSED / 1=有 FAILED；参数错误 2。`);
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

/** NIT-7：CLI 直调不经 dispatcher 的 audit 门，手动留痕（best-effort，失败静默不阻断跑批） */
async function auditRun(data: {
  run_id: string; suite_name: string; project_path: string;
  summary: { status: string; duration_ms: number };
}): Promise<void> {
  try {
    await appendAuditLine(data.project_path, {
      timestamp: new Date().toISOString(),
      trace_id: `cli-qa-${data.run_id}`,
      tool: 'qa',
      action: 'run',
      risk: 'process',
      ok: data.summary.status === 'PASSED',
      project_path: data.project_path,
      changed_files: [],
      duration_ms: data.summary.duration_ms,
    });
  } catch { /* 审计失败不影响跑批（对齐 G2 catch 哲学） */ }
}

/** run 响应 data 的形态（index.ts handleRun 契约） */
interface RunData {
  run_id: string;
  suite_name: string;
  project_path: string;
  summary: { status: string; passed: number; failed: number; errors: number; skipped: number; total: number; duration_ms: number };
  report: { json_path: string; md_path: string };
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
    const data = json.data as RunData;
    await auditRun(data);
    if (asJson) {
      console.log(JSON.stringify(json.data, null, 2));
    } else {
      const s = data.summary;
      console.log(`QA ${data.summary.status}: ${s.passed} passed / ${s.failed} failed / ${s.errors} errors / ${s.skipped} skipped (${(s.duration_ms / 1000).toFixed(1)}s)`);
      console.log(`  report: ${data.report.md_path}`);
    }
    process.exit(data.summary.status === 'PASSED' ? 0 : 1);
  }

  if (verb === 'nightly') {
    const { value: project, positional } = parseFlag(rest, '--project');
    const asJson = rest.includes('--json');
    const specDir = positional[0];
    if (!specDir) {
      usage();
      process.exit(2);
    }
    let files: string[];
    try {
      files = readdirSync(specDir).filter(f => f.endsWith('.json') || f.endsWith('.md')).sort();
    } catch (err) {
      console.error(`spec 目录不可读: ${specDir} (${err instanceof Error ? err.message : String(err)})`);
      process.exit(2);
    }
    if (files.length === 0) {
      console.error(`目录内无 spec 文件(*.json / *.md): ${specDir}`);
      process.exit(2);
    }

    const results: Array<Record<string, unknown>> = [];
    let anyFailed = false;
    let regressions = 0;
    let fixed = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      const runArgs: Record<string, unknown> = { action: 'run', spec_path: join(specDir, f) };
      if (project) runArgs.project_path = project;
      const { json, text, isError } = await callQa('run', runArgs);
      if (isError || !json || json.success !== true) {
        // spec 解析/参数错误（套件未跑）：计入失败并继续后续套件
        anyFailed = true;
        results.push({ file: f, error: text.slice(0, 500) });
        if (!asJson) console.log(`[${i + 1}/${files.length}] ${f}: SPEC ERROR — ${text.slice(0, 200)}`);
        continue;
      }
      const data = json.data as RunData;
      await auditRun(data);
      const failed = data.summary.status !== 'PASSED';
      if (failed) anyFailed = true;

      // 与上次同套件结果 diff（首次运行无基线则跳过；基线读取失败不阻断）
      let diff: ReturnType<typeof diffReports> | null = null;
      try {
        const prev = findPreviousReport(data.run_id, data.suite_name);
        if (prev) {
          const head = JSON.parse(readFileSync(data.report.json_path, 'utf8')) as QaReport;
          diff = diffReports(prev, head);
          if (diff.verdict === 'REGRESSED') regressions += diff.regressions.length;
          fixed += diff.fixed.length;
        }
      } catch { /* 基线缺失/损坏：只报本次结果 */ }

      results.push({
        file: f,
        run_id: data.run_id,
        suite: data.suite_name,
        summary: data.summary,
        report: data.report,
        ...(diff ? { diff_vs: diff.base_run_id, diff } : { diff_vs: null }),
      });
      if (!asJson) {
        const s = data.summary;
        console.log(`[${i + 1}/${files.length}] ${f}: ${s.status} (${s.passed}/${s.total} passed, ${(s.duration_ms / 1000).toFixed(1)}s)`);
        console.log(`  report: ${data.report.md_path}`);
        if (diff) {
          console.log(`  vs 上次 ${diff.base_run_id}: ${diff.verdict} (regressions:${diff.regressions.length} fixed:${diff.fixed.length} added:${diff.added.length} removed:${diff.removed.length})`);
          for (const r of diff.regressions) {
            console.log(`    REGRESSION  ${r.case}${r.head_detail ? ` — ${r.head_detail.slice(0, 120)}` : ''}`);
          }
        } else {
          console.log('  vs 上次: (首次运行，无基线)');
        }
      }
    }

    const passedCount = results.filter(r => (r.summary as RunData['summary'] | undefined)?.status === 'PASSED').length;
    if (asJson) {
      console.log(JSON.stringify({ suites: results.length, passed: passedCount, failed: results.length - passedCount, regressions, fixed, results }, null, 2));
    } else {
      console.log(`\nnightly 汇总: ${results.length} 套件 · ${passedCount} PASSED / ${results.length - passedCount} FAILED · 回归 ${regressions} · 修复 ${fixed}`);
    }
    process.exit(anyFailed ? 1 : 0);
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
