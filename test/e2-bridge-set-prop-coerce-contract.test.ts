import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// 批 E (2026-08-14) E-2 契约测试:bridge set_node_property 补存在性校验 + 数学 coerce。
// 修复前:仅 _is_blocked_property + _is_safe_value 两道守卫后裸 node.set——拼错属性名 /
// Array→Vector / Resource 传 String 均 no-op + success:true(三路中唯一无存在性校验无转换)。
//
// ⚠️ 局限(对齐 g1-playtest-control-contract 范式的过渡手段):源码字符串断言验证
// "修复模式落位"而非运行时行为。运行时行为由 bridge 实测覆盖(见 task-E-report.md)。

const gd = readFileSync('src/scripts/mcp_bridge.gd', 'utf8');

function sliceBetween(startAnchor: string, endAnchor: string): string {
  const start = gd.indexOf(startAnchor);
  expect(start, `锚点未找到: ${startAnchor}`).toBeGreaterThanOrEqual(0);
  const end = gd.indexOf(endAnchor, start);
  expect(end, `结束锚点未找到: ${endAnchor}`).toBeGreaterThan(start);
  return gd.slice(start, end);
}

const cmdFn = () => sliceBetween('func _cmd_set_node_property', '# E-2 (2026-08-14): 查属性声明类型');
const getTypeFn = () => sliceBetween('func _get_property_type', '# E-2 (2026-08-14): MCP JSON Array/Dict 输入');
const coerceFn = () => sliceBetween('func _coerce_math_value', '# E-2: 数学分量读取');

describe('E-2: bridge set_node_property 存在性校验 + 数学 coerce(mcp_bridge.gd)', () => {
  it('E2-a: 属性存在性校验(-1 → "Property not found" 报错,code -7)', () => {
    const s = cmdFn();
    expect(s.includes('var prop_type := _get_property_type(node, prop)'), '缺 _get_property_type 调用').toBe(true);
    expect(s.includes('if prop_type == -1:'), '缺 -1 存在性判断').toBe(true);
    expect(s.includes('Property not found: %s on %s'), '缺 Property not found 报错').toBe(true);
    expect(s.includes('"code": -7'), '缺 code -7').toBe(true);
  });

  it('E2-b: 存在性校验先于 node.set(防校验后置)', () => {
    const s = cmdFn();
    expect(
      s.indexOf('if prop_type == -1:'),
      '存在性校验应先于 node.set'
    ).toBeLessThan(s.indexOf('node.set(prop, coerced)'));
  });

  it('E2-c: 数学 coerce 仅 Array/Dict 输入走转换(标量/null/已是数学类型透传)', () => {
    const s = cmdFn();
    expect(s.includes('if value is Array or value is Dictionary:'), '缺 Array/Dict gate').toBe(true);
    expect(s.includes('_coerce_math_value(prop_type, value)'), '缺 _coerce_math_value 调用').toBe(true);
  });

  it('E2-d: coerce 构造失败(分量缺失/null)报错拒绝,不再假成功(code -8)', () => {
    const s = cmdFn();
    expect(s.includes('if coerced == null:'), '缺 coerce 失败判断').toBe(true);
    expect(s.includes('cannot coerce'), '缺 cannot coerce 报错').toBe(true);
    expect(s.includes('"code": -8'), '缺 code -8').toBe(true);
  });

  it('E2-e [负向]: 不再裸 node.set(prop, value)(set 的是 coerced)', () => {
    expect(cmdFn().includes('node.set(prop, value)'), '仍存在裸 set(prop, value) 旧模式').toBe(false);
    expect(cmdFn().includes('node.set(prop, coerced)'), 'set 应使用 coerced').toBe(true);
  });

  it('E2-f: _coerce_math_value 三副本同步注释(源=command_helpers.gd + headless 副本指向)', () => {
    const comment = sliceBetween('# E-2 (2026-08-14): MCP JSON Array/Dict 输入', 'func _coerce_math_value');
    expect(comment.includes('addons/godot_mcp_server/commands/command_helpers.gd'), '缺源副本指向').toBe(true);
    expect(comment.includes('src/scripts/godot_operations.gd'), '缺 headless 副本指向').toBe(true);
    expect(comment.toLowerCase().includes('duplicate'), '缺 DUPLICATE 同步声明').toBe(true);
  });

  it('E2-g: 类型矩阵覆盖(Vector2/2i/3/3i/4/4i/Color/Plane/Quaternion/Rect2/2i)+构造器', () => {
    const s = coerceFn();
    for (const t of ['TYPE_VECTOR2', 'TYPE_VECTOR2I', 'TYPE_VECTOR3', 'TYPE_VECTOR3I', 'TYPE_VECTOR4', 'TYPE_VECTOR4I', 'TYPE_COLOR', 'TYPE_PLANE', 'TYPE_QUATERNION', 'TYPE_RECT2', 'TYPE_RECT2I']) {
      expect(s.includes(t), `_coerce_math_value 缺 ${t} 分支`).toBe(true);
    }
    for (const ctor of ['Vector2(', 'Vector2i(', 'Vector3(', 'Vector3i(', 'Vector4(', 'Vector4i(', 'Color(', 'Plane(', 'Quaternion(', 'Rect2(', 'Rect2i(']) {
      expect(s.includes(ctor), `缺构造器 ${ctor}`).toBe(true);
    }
  });

  it('E2-h: _get_property_type 副本存在(-1=不存在的既定语义)', () => {
    expect(gd.includes('func _get_property_type(obj: Object, key: String) -> int'), '缺 _get_property_type 定义').toBe(true);
    expect(getTypeFn().includes('return -1'), '缺 return -1 语义').toBe(true);
  });

  it('E2-i: 守卫顺序完整(blocked → 存在性 → safe_value → coerce → set)', () => {
    const s = cmdFn();
    const idxBlocked = s.indexOf('_is_blocked_property(prop)');
    const idxExists = s.indexOf('if prop_type == -1:');
    const idxSafe = s.indexOf('_is_safe_value(value)');
    const idxCoerce = s.indexOf('_coerce_math_value(prop_type, value)');
    const idxSet = s.indexOf('node.set(prop, coerced)');
    expect(idxBlocked, 'blocked 守卫缺失').toBeGreaterThan(0);
    expect(idxExists, 'blocked 应先于存在性校验').toBeGreaterThan(idxBlocked);
    expect(idxSafe, '存在性校验应先于 safe_value').toBeGreaterThan(idxExists);
    expect(idxCoerce, 'safe_value 应先于 coerce').toBeGreaterThan(idxSafe);
    expect(idxSet, 'coerce 应先于 set').toBeGreaterThan(idxCoerce);
  });
});
