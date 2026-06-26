import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// 直接驱动纯函数层做集成断言（避免拉起整个 MCP server）
import {
  buildAdoptManifest, planReconcile, hashContent, countDeviations,
} from '../../src/tools/rules-manifest.js';

function makeGodotProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gmc-rules-'));
  writeFileSync(join(dir, 'project.godot'), '[application]\nconfig/name="test"\n');
  return dir;
}

describe('setup_project_rules manifest 集成（纯函数驱动）', () => {
  let project: string;
  beforeEach(() => { project = makeGodotProject(); });
  afterEach(() => { rmSync(project, { recursive: true, force: true }); });

  it('adopt：老项目无 manifest → 固化当前状态为基线', () => {
    const files = [{ filename: 'godot-mcp.md', content: '旧内容', source: 'base' as const }];
    const m = buildAdoptManifest({ serverVersion: '0.18.2', now: '2026-06-22T10:00:00Z', files });
    expect(m.rules['godot-mcp.md'].hash).toBe(hashContent('旧内容'));
    expect(m.rules_installed_at_version).toBe('0.18.2');
  });

  it('adopt 报告偏离：文件≠模板时 countDeviations 计数', () => {
    const m = buildAdoptManifest({
      serverVersion: '0.18.2', now: '2026-06-22T10:00:00Z',
      files: [{ filename: 'godot-mcp.md', content: '历史遗留内容', source: 'base' }],
    });
    const dev = countDeviations(m, { 'godot-mcp.md': hashContent('当前模板') });
    expect(dev).toBe(1);
  });

  it('update：版本过时+用户本地修改并存 → 保留并 warn-keep（不吞修改）', () => {
    const oldTemplateHash = hashContent('0.16 模板');
    const manifest = {
      manifest_version: 1 as const,
      rules_installed_at_version: '0.16.0',
      installed_at: '2026-06-01T00:00:00Z',
      rules: { 'core.md': { source: 'detail' as const, hash: oldTemplateHash } },
    };
    const plan = planReconcile({
      manifest,
      serverVersion: '0.18.0',
      diskFiles: [{ filename: 'core.md', content: '用户在 0.16 时改过' }],
      currentTemplates: { 'core.md': '0.18 新模板' },
      mode: 'update',
      now: '2026-06-22T11:00:00Z',
    });
    expect(plan.actions['core.md'].classification).toBe('stale-and-modified');
    expect(plan.actions['core.md'].action).toBe('warn-keep');
    expect(plan.shouldWriteFiles).toBe(true); // 可能有其他文件要写，但这个文件不动
  });

  it('overwrite：全覆盖含本地修改', () => {
    const manifest = {
      manifest_version: 1 as const,
      rules_installed_at_version: '0.16.0',
      installed_at: '2026-06-01T00:00:00Z',
      rules: { 'core.md': { source: 'detail' as const, hash: hashContent('旧模板') } },
    };
    const plan = planReconcile({
      manifest,
      serverVersion: '0.18.0',
      diskFiles: [{ filename: 'core.md', content: '用户改过' }],
      currentTemplates: { 'core.md': '新模板' },
      mode: 'overwrite',
      now: '2026-06-22T11:00:00Z',
    });
    expect(plan.actions['core.md'].action).toBe('write');
  });

  it('check 模式：纯升级文件分类为 pure-upgrade 且 action=keep（不写）', () => {
    const manifest = {
      manifest_version: 1 as const,
      rules_installed_at_version: '0.16.0',
      installed_at: '2026-06-01T00:00:00Z',
      rules: { 'core.md': { source: 'detail' as const, hash: hashContent('0.16 模板') } },
    };
    const plan = planReconcile({
      manifest,
      serverVersion: '0.18.0',
      diskFiles: [{ filename: 'core.md', content: '0.16 模板' }], // 与 manifest 一致 → 未动过
      currentTemplates: { 'core.md': '0.18 新模板' },
      mode: 'check',
      now: '2026-06-22T11:00:00Z',
    });
    expect(plan.actions['core.md'].classification).toBe('pure-upgrade');
    expect(plan.actions['core.md'].action).toBe('keep');
    expect(plan.shouldWriteFiles).toBe(false);
  });

  it('latest 分类：版本同 + 未动过 → 不动', () => {
    const manifest = {
      manifest_version: 1 as const,
      rules_installed_at_version: '0.18.0',
      installed_at: '2026-06-01T00:00:00Z',
      rules: { 'core.md': { source: 'detail' as const, hash: hashContent('当前模板') } },
    };
    const plan = planReconcile({
      manifest,
      serverVersion: '0.18.0',
      diskFiles: [{ filename: 'core.md', content: '当前模板' }],
      currentTemplates: { 'core.md': '当前模板' },
      mode: 'check',
      now: '2026-06-22T11:00:00Z',
    });
    expect(plan.actions['core.md'].classification).toBe('latest');
    expect(plan.actions['core.md'].action).toBe('keep');
  });

  // 注：project.ts 读 manifest 失败时走 adopt 的行为，由 project-tools.test.js 的
  // 端到端测试覆盖（需要构造 ToolContext 调用 setup_project_rules）。
  // 本文件只测纯函数层契约，project.ts 集成的"manifest 损坏 → adopt"路径见
  // test/project-tools.test.js 的回归断言（setup_project_rules force:true 不破坏文件）。
});
