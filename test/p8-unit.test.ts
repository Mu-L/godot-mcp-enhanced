/**
 * P8 批 (2026-09-11): mcp_commands 热加载状态机(LuoxuanLove 移植) + SSOT unknown-param 双防线(regiellis 移植)。
 *
 * 断言分层:
 * - GD 源码契约: 状态机核心(slot/quiesce/回滚/debounce/重名冲突/custom.list/GDScript.new 独立加载)
 * - TS 契约: SLIM_CONFIG ui 条目移除(P8-2 语义反转的必要补全)+ 运行时 ui schema 全键
 * - 审计器: scripts/check-ssot-params.mjs 真跑 exit 0 + 白名单结构
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const GD = readFileSync(resolve(REPO, 'src/scripts/mcp_bridge.gd'), 'utf-8');
const LOADER = readFileSync(resolve(REPO, 'src/module-loader.ts'), 'utf-8');

describe('P8-1: 热加载状态机 — GD 源码契约', () => {
  it('GD-a: slot 模型 + 状态机函数齐备(reconcile/create/reload/index/unload/execute/list)', () => {
    for (const fn of [
      'func _refresh_custom_slots(', 'func _create_custom_slot(', 'func _reload_custom_slot(',
      'func _rebuild_custom_index(', 'func _unload_custom_slot(', 'func _execute_custom_command(',
      'func _custom_list(',
    ]) {
      expect(GD.includes(fn), `缺少 ${fn}`).toBe(true);
    }
    expect(GD.includes('var _custom_slots: Dictionary')).toBe(true);
    expect(GD.includes('var _custom_index: Dictionary')).toBe(true);
  });

  it('GD-b: mtime 对比 + 300ms debounce tick(LuoxuanLove _RELOAD_DEBOUNCE_MSEC 同款)', () => {
    expect(GD.includes('CUSTOM_RELOAD_DEBOUNCE_MS := 300')).toBe(true);
    expect(GD.includes('FileAccess.get_modified_time(path)')).toBe(true);
    expect(GD.includes('int(slot.get("last_mtime", 0)) != mtime')).toBe(true);
    expect(GD.includes('_refresh_custom_slots("tick")')).toBe(true);
  });

  it('GD-c: quiesce——active_calls 记账 + 调用中不换实例(重载/卸载等归零)', () => {
    expect(GD.includes('slot["active_calls"] = int(slot.get("active_calls", 0)) + 1')).toBe(true);
    expect(GD.includes('slot["active_calls"] = maxi(0, int(slot.get("active_calls", 1)) - 1)')).toBe(true);
    expect(GD.includes('"state"] = "waiting_quiesce"')).toBe(true);
    expect(GD.includes('if int(slot["active_calls"]) == 0:')).toBe(true);
    // 删除处理:调用中 removed_pending,归零卸载
    expect(GD.includes('slot["removed_pending"] = true')).toBe(true);
  });

  it('GD-d: 加载失败回滚旧实例(reload_failed 保旧 Callable)+ 独立加载不污染旧脚本', () => {
    // FileAccess + GDScript.new() 独立对象加载(2026-09-11 HOT-c 二轮实测:同路径
    // ResourceLoader.load 即使 CACHE_MODE_IGNORE 也就地替换共享资源,旧 Callable 失效)
    expect(GD.includes('var script := GDScript.new()')).toBe(true);
    expect(GD.includes('script.source_code = FileAccess.get_file_as_string(path)')).toBe(true);
    expect(GD.includes('script.reload() == OK')).toBe(true);
    expect(GD.includes('"state"] = "reload_failed"')).toBe(true);
    expect(GD.includes('kept previous version')).toBe(true);
    // 宽容四分支保留(P3 契约)
    for (const msg of ['failed to load as instantiable script', 'must instantiate to a Node',
      'no get_commands() method', 'get_commands() must return a Dictionary']) {
      expect(GD.includes(msg)).toBe(true);
    }
  });

  it('GD-e: 重名冲突后者 reload_failed 清空命令集 + custom.list 诊断 + env 开关', () => {
    expect(GD.includes('Duplicate custom command name')).toBe(true);
    expect(GD.includes('"custom.list":')).toBe(true);
    expect(GD.includes('CUSTOM_HOT_RELOAD_ENV')).toBe(true);
    // P3 契约保留:custom. 前缀 + 内建优先
    expect(GD.includes('method.begins_with("custom.") and _custom_index.has(method)')).toBe(true);
  });
});

describe('P8-2/P8-3: SSOT 双防线 — TS 契约 + 审计器', () => {
  it('TS-a: SLIM_CONFIG ui 条目移除(P8-2 语义反转——schema 删键=运行时拒参数,键不可砍)', () => {
    expect(LOADER.includes('export const SLIM_CONFIG'), '机制保留').toBe(true);
    expect(LOADER.includes('ui: {'), 'ui 条目应已移除').toBe(false);
    expect(LOADER.includes('P8-3 (2026-09-11): ui 条目移除')).toBe(true);
  });

  it('TS-b: 运行时 ui schema 恢复全键(theme_action/tree/ops 等 39 键)', async () => {
    const { registerAllModules } = await import('../src/module-loader.js');
    const { getToolDefinition } = await import('../src/core/tool-registry.js');
    registerAllModules();
    const d = getToolDefinition('ui');
    expect(d).toBeTruthy();
    const props = Object.keys(d!.inputSchema.properties as Record<string, unknown>);
    for (const k of ['theme_action', 'theme_path', 'params', 'tree', 'ops', 'geometry', 'geometry_path', 'save_path', 'prop_name', 'value']) {
      expect(props.includes(k), `ui schema 应含 ${k}`).toBe(true);
    }
    expect(props.length).toBeGreaterThanOrEqual(39);
  });

  it('AUD-a: 审计器真跑 exit 0(45 工具零漂移)', () => {
    expect(existsSync(resolve(REPO, 'scripts/check-ssot-params.mjs'))).toBe(true);
    const out = execFileSync('node', ['scripts/check-ssot-params.mjs'], { cwd: REPO, encoding: 'utf-8' });
    expect(out).toContain('通过');
    expect(out).toMatch(/4[56] 工具/);  // P9 dap 落地后 46;断言语义=审计器报工具总数
  });

  it('AUD-b: 白名单结构(runtime_assert.evidence_path 有意不暴露 + ui.name 别名)', () => {
    const allow = JSON.parse(readFileSync(resolve(REPO, 'scripts/ssot-allowlist.json'), 'utf-8')) as Record<string, string[]>;
    expect(allow.runtime_assert).toContain('evidence_path');
    expect(allow.ui).toContain('name');
  });

  it('AUD-c: 审计器有 teeth——注入假漂移应 exit 1(临时白名单篡改)', () => {
    // 用环境可控方式验证非假绿:临时把 allowlist 里 ui 的 name 移除后审计器应红
    // (name 是真实漂移键——handler args.name || prop_name 兼容别名)。跑完恢复。
    const allowPath = resolve(REPO, 'scripts/ssot-allowlist.json');
    const orig = readFileSync(allowPath, 'utf-8');
    try {
      writeFileSync(allowPath, JSON.stringify({ runtime_assert: ['evidence_path'] }, null, 2) + '\n');
      let failed = false;
      try {
        execFileSync('node', ['scripts/check-ssot-params.mjs'], { cwd: REPO, encoding: 'utf-8' });
      } catch { failed = true; }
      expect(failed, '移除白名单项后审计器应 exit 1(非假绿)').toBe(true);
    } finally {
      writeFileSync(allowPath, orig);
    }
  });
});
