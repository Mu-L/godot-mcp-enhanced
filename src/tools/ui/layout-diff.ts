// 布局对比:measure 结果 vs 目标 spec(rect)的逐节点 diff + 重叠/越界检测。
// Pascal verify_scene 模式(spec §3.1/§4):结构化问题清单,数字驱动收敛。
// 路径同构约定:ui_measure_layout 不带 node_path 时 path 为 get_path_to 名称链
// ('P' / 'P/A',不含场景根名),expect_tree 传 ui_build_layout 的同一棵树(挂场景
// 根下)时 flattenTargets 计根名,两者恰好逐一对齐。
// C1 坐标语义:target.rect 相对父左上角(与生成侧一致);diff 的 actual 换算为
// 父相对坐标(子 global − 父 global),根级 target 以视口原点为参照。

import type { UiNodeSpec } from './types.js';
import type { Rect } from './anchor-solver.js';

export interface MeasuredNode {
  path: string;
  type: string;
  rect: Rect;
  anchors?: Record<string, number>;
  offsets?: Record<string, number>;
  visible?: boolean;
  text?: string;
}

export interface DiffEntry {
  path: string;
  target: Rect | null;
  actual: Rect | null;
  delta: { dx: number; dy: number; dw: number; dh: number };
  ok: boolean;
}

export function flattenTargets(tree: UiNodeSpec, prefix?: string): Array<{ path: string; rect: Rect }> {
  const selfPath = prefix ? `${prefix}/${tree.name}` : tree.name;
  const out: Array<{ path: string; rect: Rect }> = [];
  if (tree.rect) out.push({ path: selfPath, rect: tree.rect });
  for (const c of tree.children ?? []) out.push(...flattenTargets(c, selfPath));
  return out;
}

export function diffLayout(
  measured: MeasuredNode[],
  targets: Array<{ path: string; rect: Rect }>,
  tolerancePx = 2,
): DiffEntry[] {
  const byPath = new Map(measured.map(m => [m.path, m]));
  return targets.map(t => {
    const m = byPath.get(t.path);
    if (!m) {
      return { path: t.path, target: t.rect, actual: null,
        delta: { dx: NaN, dy: NaN, dw: NaN, dh: NaN }, ok: false };
    }
    // C1: target 语义 = 相对父左上角(与生成侧 uiNodeToGd 一致),actual 换算为同构的父相对坐标:
    //   子 global − 父 global(父 = path 去最后一段,从 measure 输出查);
    //   根级 target(无父段,即树根自身 rect)以视口原点为参照——树挂场景根下,根 global 即视口系;
    //   父不在测量集(中间节点未渲染/不可见)→ NaN 缺失语义,不 ok。
    const parentPath = parentOf(t.path);
    const parent = parentPath === '' ? null : byPath.get(parentPath);
    if (parentPath !== '' && !parent) {
      return { path: t.path, target: t.rect, actual: null,
        delta: { dx: NaN, dy: NaN, dw: NaN, dh: NaN }, ok: false };
    }
    const ax = m.rect.x - (parent ? parent.rect.x : 0);
    const ay = m.rect.y - (parent ? parent.rect.y : 0);
    const dx = ax - t.rect.x, dy = ay - t.rect.y;
    const dw = m.rect.w - t.rect.w, dh = m.rect.h - t.rect.h;
    const ok = Math.abs(dx) <= tolerancePx && Math.abs(dy) <= tolerancePx
      && Math.abs(dw) <= tolerancePx && Math.abs(dh) <= tolerancePx;
    return { path: t.path, target: t.rect, actual: { x: ax, y: ay, w: m.rect.w, h: m.rect.h },
      delta: { dx, dy, dw, dh }, ok };
  });
}

function parentOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w), bo = Math.min(a.y + a.h, b.y + b.h);
  if (r <= x || bo <= y) return null;
  return { x, y, w: r - x, h: bo - y };
}

export function detectOverlaps(measured: MeasuredNode[]): Array<{ a: string; b: string; overlap: Rect }> {
  const groups = new Map<string, MeasuredNode[]>();
  for (const m of measured) {
    // measure 目标根的 path 为 "."(get_path_to 相对路径 artifact):父包子的正常
    // 包含不是兄弟重叠,且它会与一级子同落 parent='' 组 → 排除,防误报。
    if (m.path === '.') continue;
    const p = parentOf(m.path);
    const arr = groups.get(p);
    if (arr) arr.push(m); else groups.set(p, [m]);
  }
  const out: Array<{ a: string; b: string; overlap: Rect }> = [];
  for (const siblings of groups.values()) {
    for (let i = 0; i < siblings.length; i++) {
      for (let j = i + 1; j < siblings.length; j++) {
        const ov = intersect(siblings[i]!.rect, siblings[j]!.rect);
        if (ov && ov.w > 1 && ov.h > 1) {
          out.push({ a: siblings[i]!.path, b: siblings[j]!.path, overlap: ov });
        }
      }
    }
  }
  return out;
}

export function detectOutOfBounds(measured: MeasuredNode[]): Array<{ path: string; parent: string; overflow: Rect }> {
  const byPath = new Map(measured.map(m => [m.path, m]));
  const out: Array<{ path: string; parent: string; overflow: Rect }> = [];
  for (const m of measured) {
    const p = parentOf(m.path);
    if (!p) continue; // 根节点(含 measure 目标根 ".")无父
    const parent = byPath.get(p);
    if (!parent) continue; // 父不在测量集(如一级子的父是场景根 ".")时无法判定,跳过
    const right = (m.rect.x + m.rect.w) - (parent.rect.x + parent.rect.w);
    const bottom = (m.rect.y + m.rect.h) - (parent.rect.y + parent.rect.h);
    const left = parent.rect.x - m.rect.x;
    const top = parent.rect.y - m.rect.y;
    if (right > 1 || bottom > 1 || left > 1 || top > 1) {
      out.push({ path: m.path, parent: p,
        overflow: { x: Math.max(0, left), y: Math.max(0, top), w: Math.max(0, right), h: Math.max(0, bottom) } });
    }
  }
  return out;
}
