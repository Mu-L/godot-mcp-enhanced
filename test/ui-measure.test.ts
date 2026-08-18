import { describe, it, expect } from 'vitest';
import { genUiMeasureScript } from '../src/tools/ui/ui-measure.js';

describe('genUiMeasureScript', () => {
  it('生成 full-class SceneTree 脚本:等帧 + marker 输出 + quit', () => {
    const s = genUiMeasureScript('res://scenes/main.tscn', undefined, 16);
    expect(s.startsWith('extends SceneTree')).toBe(true);
    expect(s).toContain('process_frame.connect(_on_measure_frame)');
    expect(s).toContain('_mcp_output("measure"');
    expect(s).toContain('_mcp_done()');
    expect(s).toContain('quit(0)');
    expect(s).toContain('_mcp_load_scene("res://scenes/main.tscn")');
  });

  it('稳定判定:连续 2 帧快照一致即输出,上限 5 帧', () => {
    const s = genUiMeasureScript('res://scenes/main.tscn', undefined, 16);
    expect(s).toContain('_stable_count >= 2');
    expect(s).toContain('_frames >= 5');
  });

  it('C1(M-a): 输出含 stalled 标志(5 帧上限内未达 2 帧稳定)', () => {
    const s = genUiMeasureScript('res://scenes/main.tscn', undefined, 16);
    expect(s).toContain('"stalled": _frames >= 5 and _stable_count < 2');
  });

  it('C1(M-b): 输出含 viewport(content_scale_size,根级 rect 参照系;headless 下 Window.size 不可靠)', () => {
    const s = genUiMeasureScript('res://scenes/main.tscn', undefined, 16);
    expect(s).toContain('var _vp := root.content_scale_size');
    expect(s).toContain('"viewport": {"w": _vp.x, "h": _vp.y}');
  });

  it('node_path 限定测量子树', () => {
    const s = genUiMeasureScript('res://scenes/main.tscn', 'HUD', 16);
    expect(s).toContain('_mcp_get_scene_node("HUD")');
  });

  // Task 2(debt-cleanup-20260818):sp/np 只内嵌进纯字符串字面量(load 调用/np 查找/
  // 错误信息),不参与 % 格式化——gdEscape 会把 % 双写成 %% 导致含 % 的路径被静默改写、
  // 加载失败;纯字面量上下文必须走 escapeForGdLiteral。
  it('T2: scenePath/nodePath 含 % 不双写——纯字面量内插走 escapeForGdLiteral', () => {
    const s = genUiMeasureScript('res://a%b.tscn', '/Root/%Unique', 16);
    expect(s).toContain('_mcp_load_scene("res://a%b.tscn")');
    expect(s).toContain('_mcp_get_scene_node("/Root/%Unique")');
    expect(s).toContain('Node not found: /Root/%Unique');
    expect(s).not.toContain('a%%b');
    expect(s).not.toContain('%%Unique');
  });

  it('maxDepth 截断深度', () => {
    const s = genUiMeasureScript('res://scenes/main.tscn', undefined, 7);
    expect(s).toContain('depth > 7');
  });

  it('节点数上限 2000 防爆', () => {
    const s = genUiMeasureScript('res://scenes/main.tscn', undefined, 16);
    expect(s).toContain('_count >= 2000');
  });

  it('maxDepth clamp 到 1-64,NaN/Infinity 回落默认 16(防生成 depth > NaN 非法 GD)', () => {
    expect(genUiMeasureScript('res://scenes/main.tscn', undefined, 0)).toContain('depth > 1');
    expect(genUiMeasureScript('res://scenes/main.tscn', undefined, 100)).toContain('depth > 64');
    expect(genUiMeasureScript('res://scenes/main.tscn', undefined, Number.NaN)).toContain('depth > 16');
    expect(genUiMeasureScript('res://scenes/main.tscn', undefined, Number.POSITIVE_INFINITY)).toContain('depth > 16');
  });
});

// ─── PR-2 Task 3: style 按需读回(spec §4.1) ───────────────────────────────

describe('genUiMeasureScript style 读回(PR-2)', () => {
  it('styleExpect 传入:内嵌 JSON.parse_string(转义单字符串,防 name 注入)+ has_override 并集 + get_theme_stylebox 读回', () => {
    const s = genUiMeasureScript('res://main.tscn', undefined, 16,
      [{ path: 'Root/Card', slots: ['panel', 'fill'] }]);
    expect(s).toContain('JSON.parse_string');
    expect(s).toContain('Root/Card');
    expect(s).toContain('has_theme_stylebox_override');
    expect(s).toContain('get_theme_stylebox');
    expect(s).toContain('StyleBoxFlat');
    expect(s).toContain('corner_radius_top_left');
    expect(s).toContain('border_width_bottom');
    expect(s).toContain('get_class');  // 非 Flat 输出 type 字段
  });
  it('name 含引号/反斜杠等任意字符时安全转义(gdEscape 过 JSON 字符串)', () => {
    const s = genUiMeasureScript('res://main.tscn', undefined, 16,
      [{ path: 'A\\"B\\nC', slots: ['panel'] }]);
    expect(s).not.toMatch(/JSON\.parse_string\("A\\"/);  // 不允许裸字面量拼接出非法 GD
    expect(s).toContain('JSON.parse_string');
  });
  it('I-1:name 含 % / " / \\ / 换行时期望清单 round-trip——不双写 %%,unescape 后 key 与原始 path 全等', () => {
    const styleExpect = [
      { path: 'x%y', slots: ['panel'] },
      { path: 'A"B', slots: ['fill'] },
      { path: 'back\\slash', slots: ['hover'] },
      { path: 'line\nbreak', slots: ['pressed'] },
    ];
    const s = genUiMeasureScript('res://main.tscn', undefined, 16, styleExpect);
    // 提取 JSON.parse_string("...") 的内嵌文本(换行已转义为 \n 字面量,注入为单行)
    const m = s.match(/JSON\.parse_string\("(.*)"\)/);
    expect(m).not.toBeNull();
    const embedded = m?.[1] ?? '';
    // ① 不含 %% 双写(gdEscape 的 % 格式化转义指纹,I-1 缺陷根因)
    expect(embedded.includes('%%')).toBe(false);
    // ② 模拟 GD 字符串字面量 unescape(覆盖 escapeForGdLiteral 的转义集 \\ \" \n \t),
    //    还原出的 JSON 文本与原始 JSON 逐字相等,parse 后 key 与原始 path 全等
    const unescaped = embedded.replace(/\\(["\\nt])/g, (_all, ch: string) =>
      ch === 'n' ? '\n' : ch === 't' ? '\t' : ch);
    const rawJson = JSON.stringify(Object.fromEntries(styleExpect.map(e => [e.path, [...e.slots]])));
    expect(unescaped).toBe(rawJson);
    const parsed: Record<string, unknown> = JSON.parse(unescaped);
    expect(Object.keys(parsed).sort()).toEqual(styleExpect.map(e => e.path).sort());
  });
  it('styleExpect 缺省 → 无 _style_expect 初始化注入(与现状脚本一致,向后兼容)', () => {
    const s = genUiMeasureScript('res://main.tscn', undefined, 16);
    expect(s).toContain('var _style_expect: Dictionary = {}');
    expect(s).not.toContain('JSON.parse_string');
    // 读回段仍在(override 并集条件——手写树无期望清单也能读到)
    expect(s).toContain('has_theme_stylebox_override');
  });
  it('styleExpect 空数组 → 同缺省(不注入 parse)', () => {
    const s = genUiMeasureScript('res://main.tscn', undefined, 16, []);
    expect(s).not.toContain('JSON.parse_string');
  });
  it('七槽白名单常量内嵌', () => {
    const s = genUiMeasureScript('res://main.tscn', undefined, 16, [{ path: 'X', slots: ['panel'] }]);
    expect(s).toContain('"panel", "normal", "background", "fill", "hover", "pressed", "disabled"');
  });
});
