// Value serialization and path sanitization for GDScript code generation.

import { smartCoerce, coerceRect2 } from '../smart-coerce.js';

// GDScript string-literal escaping.
//
// 两个导出入口共享同一份 escapeGdStringCore 转义序列,用途差异仅在 %/' 转义开关:
//   - gdEscape(s):用于运行时模板插值(参与 % 格式化),转义 % → %% 和 ' → \'。
//   - escapeForGdLiteral(s):用于属性值字面量序列化(不参与 % 格式化),不转义 % 和 '。
// 改转义逻辑只需改 escapeGdStringCore 一处,两入口自动同步(SEC-P2-6 消除漂移)。
//
// Note: do NOT apply gdEscape to already-escaped output (e.g. gdEscape(gdEscape(x)))
// as %% would become %%%% (harmless but unnecessary double-escaping).
// Note: \uXXXX sequences are NOT escaped because GDScript does not support \u escapes
// (only \xHH for hex and \UXXXXYYYY for unicode codepoints in StringName).
// Note: $ is NOT escaped because GDScript double-quoted strings don't treat $ as special.
// NodePath syntax like $Player works at the expression level, not inside string literals.

/**
 * Internal core: unified GDScript string-literal escape sequence.
 *
 * 共享转义(无条件):\r\n / \r / LS/PS → \n(统一行结束),\\, \n → \\n, \t → \\t, " → \\", \0 删除。
 * 条件转义:escapePercent 控制 % → %%(GDScript 字符串格式化占位符),escapeQuote 控制 ' → \\'。
 *
 * @param s              原始字符串
 * @param escapePercent  转 % → %%(运行时模板插值场景需要,属性字面量不需要)
 * @param escapeQuote    转 ' → \\'(运行时模板插值场景需要,属性字面量不需要)
 */
function escapeGdStringCore(s: string, escapePercent: boolean, escapeQuote: boolean): string {
  let out = s
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n')  // IMP-2 (2026-06-26 review): LS/PS(U+2028/2029)行分隔符 → \n,防 GDScript 词法视为行结束破坏字符串字面量(scene-commit serializeGdValue 经 escapeForGdLiteral 调同一 core,无需手动同步)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/"/g, '\\"')
    .replace(/\0/g, '');
  if (escapePercent) out = out.replace(/%/g, '%%');
  if (escapeQuote) out = out.replace(/'/g, "\\'");
  return out;
}

/** Escape a string for embedding in a GDScript string literal via runtime template
 *  interpolation (participates in GDScript % formatting). % → %% and ' → \'. */
export function gdEscape(s: string): string {
  return escapeGdStringCore(s, true, true);
}

/** Escape a string for a GDScript property-value literal (does NOT participate in %
 *  formatting, so % and ' are preserved verbatim). Used by scene-commit serializeGdValue.
 *  Shares escapeGdStringCore with gdEscape — change escape logic in one place. */
export function escapeForGdLiteral(s: string): string {
  return escapeGdStringCore(s, false, false);
}

/** Format a number as a Godot-compatible float literal (e.g. 2 → 2.0). */
export const ff = (n: number) => Number.isInteger(n) ? `${n}.0` : `${n}`;

/** Normalize leading spaces to tabs to prevent "Mixed tabs and spaces" errors.
 *  Detects the smallest nonzero leading-space count as the indent unit,
 *  then replaces each group of that many spaces with one tab. */
export function normalizeIndentToTabs(code: string): string {
  const lines = code.split('\n');
  let indentUnit = 0;
  for (const line of lines) {
    const m = line.match(/^( +)\S/);
    if (m) {
      const len = m[1]!.length;
      if (indentUnit === 0 || len < indentUnit) {
        indentUnit = len;
      }
    }
  }
  if (indentUnit === 0) return code;

  return lines.map(line => {
    let leadingSpaces = 0;
    while (leadingSpaces < line.length && line[leadingSpaces] === ' ') {
      leadingSpaces++;
    }
    if (leadingSpaces === 0) return line;
    const tabs = Math.floor(leadingSpaces / indentUnit);
    const remainder = leadingSpaces % indentUnit;
    return '\t'.repeat(tabs) + ' '.repeat(remainder) + line.slice(leadingSpaces);
  }).join('\n');
}

export function normalizeNodePath(input: string): string {
  if (typeof input !== 'string') throw new Error('NodePath is required and must be a string');
  const trimmed = input.trim();
  if (!trimmed) throw new Error('NodePath cannot be empty');
  if (trimmed.startsWith('res://')) throw new Error('NodePath must be a scene tree path (root/...), not a resource path (res://...)');
  return trimmed.startsWith('/') ? trimmed : '/' + trimmed;
}

// Validates a res:// path against traversal attacks, including URL-encoded bypass.
export function sanitizeResPath(raw: unknown, field: string): string {
  if (!raw || typeof raw !== 'string' || !raw.startsWith('res://')) {
    throw new Error(`${field} must be a string starting with res://`);
  }
  // Decode iteratively to defeat double-encoding (%252e%252e%252f etc.)
  let decoded = raw;
  let prev = '';
  let iterations = 0;
  // F-12: 与 path-utils iterativeDecode 上限(20)统一,防护深度一致(5 次不足以解多层编码如 %2525252e)
  while (decoded !== prev && iterations < 20) {
    prev = decoded;
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      throw new Error(`${field} contains invalid encoding: ${raw}`);
    }
    iterations++;
  }
  if (decoded.includes('/../') || decoded.endsWith('/..') || decoded.includes('\\')) {
    throw new Error(`${field} contains path traversal: ${raw}`);
  }
  return decoded;
}

/**
 * Unified GDScript value serializer.
 *
 * Converts a JS value into a GDScript expression string.
 * Used by scene.ts, ui-tools.ts, animation-shared.ts, and animation-ops.ts.
 *
 * Returns a bare GDScript literal / constructor call:
 *   null, true/false, 42, "string", Vector2(1,2), Vector3(1,2,3), Color(1,0,0,1)
 *
 * Throws on unsupported types (objects with unexpected keys, arbitrary arrays, etc.).
 * Throws on NaN / Infinity values.
 *
 * @param v         The value to serialize.
 * @param trackType Optional animation track type hint (e.g. 'rotation_3d' → Quaternion).
 */
export function valueToGd(v: unknown, trackType?: string): string {
  // ── Smart coercion layer (only for objects and strings) ──
  if (typeof v === 'object' && v !== null) {
    const rectResult = coerceRect2(v);
    if (typeof rectResult === 'string') return rectResult;
  }
  if (typeof v === 'string') {
    const coerced = smartCoerce(v);
    if (coerced !== v) {
      if (typeof coerced === 'string') return coerced;
      if (typeof coerced === 'object') return valueToGd(coerced, trackType);
    }
  }

  // ── null / undefined ──
  if (v === null || v === undefined) return 'null';

  // ── boolean ──
  if (typeof v === 'boolean') return v ? 'true' : 'false';

  // ── number (with NaN / Infinity guard) ──
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`Non-finite number not supported: ${v}`);
    return String(v);
  }

  // ── string ──
  if (typeof v === 'string') return `"${gdEscape(v)}"`;

  // ── array → Vector2 / Vector3 / Color ──
  if (Array.isArray(v)) {
    if (v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number') {
      if (!Number.isFinite(v[0]) || !Number.isFinite(v[1])) throw new Error('Non-finite number in array');
      return `Vector2(${v[0]}, ${v[1]})`;
    }
    if (v.length === 3 && typeof v[0] === 'number' && typeof v[1] === 'number' && typeof v[2] === 'number') {
      if (!Number.isFinite(v[0]) || !Number.isFinite(v[1]) || !Number.isFinite(v[2])) throw new Error('Non-finite number in array');
      if (trackType === 'rotation_3d') {
        return `Quaternion.from_euler(Vector3(${v[0]}, ${v[1]}, ${v[2]}))`;
      }
      return `Vector3(${v[0]}, ${v[1]}, ${v[2]})`;
    }
    if (v.length === 4 && v.every(el => typeof el === 'number')) {
      if (!v.every(el => Number.isFinite(el as number))) throw new Error('Non-finite number in array');
      return `Color(${v[0]}, ${v[1]}, ${v[2]}, ${v[3]})`;
    }
    // Longer arrays → JSON array literal (e.g. keyframe points, polygon vertices)
    return `[${v.map(el => valueToGd(el)).join(', ')}]`;
  }

  // ── object → {x,y} / {x,y,z} / {r,g,b,a} ──
  if (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.some(k => !['x', 'y', 'z', 'r', 'g', 'b', 'a'].includes(k))) {
      throw new Error(`Unsupported object keys: ${keys.filter(k => !['x', 'y', 'z', 'r', 'g', 'b', 'a'].includes(k)).join(', ')}. Allowed: {x,y}, {x,y,z}, {r,g,b,a}.`);
    }
    // Vector2 / Vector3
    if (typeof obj.x === 'number' && typeof obj.y === 'number') {
      if (!Number.isFinite(obj.x as number) || !Number.isFinite(obj.y as number)) throw new Error('Non-finite number in object');
      if (typeof obj.z === 'number') {
        if (!Number.isFinite(obj.z as number)) throw new Error('Non-finite number in object');
        return `Vector3(${obj.x}, ${obj.y}, ${obj.z})`;
      }
      return `Vector2(${obj.x}, ${obj.y})`;
    }
    // Color
    if (typeof obj.r === 'number' && typeof obj.g === 'number' && typeof obj.b === 'number') {
      const a = typeof obj.a === 'number' ? obj.a : 1.0;
      if (!Number.isFinite(obj.r as number) || !Number.isFinite(obj.g as number) || !Number.isFinite(obj.b as number) || !Number.isFinite(a as number)) throw new Error('Non-finite number in object');
      return `Color(${obj.r}, ${obj.g}, ${obj.b}, ${a})`;
    }
    throw new Error(`Cannot convert object to GDScript literal: expected {x,y}, {x,y,z}, or {r,g,b,a}`);
  }

  throw new Error(`Cannot convert value to GDScript literal: ${typeof v}`);
}
