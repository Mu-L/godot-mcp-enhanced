/**
 * P2-15: path_generator.gd spacing 下限守卫行为测试（headless GDScript 纯函数）。
 *
 * 用 executeGdscript 在 headless `--script` 模式跑 addons/.../path_generator.gd 的
 * 静态 sample()，验证 spacing 极小值守卫（防 CPU 冻结，对应 count>10000 OOM 上限对称）。
 * path_generator.gd 无 class_name，用 preload + 静态方法调用。
 *
 * 复用 gdscript-unit.test.ts 的 skipIf 无 GODOT_PATH 模式（防 CI 假绿）。
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeGdscript } from '../src/gdscript-executor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GODOT_PATH = process.env.GODOT_PATH || '';
const hasGodot = existsSync(GODOT_PATH);
const CHECK_PROJECT = resolve(__dirname, 'fixtures', 'gdscript-check');

if (!hasGodot) {
  process.stderr.write(
    `[gdscript-unit-path-SKIP] 未找到 GODOT_PATH (${GODOT_PATH}) — path_generator spacing 测试将被跳过。\n` +
    `  设置 GODOT_PATH 环境变量以启用（CI godot-matrix job 已配置）。\n`,
  );
}

/** 从 executeGdscript 结果里按 key 找 _mcp_output 收集的值 */
function out(result: { outputs: { key: string; value: string }[] }, key: string): string {
  const entry = result.outputs.find(o => o.key === key);
  if (!entry) throw new Error(`未找到 _mcp_output key="${key}"，已有 keys: ${result.outputs.map(o => o.key).join(',')}`);
  return entry.value;
}

// 两点构造一条 10m 直线折线（total=10），供 sample 采样
const POINTS_SETUP = `
const PG = preload("res://addons/godot_mcp_server/commands/asset/path_generator.gd")
var pts: Array = [Vector3(0, 0, 0), Vector3(10, 0, 0)]
`;

describe.skipIf(!hasGodot)('path_generator spacing 下限守卫（P2-15，防 CPU 冻结）', () => {
  it('spacing=1e-4(极小) + count=0 → sample 返空（守卫命中，防百万迭代冻结）', async () => {
    const result = await executeGdscript({
      godotPath: GODOT_PATH,
      projectPath: CHECK_PROJECT,
      timeout: 30,
      code: [
        POINTS_SETUP,
        '_mcp_output("tiny_spacing", str(PG.sample(pts, "discrete", 1e-4, 0, "path", false).size()))',
        '_mcp_done()',
      ].join('\n'),
    });
    expect(result.run_success).toBe(true);
    expect(out(result, 'tiny_spacing')).toBe('0'); // 守卫返空 → size 0
  });

  it('spacing=1e-3(=MIN_SPACING 边界) + count=0 → sample 返非空（守卫不误拒合法间距）', async () => {
    const result = await executeGdscript({
      godotPath: GODOT_PATH,
      projectPath: CHECK_PROJECT,
      timeout: 30,
      code: [
        POINTS_SETUP,
        '_mcp_output("boundary_spacing", str(PG.sample(pts, "discrete", 1e-3, 0, "path", false).size()))',
        '_mcp_done()',
      ].join('\n'),
    });
    expect(result.run_success).toBe(true);
    // total=10m, spacing=1e-3 → 10001 采样点（>0，守卫不拦；count>10000 才拦但这是 spacing 模式）
    expect(parseInt(out(result, 'boundary_spacing'), 10)).toBeGreaterThan(0);
  });

  it('spacing=1e-4(极小) + count=5 → sample 返非空（count 优先，守卫不误拒合法 count 请求）', async () => {
    const result = await executeGdscript({
      godotPath: GODOT_PATH,
      projectPath: CHECK_PROJECT,
      timeout: 30,
      code: [
        POINTS_SETUP,
        '_mcp_output("count_priority", str(PG.sample(pts, "discrete", 1e-4, 5, "path", false).size()))',
        '_mcp_done()',
      ].join('\n'),
    });
    expect(result.run_success).toBe(true);
    // count=5 优先于 spacing（BUG2），守卫条件 count<1 不满足 → 不拦 → 返 5 采样点
    expect(out(result, 'count_priority')).toBe('5');
  });

  it('continuous 模式 spacing=1e-4(极小) + count=0 → sample 返空（continuous 同款守卫覆盖）', async () => {
    const result = await executeGdscript({
      godotPath: GODOT_PATH,
      projectPath: CHECK_PROJECT,
      timeout: 30,
      code: [
        POINTS_SETUP,
        '_mcp_output("continuous_tiny", str(PG.sample(pts, "continuous", 1e-4, 0, "path", false).size()))',
        '_mcp_done()',
      ].join('\n'),
    });
    expect(result.run_success).toBe(true);
    expect(out(result, 'continuous_tiny')).toBe('0'); // 守卫在 sample 入口，continuous 也覆盖
  });

  it('count=20000(超限) + spacing=1e-4(极小) → 返空（双守卫同时命中，回归保护）', async () => {
    // 审查 Nit-2：count>10000 守卫（:57）与 spacing 守卫（:62）同时命中场景。
    // 两守卫在此场景下是 OR 关系（任一命中即返空），本用例锁死"双守卫共存不冲突、
    // 双命中时返空"，防日后误删任一守卫致回归（count 守卫删 → spacing 守卫仍拦；
    // spacing 守卫删 → count 守卫仍拦；两守卫都删 → 20000 点采样冻结）。
    const result = await executeGdscript({
      godotPath: GODOT_PATH,
      projectPath: CHECK_PROJECT,
      timeout: 30,
      code: [
        POINTS_SETUP,
        '_mcp_output("both_guards", str(PG.sample(pts, "discrete", 1e-4, 20000, "path", false).size()))',
        '_mcp_done()',
      ].join('\n'),
    });
    expect(result.run_success).toBe(true);
    expect(out(result, 'both_guards')).toBe('0'); // count>10000 守卫先命中返空
  });
});
