import { describe, it, expect } from 'vitest';
import { executeGdscript } from '../src/gdscript-executor.js';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GODOT_PATH = process.env.GODOT_PATH ?? '';
const CHECK_PROJECT = resolve(__dirname, 'fixtures', 'gdscript-check');
const hasGodot = GODOT_PATH !== '' && existsSync(GODOT_PATH);

/**
 * P0-1 (2026-09-11): callv 参数预检 — 行为探针测试(真跑 Godot)。
 * 契约测试(字面量)抓不到运行时函数名错误——本批开发中 type_name()(不存在的全局函数)
 * 写入预检,check:gdscript 的 --import 不编译未被场景引用的 src/scripts/*.gd,契约测试
 * 也全绿,直到 error-capture 行为测试超时才暴露。本文件对齐该模式:executeGdscript 真跑,
 * 直接调用 static _call_args_precheck_error(不依赖 bridge 实例),用 RESULT 行断言各分支。
 * 探针 node 用 SceneTree.root(Window,Node 子类):其 get_method_list 含真实签名。
 */

async function runPrecheckProbe(lines: string[]): Promise<{ realError: boolean; values: Record<string, string> }> {
  const code = [
    'extends SceneTree',
    '',
    'func _init():',
    '\tvar B = load("res://src/scripts/mcp_bridge.gd")',
    '\tvar root_node = self.root',
    ...lines.map(l => '\t' + l),
    '\tquit()',
  ].join('\n');
  const result = await executeGdscript({ godotPath: GODOT_PATH, projectPath: CHECK_PROJECT, timeout: 30, code });
  const raw = result.raw_output;
  const realError = /\b(Parse Error|SCRIPT ERROR|Invalid |ENGINE ERROR)\b/.test(raw);
  const values: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^RESULT\s+(\S+?)=(.*)$/);
    if (m) values[m[1]!] = m[2]!;
  }
  return { realError, values };
}

describe.skipIf(!hasGodot)('P0-1: _call_args_precheck_error 行为探针(真跑 Godot)', () => {
  it('PRE-a: 脚本可加载且预检可调用(防 type_name 级函数名事故回归)', async () => {
    const { realError, values } = await runPrecheckProbe([
      'print("RESULT callable=" + str(B.get("_call_args_precheck_error") != null))',
    ]);
    expect(realError, '不应有脚本错误(函数名/语法事故)').toBe(false);
    expect(values.callable).toBe('true');
  });

  it('PRE-b: 无参方法 + 空 args 放行(空串)', async () => {
    const { realError, values } = await runPrecheckProbe([
      'var msg = B._call_args_precheck_error(root_node, "get_tree", [])',
      'print("RESULT r1=" + str(msg.length()))',
    ]);
    expect(realError).toBe(false);
    // get_tree 无参:返回 "" → len 0
    expect(values.r1).toBe('0');
  });

  it('PRE-c: 必参不足被拒(get_node_or_null 需 1 参,传 0 个)', async () => {
    const { realError, values } = await runPrecheckProbe([
      'var msg = B._call_args_precheck_error(root_node, "get_node_or_null", [])',
      'print("RESULT count_err=" + str(msg.contains("needs at least 1 argument")))',
    ]);
    expect(realError).toBe(false);
    expect(values.count_err).toBe('true');
  });

  it('PRE-d: 类型可达放行(String → NodePath,引擎 strict 可转)', async () => {
    const { realError, values } = await runPrecheckProbe([
      'var msg = B._call_args_precheck_error(root_node, "get_node_or_null", ["Root"])',
      'print("RESULT ok_len=" + str(msg.length()))',
    ]);
    expect(realError).toBe(false);
    expect(values.ok_len).toBe('0');
  });

  it('PRE-e: 类型不可达被拒(String → int,如 set_process_priority 传 "abc")', async () => {
    const { realError, values } = await runPrecheckProbe([
      'var msg = B._call_args_precheck_error(root_node, "set_process_priority", ["abc"])',
      'print("RESULT type_err=" + str(msg.contains("expects int, got String")))',
      'print("RESULT refusal=" + str(msg.contains("refusing rather than letting callv fail silently")))',
    ]);
    expect(realError).toBe(false);
    expect(values.type_err).toBe('true');
    expect(values.refusal).toBe('true');
  });

  it('PRE-f: 宽化可达放行(BOOL → int,set_process_priority 传 true)', async () => {
    const { realError, values } = await runPrecheckProbe([
      'var msg = B._call_args_precheck_error(root_node, "set_process_priority", [true])',
      'print("RESULT widen_len=" + str(msg.length()))',
    ]);
    expect(realError).toBe(false);
    expect(values.widen_len).toBe('0');
  });

  it('PRE-g: 未知方法(动态)签名取不到 → 放行空串(不拦,callv 自行处理)', async () => {
    const { realError, values } = await runPrecheckProbe([
      'var msg = B._call_args_precheck_error(root_node, "__no_such_method__", ["x", 1])',
      'print("RESULT dyn_len=" + str(msg.length()))',
    ]);
    expect(realError).toBe(false);
    expect(values.dyn_len).toBe('0');
  });

  it('PRE-i: default_args 真值路径(get_child 有 1 个默认参,传部分参数放行)', async () => {
    const { realError, values } = await runPrecheckProbe([
      // get_child(idx: int, include_internal: bool = false):declared=2, defaults=1, required=1
      'var m1 = B._call_args_precheck_error(root_node, "get_child", [0])',
      'print("RESULT partial_len=" + str(m1.length()))',
      'var m2 = B._call_args_precheck_error(root_node, "get_child", [])',
      'print("RESULT zero_err=" + str(m2.contains("needs at least 1 argument")))',
    ]);
    expect(realError).toBe(false);
    // 传 1 参(≥required=1)放行;传 0 参(<required)拒绝 —— default_args 计算实证
    expect(values.partial_len).toBe('0');
    expect(values.zero_err).toBe('true');
  });

  it('PRE-h: 参数超出被拒(非 vararg,2 参传给 1 参方法)', async () => {
    const { realError, values } = await runPrecheckProbe([
      'var msg = B._call_args_precheck_error(root_node, "get_node_or_null", ["A", "B"])',
      'print("RESULT max_err=" + str(msg.contains("accepts at most 1 argument")))',
    ]);
    expect(realError).toBe(false);
    expect(values.max_err).toBe('true');
  });
});
