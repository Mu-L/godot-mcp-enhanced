/**
 * CMP-2 NIT-5 deferred 补完:_ErrorCapture.poll() 真实行为测试。
 *
 * 之前 test/regression/bridge-error-capture-contract.test.ts 只有字面量契约
 * (断言源码含 poll/next_seq 字符串),无法捕获运行时算法 bug。本文件用 executeGdscript
 * 在 headless 模式跑 mcp_bridge.gd 的 _ErrorCapture 内部类实例,验证 poll/clear/
 * ring buffer/kind 映射/截断的真实行为。
 *
 * 执行模式说明(踩坑记录):
 * - executeGdscript 默认 wrapSnippetAsNode(extends Node + autoload)模式下,
 *   load("res://src/scripts/mcp_bridge.gd").new()._ErrorCapture.new() 的 poll()
 *   方法访问 _entries 实例字段行为异常(返回空,根因疑似 GDScript 内部类实例方法
 *   在 Node autoload wrapper 上下文下的字段绑定怪异行为,与 _ErrorCapture 逻辑无关)。
 * - 改用 full class extends SceneTree 模式:探针验证此模式下 poll() 行为完全正确
 *   (poll0_size=3, poll2_size=1)。但 SceneTree 脚本的 _init 里 get_tree() 返回 null,
 *   无法调注入的 _mcp_done()→get_tree().quit(),导致进程靠原生 quit() 退出触发 RID
 *   leak cleanup 警告,run_success=false。
 * - 解决:测试 code 用 print("RESULT key=value") 输出结构化结果,从 raw_output 解析。
 *   run_success=false 是预期的(RID leak,非 SCRIPT ERROR),断言基于 RESULT 行解析值 +
 *   检查 raw_output 无 SCRIPT ERROR / Parse Error。
 *
 * 复用 gdscript-unit.test.ts 的 skipIf 无 GODOT_PATH 模式(防 CI 假绿, CI godot-matrix
 * job 会跑)。
 *
 * ErrorType 枚举值(Godot 4.6 Logger 基类): ERROR=0 / WARNING=1 / SCRIPT=2 / SHADER=3
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
    `[bridge-error-capture-SKIP] 未找到 GODOT_PATH (${GODOT_PATH}) — _ErrorCapture 行为测试将被跳过。\n` +
    `  设置 GODOT_PATH 环境变量以启用(CI godot-matrix job 已配置)。\n`,
  );
}

/**
 * 运行一段 _ErrorCapture 测试脚本(extends SceneTree 模式),从 raw_output 解析 RESULT 行。
 * 脚本须用 print("RESULT key=value") 输出每个待断言值,并以 quit() 结尾。
 * run_success=false 是预期的(RID leak cleanup),真正失败信号是 SCRIPT ERROR / Parse Error。
 */
async function runCaptureTest(bodyLines: string[]): Promise<{ realError: boolean; values: Record<string, string> }> {
  const code = [
    'extends SceneTree',
    '',
    'func _init():',
    '\tvar cap = load("res://src/scripts/mcp_bridge.gd").new()._ErrorCapture.new()',
    ...bodyLines.map(l => '\t' + l),
    '\tquit()',
  ].join('\n');
  const result = await executeGdscript({
    godotPath: GODOT_PATH,
    projectPath: CHECK_PROJECT,
    timeout: 30,
    code,
  });
  const raw = result.raw_output;
  // 检测真正的脚本错误(非 RID leak cleanup 警告)
  // ENGINE ERROR: Godot 部分运行时硬错误(如 RID 相关)用此关键字输出。
  const realError = /\b(Parse Error|SCRIPT ERROR|Invalid |ENGINE ERROR)\b/.test(raw);
  // 解析 RESULT key=value 行
  const values: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^RESULT\s+(\S+?)=(.*)$/);
    if (m) {
      values[m[1]!] = m[2]!;
    }
  }
  return { realError, values };
}

describe.skipIf(!hasGodot)('_ErrorCapture 行为测试(CMP-2 NIT-5 补完)', () => {
  it('poll(0, false): 空 buffer 返回 0 条 + next_seq=0', async () => {
    const { realError, values } = await runCaptureTest([
      'var r = cap.poll(0, false)',
      'print("RESULT count=" + str(r["errors"].size()))',
      'print("RESULT next_seq=" + str(r["next_seq"]))',
    ]);
    expect(realError, '不应有 SCRIPT ERROR').toBe(false);
    expect(values.count).toBe('0');
    expect(values.next_seq).toBe('0');
  });

  it('poll 增量过滤: 注入 3 条后 poll(0) 返回 3 条 + next_seq=3, poll(2) 返回 1 条', async () => {
    const { realError, values } = await runCaptureTest([
      'cap._log_error("f1", "a.gd", 1, "c1", "r1", false, 2, [])',
      'cap._log_error("f2", "b.gd", 2, "c2", "r2", false, 0, [])',
      'cap._log_error("f3", "c.gd", 3, "c3", "r3", false, 1, [])',
      'var r0 = cap.poll(0, false)',
      'print("RESULT poll0_count=" + str(r0["errors"].size()))',
      'print("RESULT next_seq=" + str(r0["next_seq"]))',
      'var r2 = cap.poll(2, false)',
      'print("RESULT poll2_count=" + str(r2["errors"].size()))',
      'print("RESULT poll2_first_seq=" + str(r2["errors"][0]["seq"]))',
    ]);
    expect(realError, '不应有 SCRIPT ERROR').toBe(false);
    expect(values.poll0_count).toBe('3');
    expect(values.next_seq).toBe('3');
    expect(values.poll2_count).toBe('1');
    expect(values.poll2_first_seq).toBe('3');
  });

  it('poll(0, true) 读即焚: 返回全部后清空, 再 poll 返回 0', async () => {
    const { realError, values } = await runCaptureTest([
      'cap._log_error("f1", "a.gd", 1, "c1", "r1", false, 2, [])',
      'cap._log_error("f2", "b.gd", 2, "c2", "r2", false, 0, [])',
      'var rc = cap.poll(0, true)',
      'print("RESULT clear_count=" + str(rc["errors"].size()))',
      'var ra = cap.poll(0, false)',
      'print("RESULT after_clear_count=" + str(ra["errors"].size()))',
    ]);
    expect(realError, '不应有 SCRIPT ERROR').toBe(false);
    expect(values.clear_count).toBe('2');
    expect(values.after_clear_count).toBe('0');
  });

  it('ring buffer 上限 MAX_ENTRIES=200: 注入 205 条, 保留最后 200 条(seq=6..205)', async () => {
    const { realError, values } = await runCaptureTest([
      'for i in range(205):',
      '\tcap._log_error("f", "a.gd", i, "c", "r", false, 2, [])',
      'var r = cap.poll(0, false)',
      'print("RESULT count=" + str(r["errors"].size()))',
      'print("RESULT first_seq=" + str(r["errors"][0]["seq"]))',
      'print("RESULT last_seq=" + str(r["errors"][199]["seq"]))',
      'print("RESULT next_seq=" + str(r["next_seq"]))',
    ]);
    expect(realError, '不应有 SCRIPT ERROR').toBe(false);
    // ring buffer pop_front 丢最早的 5 条, 保留 seq=6..205
    expect(values.count).toBe('200');
    expect(values.first_seq).toBe('6');
    expect(values.last_seq).toBe('205');
    expect(values.next_seq).toBe('205');
  });

  it('4 种 error_type → kind 映射: ERROR→error / WARNING→warning / SCRIPT→script / SHADER→shader', async () => {
    const { realError, values } = await runCaptureTest([
      'cap._log_error("f1", "a.gd", 1, "c", "r", false, 0, [])',  // ERROR
      'cap._log_error("f2", "b.gd", 2, "c", "r", false, 1, [])',  // WARNING
      'cap._log_error("f3", "c.gd", 3, "c", "r", false, 2, [])',  // SCRIPT
      'cap._log_error("f4", "d.gd", 4, "c", "r", false, 3, [])',  // SHADER
      'var r = cap.poll(0, false)',
      'print("RESULT k0=" + r["errors"][0]["kind"])',
      'print("RESULT k1=" + r["errors"][1]["kind"])',
      'print("RESULT k2=" + r["errors"][2]["kind"])',
      'print("RESULT k3=" + r["errors"][3]["kind"])',
    ]);
    expect(realError, '不应有 SCRIPT ERROR').toBe(false);
    expect(values.k0).toBe('error');
    expect(values.k1).toBe('warning');
    expect(values.k2).toBe('script');
    expect(values.k3).toBe('shader');
  });

  it('MAX_TEXT_LEN=4096 截断: 超长 message/code/function/file 被截断到 4096', async () => {
    const { realError, values } = await runCaptureTest([
      'var long_msg = "x".repeat(5000)',
      'cap._log_error(long_msg, long_msg, 1, long_msg, long_msg, false, 2, [])',
      'var r = cap.poll(0, false)',
      'print("RESULT msg_len=" + str(r["errors"][0]["message"].length()))',
      'print("RESULT code_len=" + str(r["errors"][0]["code"].length()))',
      'print("RESULT func_len=" + str(r["errors"][0]["function"].length()))',
      'print("RESULT file_len=" + str(r["errors"][0]["file"].length()))',
    ]);
    expect(realError, '不应有 SCRIPT ERROR').toBe(false);
    // rationale 优先于 code, msg 取 rationale 截断; code/function/file 各自截断
    expect(values.msg_len).toBe('4096');
    expect(values.code_len).toBe('4096');
    expect(values.func_len).toBe('4096');
    expect(values.file_len).toBe('4096');
  });

  it('rationale 优先: rationale 非空时 message 取 rationale 而非 code', async () => {
    const { realError, values } = await runCaptureTest([
      'cap._log_error("f", "a.gd", 1, "code_text", "rationale_text", false, 2, [])',
      'var r = cap.poll(0, false)',
      'print("RESULT msg=" + r["errors"][0]["message"])',
    ]);
    expect(realError, '不应有 SCRIPT ERROR').toBe(false);
    expect(values.msg).toBe('rationale_text');
  });

  it('rationale 为空时 message 回退到 code', async () => {
    const { realError, values } = await runCaptureTest([
      'cap._log_error("f", "a.gd", 1, "code_text", "", false, 2, [])',
      'var r = cap.poll(0, false)',
      'print("RESULT msg=" + r["errors"][0]["message"])',
    ]);
    expect(realError, '不应有 SCRIPT ERROR').toBe(false);
    expect(values.msg).toBe('code_text');
  });

  it('非法 error_type(如 99) 不捕获, buffer 仍空', async () => {
    const { realError, values } = await runCaptureTest([
      'cap._log_error("f", "a.gd", 1, "c", "r", false, 99, [])',  // 非法 type
      'var r = cap.poll(0, false)',
      'print("RESULT count=" + str(r["errors"].size()))',
    ]);
    expect(realError, '不应有 SCRIPT ERROR').toBe(false);
    expect(values.count).toBe('0');
  });

  it('clear() 显式清空: 注入后 clear, poll 返回 0', async () => {
    const { realError, values } = await runCaptureTest([
      'cap._log_error("f", "a.gd", 1, "c", "r", false, 2, [])',
      'cap.clear()',
      'var r = cap.poll(0, false)',
      'print("RESULT count=" + str(r["errors"].size()))',
    ]);
    expect(realError, '不应有 SCRIPT ERROR').toBe(false);
    expect(values.count).toBe('0');
  });
});
