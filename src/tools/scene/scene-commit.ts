// P2: scene_commit — batch GDScript generator for multi-operation scene editing.
// Generates a single GDScript that loads a scene, executes multiple operations,
// optionally saves, and reports structured results via COMMIT_RESULT prefix.

import { gdEscape, escapeForGdLiteral } from '../shared/value-serializer.js';
import { BLOCKED_PROPS } from './helpers.js';

export const COMMIT_OPERATIONS = [
  'tile_set', 'tile_fill', 'tile_erase', 'tile_clear',
  'tileset_assign', 'node_property', 'node_add',
] as const;

export type CommitOp = typeof COMMIT_OPERATIONS[number];

/**
 * IMPORTANT-7 (review): 校验 operations 数组结构。每个 op 必须有合法 op 字段
 * (对齐 COMMIT_OPERATIONS)。原 scene-commit-tool 用 as unknown as CommitOperation[] 无运行时校验,
 * 畸形 op(op 字段缺失/非法值)会让 generateCommitScript 运行时崩溃或生成畸形 .gd。
 * @returns null 全部合法;否则首条错误信息(含索引与合法值清单)。
 */
export function validateCommitOperations(operations: Array<Record<string, unknown>>): string | null {
  const validOps = new Set<string>(COMMIT_OPERATIONS);
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    const opType = op?.op;
    if (typeof opType !== 'string' || !validOps.has(opType)) {
      return `Op ${i}: invalid op "${String(opType)}". Valid: ${COMMIT_OPERATIONS.join(', ')}`;
    }
    // F-5: 逐 op 校验数值/向量/字符串字段的运行时类型。原实现只校验 op 字段,
    // 其余字段靠 TS 接口(编译时)+ as unknown as 强转,runtime 可被绕过;
    // generateCommitScript 把 op.coords.x 等直接 ${} 插值进 GDScript,
    // 字符串值可注入(二线 scanGdscriptSandbox 兜底,但纵深防御应在输入校验层先拦)。
    const err = validateOpFields(i, opType, op ?? {});
    if (err) return err;
  }
  return null;
}

// F-5: 运行时类型守卫
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isVec2(v: unknown): boolean {
  return typeof v === 'object' && v !== null
    && isNum((v as { x?: unknown }).x) && isNum((v as { y?: unknown }).y);
}
function isStr(v: unknown): v is string {
  return typeof v === 'string';
}

/** F-5: 按 op 类型校验必填字段的运行时类型,堵 as unknown as 强转的注入面。 */
function validateOpFields(idx: number, opType: string, op: Record<string, unknown>): string | null {
  const at = `Op ${idx} (${opType})`;
  const needStr = (key: string): string | null =>
    !isStr(op[key]) ? `${at}: "${key}" must be a string` : null;
  const needVec2 = (key: string): string | null =>
    !isVec2(op[key]) ? `${at}: "${key}" must be {x:number, y:number}` : null;
  const needNum = (key: string): string | null =>
    !isNum(op[key]) ? `${at}: "${key}" must be a finite number` : null;
  const optNum = (key: string): string | null =>
    op[key] !== undefined && !isNum(op[key]) ? `${at}: optional "${key}" must be a finite number` : null;

  switch (opType) {
    case 'tile_set': {
      return needStr('node_path') || needVec2('coords') || needNum('source_id')
        || needVec2('atlas') || optNum('alternative_tile');
    }
    case 'tile_fill': {
      const rg = op.region as { x?: unknown; y?: unknown; w?: unknown; h?: unknown } | undefined;
      const regionValid = !!rg && isNum(rg.x) && isNum(rg.y) && isNum(rg.w) && isNum(rg.h);
      if (!regionValid) return `${at}: "region" must be {x,y,w,h: number}`;
      return needNum('source_id') || needVec2('atlas') || optNum('alternative_tile');
    }
    case 'tile_erase': {
      return needStr('node_path') || needVec2('coords');
    }
    case 'tile_clear': {
      return needStr('node_path');
    }
    case 'tileset_assign': {
      return needStr('node_path') || needStr('tileset_path');
    }
    case 'node_property': {
      return needStr('path') || needStr('property')
        || (op.value === undefined ? `${at}: "value" is required` : null);
    }
    case 'node_add': {
      // parent 可省略(generator 默认),但若提供必须是 string(防 gdEscape(undefined) 崩溃)
      const parentErr = op.parent !== undefined && !isStr(op.parent)
        ? `${at}: optional "parent" must be a string` : null;
      return needStr('name') || needStr('type') || parentErr;
    }
    default:
      return null;
  }
}

interface TileSetOp {
  op: 'tile_set';
  node_path: string;
  coords: { x: number; y: number };
  source_id: number;
  atlas: { x: number; y: number };
  alternative_tile?: number;
}

interface TileFillOp {
  op: 'tile_fill';
  node_path: string;
  region: { x: number; y: number; w: number; h: number };
  source_id: number;
  atlas: { x: number; y: number };
  alternative_tile?: number;
}

interface TileEraseOp {
  op: 'tile_erase';
  node_path: string;
  coords: { x: number; y: number };
}

interface TileClearOp {
  op: 'tile_clear';
  node_path: string;
}

interface TilesetAssignOp {
  op: 'tileset_assign';
  node_path: string;
  tileset_path: string;
}

interface NodePropertyOp {
  op: 'node_property';
  path: string;
  property: string;
  value: unknown;
}

interface NodeAddOp {
  op: 'node_add';
  parent: string;
  name: string;
  type: string;
  properties?: Record<string, unknown>;
}

export type CommitOperation =
  | TileSetOp | TileFillOp | TileEraseOp | TileClearOp
  | TilesetAssignOp | NodePropertyOp | NodeAddOp;

/** Validate a string is a safe GDScript identifier (property name, type name, etc.) */
function isSafeIdentifier(s: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s);
}

// P2-3 (2026-08-06): node_add 类型从黑名单收紧为白名单。
// 原黑名单(IMP-4)只列 9 项敏感类,第三方 addon 注册的 extends Node 恶意 class_name 不在列 →
// ${op.type}.new() 跑其 _ready() → OS.execute RCE(不经 execute_gdscript 沙箱)。
// 白名单镜像 headless 的 ALLOWED_HEADLESS_TYPES(src/scripts/godot_operations.gd:195-211),
// 须与 GD 侧同步(defects detect 守护)。特殊类型请走 add_node 工具(走 GD 二次白名单校验)。
const ALLOWED_COMMIT_NODE_TYPES = new Set([
  // Node3D 系
  'Node3D', 'MeshInstance3D', 'StaticBody3D', 'RigidBody3D',
  'CharacterBody3D', 'Camera3D', 'Light3D', 'DirectionalLight3D',
  'OmniLight3D', 'SpotLight3D', 'CollisionShape3D', 'RayCast3D',
  'Area3D', 'Marker3D', 'PathFollow3D', 'VisibleOnScreenNotifier3D',
  // Node2D 系
  'Node2D', 'Sprite2D', 'AnimatedSprite2D',
  'CollisionShape2D', 'Area2D', 'RigidBody2D', 'CharacterBody2D',
  // 播放器/动画/定时
  'AudioStreamPlayer', 'AudioStreamPlayer2D', 'AudioStreamPlayer3D',
  'AnimationPlayer', 'AnimationTree', 'Timer',
  // Control 系
  'Control',
  'Button', 'Label', 'Panel', 'LineEdit', 'TextEdit', 'RichTextLabel',
  'LinkButton', 'HSlider', 'VSlider', 'CheckBox', 'CheckButton',
  'OptionButton', 'SpinBox', 'ProgressBar', 'TextureRect', 'ColorPickerButton',
  'TabContainer', 'Tree', 'ItemList', 'MarginContainer', 'HBoxContainer',
  'VBoxContainer', 'GridContainer', 'CenterContainer', 'ScrollContainer',
  'PanelContainer', 'HSplitContainer', 'VSplitContainer', 'NinePatchRect',
]);

/**
 * Generate a complete GDScript that executes all operations in sequence,
 * optionally saves the scene, and reports structured results.
 */
export function generateCommitScript(
  scenePath: string,
  operations: CommitOperation[],
  save: boolean,
  stopOnError: boolean = true,
): string {
  const hasFill = operations.some(op => op.op === 'tile_fill');
  const opBlocks: string[] = [];

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i]!;
    opBlocks.push(generateOpBlock(i, op, stopOnError));
  }

  const sp = gdEscape(scenePath);
  // F-2 (批 F, 2026-08-14): save=true 分支顶层 success 绑定 err == OK——原硬编码 true 与
  // saved:err==OK 并存,磁盘满/权限失败(EACCES/ENOSPC)时 COMMIT_RESULT 报成功(假成功),
  // AI 与 middleware 把写盘失败当成功。save=false 分支无保存动作,success:true 是"无保存失败"
  // 的预期语义,保持不变(handleCommitAction 仅在 save 时对 saved:false 置 isError)。
  const saveBlock = save
    ? `\t# --- Save ---\n\tvar packed = PackedScene.new()\n\tpacked.pack(inst)\n\tvar _full := "${sp}"\n\tvar _ext := _full.get_extension()\n\tvar _tmp := _full + ".tmp." + _ext\n\tif FileAccess.file_exists(_tmp):\n\t\tDirAccess.remove_absolute(_tmp)\n\tvar err := ResourceSaver.save(packed, _tmp)\n\tif err != OK:\n\t\tDirAccess.remove_absolute(_tmp)\n\telse:\n\t\tvar _ren := DirAccess.rename_absolute(_tmp, _full)\n\t\tif _ren != OK:\n\t\t\tDirAccess.remove_absolute(_tmp)\n\t\t\terr = _ren\n\tprint("COMMIT_RESULT: " + JSON.stringify({"success": err == OK, "saved": err == OK, "results": _results}))`
    : `\tprint("COMMIT_RESULT: " + JSON.stringify({"success": true, "saved": false, "results": _results}))`;

  const fillHelper = hasFill
    ? `\nfunc _fill_tiles(node, rx, ry, rw, rh, sid, atlas, alt):\n\tfor cy in range(ry, ry + rh):\n\t\tfor cx in range(rx, rx + rw):\n\t\t\tnode.set_cell(Vector2i(cx, cy), sid, atlas, alt)\n`
    : '';

  const stopBlock = stopOnError
    ? `\n\tif _has_error:\n\t\tprint("COMMIT_RESULT: " + JSON.stringify({"success": false, "saved": false, "error_count": _results.filter(func(r): return not r.ok).size(), "results": _results}))\n\t\tquit()\n\t\treturn`
    : '';

  return `extends SceneTree

var _results = []
var _has_error = false
${fillHelper}
func _initialize():
\tvar scene = load("${sp}")
\tif scene == null:
\t\tprint("COMMIT_RESULT: " + JSON.stringify({"success": false, "saved": false, "error": "Failed to load scene", "results": []}))
\t\tquit()
\t\treturn
\tvar inst = scene.instantiate()
${opBlocks.join('\n')}${stopBlock}
${saveBlock}
\tquit()
`;
}

function generateOpBlock(index: number, op: CommitOperation, stopOnError: boolean): string {
  const idx = index + 1;
  const errAction = stopOnError
    ? '\t\t_has_error = true'
    : '\t\t# continue despite error';

  switch (op.op) {
    case 'tile_set': {
      const alt = op.alternative_tile ?? 0;
      const np = gdEscape(op.node_path);
      return `
\t# --- Op ${idx}: tile_set ---
\tvar n${idx} = inst.get_node_or_null("${np}")
\tif n${idx} == null:
\t\t_results.append({"op": "tile_set", "node_path": "${np}", "ok": false, "error": "Node not found"})
${errAction}
\telse:
\t\tn${idx}.set_cell(Vector2i(${op.coords.x}, ${op.coords.y}), ${op.source_id}, Vector2i(${op.atlas.x}, ${op.atlas.y}), ${alt})
\t\t_results.append({"op": "tile_set", "node_path": "${np}", "ok": true})`;
    }
    case 'tile_fill': {
      const alt = op.alternative_tile ?? 0;
      const cells = op.region.w * op.region.h;
      const np = gdEscape(op.node_path);
      return `
\t# --- Op ${idx}: tile_fill ---
\tvar n${idx} = inst.get_node_or_null("${np}")
\tif n${idx} == null:
\t\t_results.append({"op": "tile_fill", "node_path": "${np}", "ok": false, "error": "Node not found"})
${errAction}
\telse:
\t\t_fill_tiles(n${idx}, ${op.region.x}, ${op.region.y}, ${op.region.w}, ${op.region.h}, ${op.source_id}, Vector2i(${op.atlas.x}, ${op.atlas.y}), ${alt})
\t\t_results.append({"op": "tile_fill", "node_path": "${np}", "ok": true, "cells_affected": ${cells}})`;
    }
    case 'tile_erase': {
      const np = gdEscape(op.node_path);
      return `
\t# --- Op ${idx}: tile_erase ---
\tvar n${idx} = inst.get_node_or_null("${np}")
\tif n${idx} == null:
\t\t_results.append({"op": "tile_erase", "node_path": "${np}", "ok": false, "error": "Node not found"})
${errAction}
\telse:
\t\tn${idx}.set_cell(Vector2i(${op.coords.x}, ${op.coords.y}), -1)
\t\t_results.append({"op": "tile_erase", "node_path": "${np}", "ok": true})`;
    }
    case 'tile_clear': {
      const np = gdEscape(op.node_path);
      return `
\t# --- Op ${idx}: tile_clear ---
\tvar n${idx} = inst.get_node_or_null("${np}")
\tif n${idx} == null:
\t\t_results.append({"op": "tile_clear", "node_path": "${np}", "ok": false, "error": "Node not found"})
${errAction}
\telse:
\t\tn${idx}.clear()
\t\t_results.append({"op": "tile_clear", "node_path": "${np}", "ok": true})`;
    }
    case 'tileset_assign': {
      const np = gdEscape(op.node_path);
      const tsp = gdEscape(op.tileset_path);
      return `
\t# --- Op ${idx}: tileset_assign ---
\tvar n${idx} = inst.get_node_or_null("${np}")
\tif n${idx} == null:
\t\t_results.append({"op": "tileset_assign", "node_path": "${np}", "ok": false, "error": "Node not found"})
${errAction}
\telse:
\t\tn${idx}.tile_set = load("${tsp}")
\t\t_results.append({"op": "tileset_assign", "node_path": "${np}", "ok": true})`;
    }
    case 'node_property': {
      const p = gdEscape(op.path);
      // Imp-1 (2026-06-24 审查): node_property 直接赋值绕过 edit_node 的 S1 拦截(实测持久化)。
      // 命中 BLOCKED_PROPS 返回明确警告,与 edit_node S1 一致(不静默 drop)。
      if (BLOCKED_PROPS.has(op.property)) {
        return `
\t# --- Op ${idx}: node_property ---
\t_results.append({"op": "node_property", "path": "${p}", "property": "${gdEscape(op.property)}", "ok": false, "error": "⚠️ Property '${gdEscape(op.property)}' is blocked (BLOCKED_PROPS security policy). Use edit_node or remove it from the operation."})`;
      }
      if (!isSafeIdentifier(op.property)) {
        return `
\t# --- Op ${idx}: node_property ---
\t_results.append({"op": "node_property", "path": "${p}", "ok": false, "error": "Invalid property name"})`;
      }
      return `
\t# --- Op ${idx}: node_property ---
\tvar n${idx} = inst.get_node_or_null("${p}")
\tif n${idx} == null:
\t\t_results.append({"op": "node_property", "path": "${p}", "ok": false, "error": "Node not found"})
${errAction}
\telse:
\t\tn${idx}.${op.property} = ${serializeGdValue(op.value)}
\t\t_results.append({"op": "node_property", "path": "${p}", "ok": true})`;
    }
    case 'node_add': {
      if (!isSafeIdentifier(op.type)) {
        return `
\t# --- Op ${idx}: node_add ---
\t_results.append({"op": "node_add", "name": "${gdEscape(op.name)}", "ok": false, "error": "Invalid type name"})`;
      }
      if (!ALLOWED_COMMIT_NODE_TYPES.has(op.type)) {  // P2-3: 白名单收尾,阻断非白名单类(含第三方恶意 class_name)实例化
        return `
\t# --- Op ${idx}: node_add ---
\t_results.append({"op": "node_add", "name": "${gdEscape(op.name)}", "ok": false, "error": "Type not in allowlist: ${gdEscape(op.type)} (use add_node tool for special types)"})`;
      }
      const propLines = op.properties
        ? Object.entries(op.properties)
          .filter(([k]) => isSafeIdentifier(k) && !BLOCKED_PROPS.has(k))  // Imp-1: 过滤 BLOCKED_PROPS(script/owner/name 等)防注入;name 由 op.name 单独设(下方 GDScript 先执行),过滤 properties.name 防覆盖
          .map(([k, v]) => `\t\tchild${idx}.${k} = ${serializeGdValue(v)}`)
          .join('\n') + '\n'
        : '';
      // I-5: parent='.' 表示根节点,保留 '.' 让 get_node_or_null('.') 命中根(原代码转空串导致必失败)
      const parentPath = op.parent === '.' ? '.' : gdEscape(op.parent);
      const name = gdEscape(op.name);
      return `
\t# --- Op ${idx}: node_add ---
\tvar child${idx} = ${op.type}.new()
\tchild${idx}.name = "${name}"
${propLines}\tvar parent${idx} = inst.get_node_or_null("${parentPath}")
\tif parent${idx} == null:
\t\t_results.append({"op": "node_add", "name": "${name}", "ok": false, "error": "Parent not found"})
${errAction}
\telse:
\t\tparent${idx}.add_child(child${idx})
\t\tchild${idx}.owner = inst
\t\t_results.append({"op": "node_add", "name": "${name}", "ok": true})`;
    }
  }
}

function serializeGdValue(value: unknown): string {
  // I-03, C-01: Escape backslash, quote, newline for GDScript string safety
  // IMPORTANT-6 (review): 补 \r \t 转义,防控制字符破坏 .gd 字符串/被解析为行结束而注入新行。
  // SEC-P2-6 (2026-08-10): string 分支转义委托 escapeForGdLiteral(与 gdEscape 共享 escapeGdStringCore,
  //   消除两份独立实现的手动同步漂移——原 \r 处理 \r vs \n 已漂移)。
  //   不转义 % 和 '(属性值字面量不参与 % 格式化,转义反而破坏正常 % 字符)。
  if (typeof value === 'string') return `"${escapeForGdLiteral(value)}"`;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null || value === undefined) return 'null';

  // Array support
  if (Array.isArray(value)) {
    const items = value.map(v => serializeGdValue(v)).join(', ');
    return `[${items}]`;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);

    // _type explicit override
    if (obj._type && typeof obj._type === 'string') {
      const t = obj._type;
      if (t === 'Rect2' || t === 'Rect2i') {
        // I-6: 补 typeof number 守卫(与 Color/Vector 分支对齐),非数字字段降级为 0
        const rx = typeof obj.x === 'number' ? obj.x : 0;
        const ry = typeof obj.y === 'number' ? obj.y : 0;
        const rw = typeof obj.w === 'number' ? obj.w : 0;
        const rh = typeof obj.h === 'number' ? obj.h : 0;
        return `${t}(${rx}, ${ry}, ${rw}, ${rh})`;
      }
      if (t === 'Vector3' || t === 'Vector3i') {
        return `${t}(${obj.x ?? 0}, ${obj.y ?? 0}, ${obj.z ?? 0})`;
      }
      if (t === 'Vector2' || t === 'Vector2i') {
        return `${t}(${obj.x ?? 0}, ${obj.y ?? 0})`;
      }
      if (t === 'Color') {
        return `Color(${obj.r ?? 1}, ${obj.g ?? 1}, ${obj.b ?? 1}, ${obj.a ?? 1})`;
      }
      // I-01: Unknown _type intentionally falls through to auto-inference.
      // Users must use a known type or rely on auto-detection.
      // Unknown _type
    }

    // Color: has r, g, b
    if (keys.includes('r') && keys.includes('g') && keys.includes('b')
      && typeof obj.r === 'number' && typeof obj.g === 'number' && typeof obj.b === 'number') {
      const a = typeof obj.a === 'number' ? obj.a : 1;
      return `Color(${obj.r}, ${obj.g}, ${obj.b}, ${a})`;
    }

    // Rect2: has x, y, w, h (I-6: 补 typeof number 守卫,与 Color/Vector 分支对齐)
    if (keys.includes('w') && keys.includes('h') && keys.includes('x') && keys.includes('y') && !keys.includes('z')
      && typeof obj.x === 'number' && typeof obj.y === 'number' && typeof obj.w === 'number' && typeof obj.h === 'number') {
      return `Rect2(${obj.x}, ${obj.y}, ${obj.w}, ${obj.h})`;
    }

    // Vector3: has x, y, z
    if (keys.includes('x') && keys.includes('y') && keys.includes('z')
      && typeof obj.x === 'number' && typeof obj.y === 'number' && typeof obj.z === 'number') {
      return `Vector3(${obj.x}, ${obj.y}, ${obj.z})`;
    }

    // Vector2: has x, y
    if (keys.includes('x') && keys.includes('y')
      && typeof obj.x === 'number' && typeof obj.y === 'number') {
      return `Vector2(${obj.x}, ${obj.y})`;
    }

    // C-02: Strip _type from fallback to avoid leaking meta-field into GDScript
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _type: _ignored, ...sanitized } = obj;
    return JSON.stringify(sanitized);
  }

  return String(value);
}
