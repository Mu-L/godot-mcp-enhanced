// src/tools/qa/report.ts — QA 报告落盘 / 读取 / 回归 diff
//
// 报告写 ~/.godot-mcp/qa-reports/<YYYYMMDD-HHmmss>-<suite>.{json,md}（不污染用户项目）。
// JSON 是 diff 的机器可读真相源；md 是人读摘要。run_id = 文件名 stem（时间戳+套件名）。

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export type StepStatus = 'PASSED' | 'FAILED' | 'ERROR' | 'SKIPPED';

export interface StepRecord {
  index: number;
  label?: string;
  type: string;
  status: StepStatus;
  /** 简短结果描述（错误消息/mismatch 摘要），≤200 字符 */
  detail?: string;
  /** SKIPPED 原因（budget exhausted / aborted after failure / setup failed） */
  skip_reason?: string;
  mismatch?: Record<string, { expected: unknown; actual: unknown }>;
  evidence?: { screenshot_path?: string };
  elapsed_ms: number;
}

export interface QaReport {
  version: 1;
  run_id: string;
  suite: {
    name: string;
    project_path: string;
    started_at: string; // ISO
    spec_source: 'inline' | 'file' | 'cli';
  };
  options: Record<string, unknown>;
  setup_error?: string;
  /** teardown（stop_project 等）尽力收尾的失败记录，不影响 status 判定 */
  teardown_warnings?: string[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    errors: number;
    skipped: number;
    status: 'PASSED' | 'FAILED';
    duration_ms: number;
  };
  steps: StepRecord[];
}

export function qaReportsDir(): string {
  // env 覆盖：测试隔离（tmp 目录）+ 用户可重定向报告位置
  return process.env.GODOT_MCP_QA_REPORTS_DIR || join(homedir(), '.godot-mcp', 'qa-reports');
}

/** 文件名安全化：非 [A-Za-z0-9_-] 一律 _ */
export function sanitizeSuiteName(name: string): string {
  const s = name.replace(/[^A-Za-z0-9_-]/g, '_').replace(/_{2,}/g, '_');
  return (s || 'suite').slice(0, 60);
}

export function timestampStem(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 落盘 .json + .md，返回两个路径 */
export function writeReport(report: QaReport): { json_path: string; md_path: string } {
  const dir = qaReportsDir();
  mkdirSync(dir, { recursive: true });
  const stem = report.run_id;
  const jsonPath = join(dir, `${stem}.json`);
  const mdPath = join(dir, `${stem}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
  writeFileSync(mdPath, renderMarkdown(report), 'utf-8');
  return { json_path: jsonPath, md_path: mdPath };
}

/** 构造 run_id（落盘前生成，screenshot 证据文件名也用它做前缀） */
export function makeRunId(suiteName: string): string {
  return `${timestampStem()}-${sanitizeSuiteName(suiteName)}`;
}

export function renderMarkdown(report: QaReport): string {
  const s = report.summary;
  const lines: string[] = [
    `# QA Report: ${report.suite.name}`,
    '',
    `- run_id: \`${report.run_id}\``,
    `- project: \`${report.suite.project_path}\``,
    `- started: ${report.suite.started_at} · duration: ${(s.duration_ms / 1000).toFixed(1)}s`,
    `- result: **${s.status}** (${s.passed} passed / ${s.failed} failed / ${s.errors} errors / ${s.skipped} skipped of ${s.total})`,
  ];
  if (report.setup_error) lines.push(`- setup error: ${report.setup_error}`);
  lines.push('', '| # | label | type | status | detail |', '|---|---|---|---|---|');
  for (const st of report.steps) {
    const label = st.label ?? '';
    const detail = (st.skip_reason ? `[skip] ${st.skip_reason}` : st.detail ?? '').replace(/\|/g, '\\|').slice(0, 160);
    lines.push(`| ${st.index} | ${label} | ${st.type} | ${st.status} | ${detail} |`);
  }
  return lines.join('\n') + '\n';
}

/** 列出报告文件名（stem.json，按时间倒序 = 最新在前） */
export function listReports(): string[] {
  const dir = qaReportsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse();
}

/** 读报告：'latest'/'prev'/空 → 最新/次新；否则绝对路径、dir 内文件名或 run_id */
export function readReport(pathRef: string): QaReport {
  const all = listReports();
  let ref: string | undefined;
  if (!pathRef || pathRef === 'latest') ref = all[0];
  else if (pathRef === 'prev') ref = all[1];
  else ref = pathRef;
  if (!ref) {
    throw new Error(`无 QA 报告（${qaReportsDir()} 内 ${pathRef === 'prev' ? '不足 2 份' : '为空'}）。先 qa run。`);
  }
  // ref 可能是：listReports() 的文件名 / 绝对或相对路径 / 裸 run_id
  const direct = existsSync(ref) ? ref : join(qaReportsDir(), ref.endsWith('.json') ? ref : `${ref}.json`);
  if (!existsSync(direct)) {
    throw new Error(`QA 报告不存在: ${ref}（也试过 ${direct}）`);
  }
  return JSON.parse(readFileSync(direct, 'utf-8')) as QaReport;
}

export function stepCaseId(st: StepRecord): string {
  return st.label ?? `${st.index}:${st.type}`;
}

export interface QaDiff {
  base_run_id: string;
  head_run_id: string;
  regressions: { case: string; base: StepStatus; head: StepStatus; head_detail?: string }[];
  fixed: { case: string; base: StepStatus; head: StepStatus }[];
  added: { case: string; head: StepStatus }[];
  removed: { case: string; base: StepStatus }[];
  unchanged_passed: number;
  verdict: 'REGRESSED' | 'IMPROVED' | 'NO_STATUS_CHANGE';
}

/** 按用例 id（label 优先，回退 index:type）对比两份报告。PASSED 之外的都算 not-passed。 */
export function diffReports(base: QaReport, head: QaReport): QaDiff {
  const baseMap = new Map(base.steps.map(s => [stepCaseId(s), s]));
  const headMap = new Map(head.steps.map(s => [stepCaseId(s), s]));

  const regressions: QaDiff['regressions'] = [];
  const fixed: QaDiff['fixed'] = [];
  const added: QaDiff['added'] = [];
  const removed: QaDiff['removed'] = [];
  let unchangedPassed = 0;

  for (const [id, h] of headMap) {
    const b = baseMap.get(id);
    if (!b) {
      added.push({ case: id, head: h.status });
      continue;
    }
    const bOk = b.status === 'PASSED';
    const hOk = h.status === 'PASSED';
    if (bOk && !hOk) regressions.push({ case: id, base: b.status, head: h.status, head_detail: h.detail });
    else if (!bOk && hOk) fixed.push({ case: id, base: b.status, head: h.status });
    else if (bOk && hOk) unchangedPassed++;
  }
  for (const [id, b] of baseMap) {
    if (!headMap.has(id)) removed.push({ case: id, base: b.status });
  }

  const verdict = regressions.length > 0 ? 'REGRESSED' : fixed.length > 0 ? 'IMPROVED' : 'NO_STATUS_CHANGE';
  return {
    base_run_id: base.run_id,
    head_run_id: head.run_id,
    regressions, fixed, added, removed,
    unchanged_passed: unchangedPassed,
    verdict,
  };
}
