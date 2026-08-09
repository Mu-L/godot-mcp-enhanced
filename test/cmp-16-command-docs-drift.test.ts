import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync } from 'node:fs';

// CMP-16-C (2026-08-08): drift 检测 CI 脚本测试。
// 验证脚本实跑通过(当前应 0 drift)+ 脚本结构完整。

describe('CMP-16-C: check-command-docs-drift.mjs 脚本', () => {
  it('CMP-16C-a: 脚本实跑通过(当前 debug + engine 0 drift)', () => {
    // 脚本读 build/ 产物,须在 build 后运行。CI 里已在 build 步骤后。
    const output = execFileSync('node', ['scripts/check-command-docs-drift.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(output).toContain('[command-docs-drift] ✓');
    expect(output).toContain('method 已校验');
  });

  it('CMP-16C-b: 脚本含 method→tool 映射表(debug + engine)', () => {
    const src = readFileSync('scripts/check-command-docs-drift.mjs', 'utf8');
    expect(src.includes('debug_set_breakpoint'), '映射表缺 debug_set_breakpoint').toBe(true);
    expect(src.includes('engine_class_info'), '映射表缺 engine_class_info').toBe(true);
    expect(src.includes('engine_call_method'), '映射表缺 engine_call_method(CMP-9-A)').toBe(true);
  });

  it('CMP-16C-c: 脚本含 ROUTING_PARAMS 豁免(action 路由参数)', () => {
    const src = readFileSync('scripts/check-command-docs-drift.mjs', 'utf8');
    expect(src.includes('ROUTING_PARAMS'), '缺 ROUTING_PARAMS 豁免集合').toBe(true);
    expect(src.includes("'action'"), 'ROUTING_PARAMS 缺 action').toBe(true);
  });

  it('CMP-16C-d: 脚本含 GD docs 提取逻辑(doc_param 解析)', () => {
    const src = readFileSync('scripts/check-command-docs-drift.mjs', 'utf8');
    expect(src.includes('extractGdDocs'), '缺 extractGdDocs 函数').toBe(true);
    expect(src.includes('doc_param'), '缺 doc_param 解析正则').toBe(true);
  });

  it('CMP-16C-e: 脚本含 TS inputSchema 提取逻辑', () => {
    const src = readFileSync('scripts/check-command-docs-drift.mjs', 'utf8');
    expect(src.includes('extractTsSchemas'), '缺 extractTsSchemas 函数').toBe(true);
    expect(src.includes('inputSchema'), '缺 inputSchema 提取').toBe(true);
  });

  it('CMP-16C-f: 脚本一期豁免未覆盖工具组(诚实标注)', () => {
    const src = readFileSync('scripts/check-command-docs-drift.mjs', 'utf8');
    // 应明确标注一期只覆盖 debug + engine,其余豁免
    expect(src.includes('一期'), '缺一期范围标注').toBe(true);
    expect(src.includes('debug') && src.includes('engine'), '应标注覆盖 debug + engine').toBe(true);
  });
});

describe('CMP-16-C: CI 接入', () => {
  it('CMP-16C-g: package.json 含 check:command-docs-drift script', () => {
    const pkg = readFileSync('package.json', 'utf8');
    expect(pkg.includes('check:command-docs-drift'), '缺 npm script').toBe(true);
  });

  it('CMP-16C-h: ci.yml 含 check:command-docs-drift 步骤', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci.includes('check:command-docs-drift'), 'CI 缺 drift 检测步骤').toBe(true);
    expect(ci.includes('CMP-16-C'), 'CI 步骤缺 CMP-16-C 标注').toBe(true);
  });
});
