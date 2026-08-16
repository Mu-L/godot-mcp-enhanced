// test/qa-report.test.ts — QA 报告落盘/读取/diff（env 重定向到 tmp 目录隔离）
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  writeReport, readReport, listReports, diffReports, sanitizeSuiteName,
  type QaReport, type StepRecord,
} from '../src/tools/qa/report.js';

let dir: string;
const prevEnv = process.env.GODOT_MCP_QA_REPORTS_DIR;

function step(i: number, label: string | undefined, type: string, status: StepRecord['status']): StepRecord {
  return { index: i, label, type, status, elapsed_ms: 5 };
}

function report(runId: string, name: string, steps: StepRecord[], setupError?: string): QaReport {
  const passed = steps.filter(s => s.status === 'PASSED').length;
  const failed = steps.filter(s => s.status === 'FAILED').length;
  const errors = steps.filter(s => s.status === 'ERROR').length;
  const skipped = steps.filter(s => s.status === 'SKIPPED').length;
  return {
    version: 1, run_id: runId,
    suite: { name, project_path: 'D:/p', started_at: '2026-08-15T00:00:00Z', spec_source: 'inline' },
    options: {}, setup_error: setupError,
    summary: { total: steps.length, passed, failed, errors, skipped, status: failed + errors + skipped > 0 || setupError ? 'FAILED' : 'PASSED', duration_ms: 10 },
    steps,
  };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'qa-reports-test-'));
  process.env.GODOT_MCP_QA_REPORTS_DIR = dir;
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  if (prevEnv === undefined) delete process.env.GODOT_MCP_QA_REPORTS_DIR;
  else process.env.GODOT_MCP_QA_REPORTS_DIR = prevEnv;
});

describe('writeReport / readReport', () => {
  it('落盘 .json + .md，latest/prev 按文件名倒序解析', () => {
    const p1 = writeReport(report('20260815-100000-alpha', 'alpha', [step(0, 's0', 'input', 'PASSED')]));
    expect(existsSync(p1.json_path)).toBe(true);
    expect(p1.md_path.endsWith('.md')).toBe(true);
    writeReport(report('20260815-100001-beta', 'beta', [step(0, 's0', 'input', 'FAILED')]));

    expect(readReport('latest').run_id).toBe('20260815-100001-beta');
    expect(readReport('prev').run_id).toBe('20260815-100000-alpha');
    expect(readReport('20260815-100000-alpha').suite.name).toBe('alpha'); // 裸 run_id
    expect(readReport('20260815-100000-alpha.json').suite.name).toBe('alpha'); // 文件名
    expect(listReports()).toHaveLength(2);
  });

  it('目录空时 latest/prev 抛可读错误', () => {
    const empty = mkdtempSync(join(tmpdir(), 'qa-reports-empty-'));
    process.env.GODOT_MCP_QA_REPORTS_DIR = empty;
    expect(() => readReport('latest')).toThrow(/先 qa run/);
    expect(() => readReport('prev')).toThrow(/不足 2 份/);
    process.env.GODOT_MCP_QA_REPORTS_DIR = dir;
    rmSync(empty, { recursive: true, force: true });
  });

  it('安全（审查 Important-1）：白名单外绝对路径拒绝读取', () => {
    // 任意路径读是 v0.30 修复的口子——qa 报告只允许读 qa-reports 目录内
    expect(() => readReport('C:/Windows/win.ini')).toThrow(/必须位于/);
    expect(() => readReport('C:\\Windows\\win.ini')).toThrow(/必须位于/);
    expect(() => readReport('/etc/passwd')).toThrow(/必须位于/);
    // 目录内合法路径仍可（构造 dir 内绝对路径）
    const r = readReport(join(dir, '20260815-100000-alpha.json'));
    expect(r.run_id).toBe('20260815-100000-alpha');
  });

  it('md 渲染含状态表与 setup error', () => {
    const r = report('20260815-100002-gamma', 'gamma', [step(0, 'a', 'assert', 'FAILED')], 'run_project 失败: x');
    const { md_path } = writeReport(r);
    const md = readFileSync(md_path, 'utf-8');
    expect(md).toContain('FAILED');
    expect(md).toContain('setup error');
    expect(md).toContain('| 0 | a | assert | FAILED |');
  });
});

describe('diffReports', () => {
  const base = report('b', 'b', [
    step(0, 'case-a', 'assert', 'PASSED'),
    step(1, 'case-b', 'assert', 'FAILED'),
    step(2, 'case-c', 'input', 'PASSED'),
  ]);
  const head = report('h', 'h', [
    step(0, 'case-a', 'assert', 'FAILED'),  // 回归
    step(1, 'case-b', 'assert', 'PASSED'),  // 修复
    step(2, 'case-d', 'input', 'PASSED'),   // case-c 移除 + case-d 新增
  ]);

  it('回归/修复/新增/移除/判定', () => {
    const d = diffReports(base, head);
    expect(d.regressions.map(r => r.case)).toEqual(['case-a']);
    expect(d.fixed.map(f => f.case)).toEqual(['case-b']);
    expect(d.added.map(a => a.case)).toEqual(['case-d']);
    expect(d.removed.map(r => r.case)).toEqual(['case-c']);
    expect(d.verdict).toBe('REGRESSED');
    expect(d.regressions[0]).toMatchObject({ base: 'PASSED', head: 'FAILED' });
  });

  it('全修复 → IMPROVED；无变化 → NO_STATUS_CHANGE', () => {
    const b2 = report('b2', 'b2', [step(0, 'x', 'assert', 'FAILED')]);
    const h2 = report('h2', 'h2', [step(0, 'x', 'assert', 'PASSED')]);
    expect(diffReports(b2, h2).verdict).toBe('IMPROVED');
    const b3 = report('b3', 'b3', [step(0, 'x', 'assert', 'PASSED')]);
    const h3 = report('h3', 'h3', [step(0, 'x', 'assert', 'PASSED')]);
    expect(diffReports(b3, h3).verdict).toBe('NO_STATUS_CHANGE');
  });

  it('ERROR 视为 not-passed（回归判定覆盖 error）', () => {
    const b4 = report('b4', 'b4', [step(0, 'x', 'input', 'PASSED')]);
    const h4 = report('h4', 'h4', [step(0, 'x', 'input', 'ERROR')]);
    expect(diffReports(b4, h4).verdict).toBe('REGRESSED');
  });

  it('无 label 时按 index:type 对齐', () => {
    const b5 = report('b5', 'b5', [step(0, undefined, 'input', 'PASSED')]);
    const h5 = report('h5', 'h5', [step(0, undefined, 'input', 'FAILED')]);
    expect(diffReports(b5, h5).regressions[0]!.case).toBe('0:input');
  });
});

describe('sanitizeSuiteName', () => {
  it('非法字符替换为 _ 并折叠连续、空回退 suite', () => {
    expect(sanitizeSuiteName('存档/读档: 冒烟!')).toBe('_'); // 全非法 → 折叠为单个 _
    expect(sanitizeSuiteName('save-load_smoke v1')).toBe('save-load_smoke_v1');
    expect(sanitizeSuiteName('!!!')).toBe('_');
    expect(sanitizeSuiteName('')).toBe('suite');
  });
});
