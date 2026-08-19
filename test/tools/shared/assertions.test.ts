import { describe, it, expect } from 'vitest';
import { wrapAssertionCode } from '../../../src/tools/shared/assertions.js';

// 反假绿:defect visual-proof-assert-protocol-implicit 修复
// wrapper 必须强制从 assert_result output 派生 ASSERT PASS/FAIL,用户无法手写 print 伪造。
// 修复前:wrapAssertionCode 不生成 ASSERT,visual_proof 依赖用户手写 print → 假通过/假失败。
describe('wrapAssertionCode — ASSERT 协议生成(反假绿)', () => {
  it('生成的 GDScript 含 ASSERT PASS 与 ASSERT FAIL print 分支', () => {
    const code = wrapAssertionCode('_mcp_output("assert_result", "ok")', 'player moves', true, 'ok');
    expect(code).toContain('ASSERT PASS');
    expect(code).toContain('ASSERT FAIL');
  });

  it('用户代码后有读 _mcp_outputs.assert_result 的逻辑(wrapper 派生 ASSERT)', () => {
    const code = wrapAssertionCode('_mcp_output("assert_result", "ok")', 'd', true, 'ok');
    const afterUser = code.split('# --- end user code ---')[1] ?? '';
    expect(afterUser).toMatch(/_mcp_outputs/);
    expect(afterUser).toMatch(/assert_result/);
  });

  it('无 expected 时仍生成 ASSERT(基于 assert_result 证据,非用户手写)', () => {
    const code = wrapAssertionCode('_mcp_output("assert_result", "anything")', 'd');
    expect(code).toContain('ASSERT');
  });

  it('expected 注入到 wrapper 且经 escapeForGdLiteral 防 GDScript 注入', () => {
    // 正常 expected 被注入
    const code = wrapAssertionCode('_mcp_output("assert_result","x")', 'd', true, 'safe_value');
    expect(code).toContain('safe_value');
    // 恶意 expected 不能逃逸成代码
    const evil = 'x") ; print("injected"); #';
    const evilCode = wrapAssertionCode('_mcp_output("assert_result","x")', 'd', true, evil);
    expect(evilCode).not.toContain('print("injected")');
  });

  it('expected 含 % 时按字面量转义不双写(纯字符串比较上下文,非 % 格式串)', () => {
    // I-1b 回归:expected 消费于 `if _ar == "..."` 纯比较,gdEscape 双写 %% 会致含 % 断言恒误报
    const code = wrapAssertionCode('_mcp_output("assert_result","x")', 'd', true, 'progress 50%');
    expect(code).toContain('progress 50%');
    expect(code).not.toContain('50%%');
  });

  it('description 含 % 时按字面量转义不双写(print 显示上下文)', () => {
    // I-1c 回归:_desc 仅用于 print 显示,gdEscape 双写 %% 会致显示文案 "100%%"
    const code = wrapAssertionCode('_mcp_output("assert_result","x")', 'HP 100% 后仍存活', true, 'x');
    expect(code).toContain('HP 100%');
    expect(code).not.toContain('100%%');
  });
});
