/**
 * 报告③阶段1：GDScript 纯函数行为测试。
 *
 * 用 executeGdscript 在 headless `--script` 模式跑 addons/godot_mcp_server/commands/command_helpers.gd
 * 的纯函数（values_equal / parse_vec3 / has_path_traversal），补强 GDScript 侧零行为覆盖
 * （capability-matrix L2=0/35 自承认）。command_helpers.gd 有 class_name CommandHelpers 且无 @tool，
 * gdscript-check fixture 启用了插件，class cache 含 CommandHelpers，可直接 CommandHelpers.xxx()。
 *
 * 复用 e2e-p1-p5.test.ts 的 skipIf 无 GODOT_PATH 模式（防 CI 假绿）。
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
    `[gdscript-unit-SKIP] 未找到 GODOT_PATH (${GODOT_PATH}) — GDScript 纯函数测试将被跳过。\n` +
    `  设置 GODOT_PATH 环境变量以启用（CI godot-matrix job 已配置）。\n`,
  );
}

/** 从 executeGdscript 结果里按 key 找 _mcp_output 收集的值 */
function out(result: { outputs: { key: string; value: string }[] }, key: string): string {
  const entry = result.outputs.find(o => o.key === key);
  if (!entry) throw new Error(`未找到 _mcp_output key="${key}"，已有 keys: ${result.outputs.map(o => o.key).join(',')}`);
  return entry.value;
}

describe.skipIf(!hasGodot)('CommandHelpers 纯函数行为测试（报告③阶段1）', () => {
  it('values_equal: 同类型直接 ==', async () => {
    const result = await executeGdscript({
      godotPath: GODOT_PATH,
      projectPath: CHECK_PROJECT,
      timeout: 30,
      code: [
        '_mcp_output("int_eq", str(CommandHelpers.values_equal(1, 1)))',
        '_mcp_output("str_eq", str(CommandHelpers.values_equal("a", "a")))',
        '_mcp_output("vec3_same", str(CommandHelpers.values_equal(Vector3(1, 2, 3), Vector3(1, 2, 3))))',
        '_mcp_output("int_ne", str(CommandHelpers.values_equal(1, 2)))',
        '_mcp_done()',
      ].join('\n'),
    });
    expect(result.run_success).toBe(true);
    expect(out(result, 'int_eq')).toBe('true');
    expect(out(result, 'str_eq')).toBe('true');
    expect(out(result, 'vec3_same')).toBe('true');
    expect(out(result, 'int_ne')).toBe('false');
  });

  it('values_equal: Array ↔ Vector3 分量比（C9 修复点，JSON [1,2,3] 对 Vector3）', async () => {
    const result = await executeGdscript({
      godotPath: GODOT_PATH,
      projectPath: CHECK_PROJECT,
      timeout: 30,
      code: [
        '_mcp_output("arr_vec3", str(CommandHelpers.values_equal(Vector3(1, 2, 3), [1, 2, 3])))',
        '_mcp_output("arr_vec3_ne", str(CommandHelpers.values_equal(Vector3(1, 2, 3), [1, 2, 4])))',
        '_mcp_output("arr_short", str(CommandHelpers.values_equal(Vector3(1, 2, 3), [1, 2])))',
        '_mcp_output("arr_vec2", str(CommandHelpers.values_equal(Vector2(1, 2), [1, 2])))',
        '_mcp_done()',
      ].join('\n'),
    });
    expect(result.run_success).toBe(true);
    expect(out(result, 'arr_vec3')).toBe('true');
    expect(out(result, 'arr_vec3_ne')).toBe('false');
    expect(out(result, 'arr_short')).toBe('false');   // 长度不足，分量不比
    expect(out(result, 'arr_vec2')).toBe('true');
  });

  it('values_equal: int↔float 数字宽松；bool↔int fallback→false（语义正确）', async () => {
    const result = await executeGdscript({
      godotPath: GODOT_PATH,
      projectPath: CHECK_PROJECT,
      timeout: 30,
      code: [
        '_mcp_output("int_float", str(CommandHelpers.values_equal(1, 1.0)))',
        '_mcp_output("float_int", str(CommandHelpers.values_equal(1.0, 1)))',
        '_mcp_output("bool_int", str(CommandHelpers.values_equal(true, 1)))',
        '_mcp_output("bool_int_ne", str(CommandHelpers.values_equal(true, 0)))',
        '_mcp_done()',
      ].join('\n'),
    });
    expect(result.run_success).toBe(true);
    expect(out(result, 'int_float')).toBe('true');
    expect(out(result, 'float_int')).toBe('true');
    // bool↔int 走 str fallback：str(true)="true" ≠ str(1)="1" → false（文档明确语义正确）
    expect(out(result, 'bool_int')).toBe('false');
    expect(out(result, 'bool_int_ne')).toBe('false');
  });

  it('parse_vec3: Array / PackedFloat64Array / 短数组 / 非 array', async () => {
    const result = await executeGdscript({
      godotPath: GODOT_PATH,
      projectPath: CHECK_PROJECT,
      timeout: 30,
      code: [
        '_mcp_output("arr", str(CommandHelpers.parse_vec3([1.0, 2.0, 3.0])))',
        '_mcp_output("packed", str(CommandHelpers.parse_vec3(PackedFloat64Array([4, 5, 6]))))',
        '_mcp_output("short", str(CommandHelpers.parse_vec3([1, 2])))',
        '_mcp_output("non_arr", str(CommandHelpers.parse_vec3("not array")))',
        '_mcp_done()',
      ].join('\n'),
    });
    expect(result.run_success).toBe(true);
    expect(out(result, 'arr')).toBe('(1.0, 2.0, 3.0)');
    expect(out(result, 'packed')).toBe('(4.0, 5.0, 6.0)');
    expect(out(result, 'short')).toBe('(0.0, 0.0, 0.0)');     // 短数组返回 ZERO
    expect(out(result, 'non_arr')).toBe('(0.0, 0.0, 0.0)');   // 非 array 返回 ZERO
  });

  it('has_path_traversal: ../ 各形态 + 正常路径', async () => {
    const result = await executeGdscript({
      godotPath: GODOT_PATH,
      projectPath: CHECK_PROJECT,
      timeout: 30,
      code: [
        '_mcp_output("mid", str(CommandHelpers.has_path_traversal("a/../b")))',
        '_mcp_output("prefix", str(CommandHelpers.has_path_traversal("../etc")))',
        '_mcp_output("suffix", str(CommandHelpers.has_path_traversal("a/..")))',
        '_mcp_output("only", str(CommandHelpers.has_path_traversal("..")))',
        '_mcp_output("clean", str(CommandHelpers.has_path_traversal("res://scripts/a.gd")))',
        '_mcp_done()',
      ].join('\n'),
    });
    expect(result.run_success).toBe(true);
    expect(out(result, 'mid')).toBe('true');
    expect(out(result, 'prefix')).toBe('true');
    expect(out(result, 'suffix')).toBe('true');
    expect(out(result, 'only')).toBe('true');
    expect(out(result, 'clean')).toBe('false');
  });
});
