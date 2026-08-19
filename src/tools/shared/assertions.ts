// Assertion infrastructure for dev_loop acceptance and delivery.ts assertions.

import { escapeForGdLiteral, normalizeIndentToTabs } from './value-serializer.js';
import { SCENE_TREE_HEADER } from '../../core/shared/gdscript-templates.js';
import { scanGdscriptSandbox } from '../../gdscript-executor.js';

/** Shared assertion wrapper — called by both dev_loop.acceptance and delivery.ts assertions.
 *  Scans user assertion code through the GDScript sandbox before wrapping (C-SEC-07).
 *
 *  ASSERT 协议生成(反假绿):wrapper 在用户代码后强制从 _mcp_outputs 的 assert_result 派生
 *  ASSERT PASS/FAIL 并 print,用户无法手写 print 伪造(defect visual-proof-assert-protocol-implicit)。
 *  expected 给出 → actual==expected 才 PASS;未给 → assert_result 非空即 PASS(证据)。 */
export function wrapAssertionCode(assertionCode: string, description: string, loadScene = true, expected?: string): string {
  const sandboxWarnings = scanGdscriptSandbox(assertionCode);
  if (sandboxWarnings.length > 0) {
    throw new Error(`Assertion code blocked by sandbox: ${sandboxWarnings.join('; ')}`);
  }
  // 纯字面量上下文(_desc 仅 print 显示 / expected 仅字符串比较,均非 % 格式串)→ escapeForGdLiteral
  const escapedDesc = escapeForGdLiteral(description);
  const sceneLoadLine = loadScene ? '\t_mcp_load_main_scene()\n' : '';
  // Normalize spaces to tabs BEFORE joining with tab prefix to avoid mixed indentation
  const normalizedCode = normalizeIndentToTabs(assertionCode.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
  const indentedCode = normalizedCode.split('\n').join('\n\t');
  // ASSERT 协议派生(反假绿):读 _mcp_outputs.assert_result → 比对 expected → print ASSERT PASS/FAIL。
  // wrapper 强制生成,用户无法手写 print 伪造通过状态。
  const escapedExpected = expected != null ? escapeForGdLiteral(expected) : '';
  const passCond = expected != null ? `if _ar == "${escapedExpected}":` : 'if _ar != "":';
  const assertGenCode = [
    '\tvar _ar: String = ""',
    '\tfor _e in _mcp_outputs:',
    '\t\tvar _entry: Dictionary = _e',
    '\t\tif String(_entry["key"]) == "assert_result":',
    '\t\t\t_ar = String(_entry["value"])',
    '\t\t\tbreak',
    `\t${passCond}`,
    '\t\tprint("ASSERT PASS: " + _desc)',
    '\telse:',
    '\t\tprint("ASSERT FAIL: " + _desc)',
  ].join('\n') + '\n';
  return `${SCENE_TREE_HEADER}

func _initialize():
${sceneLoadLine}\tvar _desc = "${escapedDesc}"
\t# --- user assertion code ---
\t${indentedCode}
\t# --- end user code ---
${assertGenCode}\t_mcp_done()
`;
}
