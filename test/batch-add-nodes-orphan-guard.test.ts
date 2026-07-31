/**
 * P1-1(addons): batch_add_nodes 预校验孤儿 Node leak 防护（源码级契约）。
 *
 * 缺陷背景（vault 2026-07-31 addons GDScript 审查 P1-1）：
 *   node_commands.gd handle_batch_add_nodes 预校验循环内先 ClassDB.instantiate(:229)
 *   再 append 到 validated(:233)，若后续轮次在 :223/:225/:228 early return，
 *   前面已 instantiate 的 cls 节点未 free → 孤儿 Node leak（:267-271 孤儿扫描在
 *   create_action_mixed 之后，early return 到不了）。
 *
 * 修复方案（对齐 asset_placer.gd:64-90 两阶段模式）：
 *   预校验阶段只校验 name/type/parent 不 instantiate；全过后第二阶段才
 *   ClassDB.instantiate + append。这样 early return 时根本没 instantiate，无孤儿。
 *
 * 测试模式说明：
 *   handle_batch_add_nodes 依赖 EditorInterface/_undo_manager，headless --script
 *   模式下 :203 ei==null 短路，无法用 gdscript-unit 模式测行为。改用源码级契约
 *   （验证预校验阶段不含 ClassDB.instantiate），防重构回退。行为正确性靠两阶段
 *   逻辑论证（asset_placer 同模式已生产验证）+ validate_scripts 语法保证。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NODE_CMD_SRC = readFileSync(
  join(__dirname, '../addons/godot_mcp_server/commands/node_commands.gd'),
  'utf-8',
);

/**
 * 抽取 handle_batch_add_nodes 函数体（从函数签名到下一个顶层 func）。
 */
function extractHandler(src: string): string {
  const startIdx = src.indexOf('func handle_batch_add_nodes(');
  if (startIdx < 0) throw new Error('找不到 handle_batch_add_nodes 函数');
  // 下一个顶层 func（行首 'func '，非缩进）
  const rest = src.slice(startIdx + 1);
  const nextFunc = rest.match(/\nfunc /);
  const endIdx = nextFunc ? startIdx + 1 + nextFunc.index : src.length;
  return src.slice(startIdx, endIdx);
}

/**
 * 剥离注释/字符串内容（等长空格替换），防 grep 假绿。
 * 对齐 testing-lesson-grep-fake-green-triple-defense 教训。
 */
function stripCommentsAndStrings(src: string): string {
  const chars = src.split('');
  let i = 0;
  const blankTo = (end: number) => {
    for (let j = i; j < end; j++) if (chars[j] !== '\n') chars[j] = ' ';
  };
  while (i < chars.length) {
    const c = chars[i]; const next = chars[i + 1];
    if (c === '#' ) {
      // GDScript 行注释 #（注意：# 在 GDScript 里也是注释，不是字符串）
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? chars.length : end;
      blankTo(stop);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      chars[i] = ' ';
      i++;
      while (i < chars.length && chars[i] !== quote) {
        if (chars[i] !== '\n') chars[i] = ' ';
        i++;
      }
      if (i < chars.length) chars[i] = ' ';
      i++;
      continue;
    }
    i++;
  }
  return chars.join('');
}

const HANDLER = extractHandler(NODE_CMD_SRC);
const HANDLER_CLEAN = stripCommentsAndStrings(HANDLER);

// 等长校验（strip 实现变化时失败，防下标映射错位）
if (HANDLER_CLEAN.length !== HANDLER.length) {
  throw new Error(`stripCommentsAndStrings 改变了长度（${HANDLER.length}→${HANDLER_CLEAN.length}）`);
}

describe('P1-1(addons): batch_add_nodes 预校验孤儿 leak 防护（两阶段重构契约）', () => {
  it("handle_batch_add_nodes 函数存在且可抽取", () => {
    expect(NODE_CMD_SRC).toMatch(/func handle_batch_add_nodes/);
    expect(HANDLER_CLEAN).toMatch(/ClassDB\.instantiate/);
    expect(HANDLER_CLEAN).toMatch(/validated/);
  });

  it("ClassDB.instantiate 后的 early return 必须清理已积累的 validated（防前序 cls 孤儿）", () => {
    // 原 bug：instantiate 在校验循环内，下一轮 early return 时前几轮 cls 未 free → 孤儿。
    // 修复后两阶段：校验 early return 在第一阶段（无 instantiate，天然无孤儿）；
    // 第二阶段 instantiate 失败的 return（cls 为 null）虽无孤儿，但若前面轮次已成功
    // instantiate + append，该 return 前必须 free validated。
    //
    // 契约：每个 ClassDB.instantiate 之后出现的 return {（error return），其前 200 字符内
    // 必须出现 free 清理（free 已积累的 validated）。
    const cleaned = HANDLER_CLEAN;
    const instRegex = /ClassDB\.instantiate/g;
    let violated = false;
    let detail = '';
    let m: RegExpExecArray | null;
    while ((m = instRegex.exec(cleaned)) !== null) {
      const afterInst = cleaned.slice(m.index);
      // 找该 instantiate 之后的第一个 return {
      const retMatch = afterInst.match(/\breturn\s*\{/);
      if (!retMatch || retMatch.index === undefined) continue;
      const retPos = m.index + retMatch.index;
      // return 前 250 字符窗口
      const beforeReturn = cleaned.slice(Math.max(0, retPos - 250), retPos);
      // 必须有 free 清理标志：free 调用 + validated 引用
      const hasFree = /\bfree\s*\(/.test(beforeReturn);
      const hasValidatedRef = /validated/.test(beforeReturn);
      if (!hasFree || !hasValidatedRef) {
        violated = true;
        detail = `ClassDB.instantiate (pos ${m.index}) 之后的 return { (pos ${retPos}) 前未找到 free(validated) 清理。\n` +
          `return 前 250 字符：${JSON.stringify(beforeReturn.slice(-200))}`;
        break;
      }
    }
    expect(
      violated,
      `契约违反：ClassDB.instantiate 后的 early return 必须先 free 已积累的 validated，` +
      `防前序轮次 instantiate 的 cls 孤儿 leak。\n${detail}\n\n` +
      `修复：instantiate 失败 return 前，for v in validated: v["cls"].free()。`
    ).toBe(false);
  });

  it("handle_batch_add_nodes 含两阶段结构（校验循环 + instantiate 循环分离）", () => {
    // 重构后应有明确的两个阶段：先校验循环（无 instantiate），再 instantiate 循环。
    // 契约：首个 ClassDB.instantiate 之后，不应再出现校验关键字（node_name/node_type/parent not found）
    // 的 early return —— 因为这些校验应在第一阶段完成。
    const cleaned = HANDLER_CLEAN;
    const firstInst = cleaned.indexOf('ClassDB.instantiate');
    expect(firstInst, '应至少有一处 ClassDB.instantiate').toBeGreaterThan(0);

    const afterFirstInst = cleaned.slice(firstInst);
    // instantiate 之后不应再出现这些校验失败 message 的痕迹（清洗后字符串变空格，
    // 但 message 模板的数字 code 和结构还在）。用更稳的标志：instantiate 之后不应再有
    // node_name 校验正则 _name_re 的引用。
    const lateValidations = afterFirstInst.match(/_name_re|_is_allowed_node_type|find_node/g) ?? [];
    expect(
      lateValidations.length,
      `首个 ClassDB.instantiate 之后不应再出现预校验操作（_name_re/_is_allowed_node_type/find_node），` +
      `实际 ${lateValidations.length} 处。这些校验应在第一阶段（instantiate 之前）全部完成。`
    ).toBe(0);
  });
});
