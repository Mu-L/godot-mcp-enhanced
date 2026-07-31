import { describe, it, expect } from 'vitest';
import {
  escapeTscnAttr, formatTscnValue, escapeTscnValue, escapeRegExp,
  normalizeLines, findSectionEnd, getBracketAttr,
  leafName, parentPath, findNodeSectionLine,
} from '../src/tscn/tscn-editor-shared.js';

// I-1: escapeTscnAttr 必须与 escapeTscnValue 一致地拒绝换行符。
// 当前 add 白名单(^[A-Za-z0-9_]+$)与 detach 严格相等阻挡了换行进入,但根因(转义函数本身
// 不拒绝换行)是定时炸弹——任何对 findInstanceNode 的"善意"修改都会立即激活 [node] 段注入。
describe('escapeTscnAttr (I-1: reject newlines)', () => {
  it('rejects LF in attribute value', () => {
    expect(() => escapeTscnAttr('a\nb')).toThrow(/newlines/i);
  });

  it('rejects CR in attribute value', () => {
    expect(() => escapeTscnAttr('a\rb')).toThrow(/newlines/i);
  });

  it('rejects CRLF in attribute value', () => {
    expect(() => escapeTscnAttr('a\r\nb')).toThrow(/newlines/i);
  });

  it('still escapes backslash, quote, bracket on clean values', () => {
    // 输入: a"b]c\d  →  转义后: a\"b\]c\\d
    expect(escapeTscnAttr('a"b]c\\d')).toBe('a\\"b\\]c\\\\d');
  });

  it('escapes [ as well as ] (IMP-3: single-line injection surface)', () => {
    // IMP-3 (2026-06-26 review): [ 与 ] 对称转义,防含 [ 的属性值污染 .tscn [node] 头部语义
    expect(escapeTscnAttr('a[b')).toBe('a\\[b');
    expect(escapeTscnAttr('[node]')).toBe('\\[node\\]');
  });

  it('returns empty string for falsy input', () => {
    expect(escapeTscnAttr('')).toBe('');
  });

  // IMPORTANT-5 (R2): escapeTscnAttr 返回值多处经 String.replace(pattern, `...${escape(...)}...`) 用作替换串。
  // 替换串中 $&/$1/$2 是特殊模式。nodeName='$&' 会被 replace 换成"整个匹配"破坏 .tscn 结构。
  // 转义 $ → $$ (替换串中 $$ = 字面 $),根因修复覆盖 detach/merge 所有调用点。
  it('escapes $ to $$ for safe use in String.replace replacement strings', () => {
    expect(escapeTscnAttr('a$b')).toBe('a$$b');
    expect(escapeTscnAttr('$&')).toBe('$$&');
  });
});

// I-3: GODOT_LITERAL_RE 只锚 ^ 不锚 $,导致 `Vector2(1,2) junk` 被识别为字面量,
// 不加引号原样输出,污染属性行语义(单行内附加垃圾)。
// 修复:完整锚定 + 每个 Type( 改为 Type([^)]*)。
describe('formatTscnValue (I-3: full-anchor literal detection)', () => {
  it('keeps clean Godot literal unquoted', () => {
    expect(formatTscnValue('Vector2(10, 20)')).toBe('Vector2(10, 20)');
    expect(formatTscnValue('Vector2(10,20)')).toBe('Vector2(10,20)');
    expect(formatTscnValue('ExtResource(1)')).toBe('ExtResource(1)');
    expect(formatTscnValue('Color(1, 0, 0, 1)')).toBe('Color(1, 0, 0, 1)');
    // 字面量内部字符不转义(NodePath 的引号、Array 的 ] 都有语法意义,转义会破坏字面量)
    expect(formatTscnValue('NodePath("Player/Sprite")')).toBe('NodePath("Player/Sprite")');
    expect(formatTscnValue('Array([1, 2, 3])')).toBe('Array([1, 2, 3])');
  });

  it('quotes value with trailing junk after a literal (I-3 fix)', () => {
    // 旧行为: 匹配 Vector2( 开头 → 不加引号 → 输出污染行
    // 新行为: 完整锚定失败 → 加引号(safe fail)
    expect(formatTscnValue('Vector2(1,2) junk')).toBe('"Vector2(1,2) junk"');
    expect(formatTscnValue('ExtResource(1) extra')).toBe('"ExtResource(1) extra"');
  });

  it('escapes [ in quoted non-literal value (IMP-3 fix)', () => {
    // IMP-3: 非字面量值经 escapeTscnValue,[ 也转义(与 ] 对称)
    expect(formatTscnValue('a[b')).toBe('"a\\[b"');
  });

  it('quotes plain strings and keeps scalars unquoted', () => {
    expect(formatTscnValue('hello')).toBe('"hello"');
    expect(formatTscnValue('true')).toBe('true');
    expect(formatTscnValue('false')).toBe('false');
    expect(formatTscnValue('null')).toBe('null');
    expect(formatTscnValue('42')).toBe('42');
    expect(formatTscnValue('3.14')).toBe('3.14');
  });
});

// ── 补覆盖：纯函数 escapeTscnValue/escapeRegExp/normalizeLines/findSectionEnd ─────
describe('escapeTscnValue (拒绝换行 + 转义 \\"\[\])', () => {
  it('拒绝换行（与 escapeTscnAttr 对齐）', () => {
    expect(() => escapeTscnValue('a\nb')).toThrow(/newlines/i);
    expect(() => escapeTscnValue('a\rb')).toThrow(/newlines/i);
  });
  it('转义反斜杠/引号/方括号', () => {
    expect(escapeTscnValue('a"b')).toBe('a\\"b');
    expect(escapeTscnValue('a\\b')).toBe('a\\\\b');
    expect(escapeTscnValue('a]b')).toBe('a\\]b');
    expect(escapeTscnValue('a[b')).toBe('a\\[b');
  });
  it('无特殊字符原样返回', () => {
    expect(escapeTscnValue('plain')).toBe('plain');
  });
});

describe('escapeRegExp (RegExp 特殊字符转义)', () => {
  it('转义 . * + ? 等元字符', () => {
    expect(escapeRegExp('a.b*c')).toBe('a\\.b\\*c');
    expect(escapeRegExp('a(b)c')).toBe('a\\(b\\)c');
  });
  it('无元字符原样返回', () => {
    expect(escapeRegExp('plain')).toBe('plain');
  });
});

describe('normalizeLines (CRLF/LF 归一)', () => {
  it('CRLF → LF split', () => {
    expect(normalizeLines('a\r\nb')).toEqual(['a', 'b']);
  });
  it('裸 CR → LF split', () => {
    expect(normalizeLines('a\rb')).toEqual(['a', 'b']);
  });
  it('LF split', () => {
    expect(normalizeLines('a\nb\nc')).toEqual(['a', 'b', 'c']);
  });
});

describe('findSectionEnd (找下一 [ section 边界)', () => {
  const lines = ['[node name="A"]', 'prop = 1', '[node name="B"]', 'prop = 2'];
  it('从 section 内返回下一个 [ 行索引', () => {
    expect(findSectionEnd(lines, 0)).toBe(2);
  });
  it('末段无下一个 [ 返回 length', () => {
    expect(findSectionEnd(lines, 2)).toBe(4);
  });
});

// ── 节点路径 + section 查找（findNodeSectionLine 依赖 leafName/parentPath/getBracketAttr）──
describe('leafName / parentPath (nodePath 拆分)', () => {
  it('leafName 取末段', () => {
    expect(leafName('Root/Player/Sprite2D')).toBe('Sprite2D');
    expect(leafName('Alone')).toBe('Alone');
  });
  it('parentPath 取前缀（单段返空串）', () => {
    expect(parentPath('Root/Player/Sprite2D')).toBe('Root/Player');
    expect(parentPath('Alone')).toBe('');
  });
});

describe('getBracketAttr ([node] 头部属性提取)', () => {
  it('提取 name 属性', () => {
    expect(getBracketAttr('[node name="Player" type="Node2D"]', 'name')).toBe('Player');
  });
  it('提取 parent 属性', () => {
    expect(getBracketAttr('[node name="Player" parent="Root" instance=ExtResource("1")]', 'parent')).toBe('Root');
  });
  it('属性不存在返 null', () => {
    expect(getBracketAttr('[node name="Player"]', 'parent')).toBeNull();
  });
});

describe('findNodeSectionLine (按 nodePath 定位 [node] 行索引)', () => {
  const lines = [
    '[node name="Main" type="Node2D"]',           // 0: 根节点（无 parent）
    'position = Vector2(0, 0)',
    '[node name="Player" parent="." instance=ExtResource("1")]',  // 2: 有 parent="."
    'speed = 100',
    '[node name="Sprite" parent="Player" type="Sprite2D"]',       // 4: parent="Player"
  ];
  it('根节点（无 parent）命中', () => {
    expect(findNodeSectionLine(lines, 'Main')).toBe(0);
  });
  it('parent="." 节点命中', () => {
    expect(findNodeSectionLine(lines, './Player')).toBe(2);
  });
  it('parent="Player" 子节点命中', () => {
    expect(findNodeSectionLine(lines, 'Player/Sprite')).toBe(4);
  });
  it('不存在返 -1', () => {
    expect(findNodeSectionLine(lines, 'Nonexistent')).toBe(-1);
  });
  it('name 匹配但 parent 不匹配不命中', () => {
    // Player 存在但 parent 期望 Wrong，应返 -1
    expect(findNodeSectionLine(lines, 'Wrong/Player')).toBe(-1);
  });
});
