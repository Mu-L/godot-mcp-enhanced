// 锚点求解:绝对几何(rect,相对父左上角)→ anchors+offsets。
// 映射依据:Figma constraints(LEFT/RIGHT/CENTER/LEFT_RIGHT/SCALE)与 Godot anchors 同构(spec §3.2)。

export interface Rect { x: number; y: number; w: number; h: number }

export interface AnchorsOffsets {
  anchor_left: number; anchor_right: number; anchor_top: number; anchor_bottom: number;
  offset_left: number; offset_right: number; offset_top: number; offset_bottom: number;
}

/** BoxContainer 等容器父会强制重排子 Control,rect 不适用(spec B-3)。 */
export const CONTAINER_CONTROL_TYPES: readonly string[] = [
  'MarginContainer', 'HBoxContainer', 'VBoxContainer', 'GridContainer',
  'CenterContainer', 'ScrollContainer', 'PanelContainer', 'HSplitContainer',
  'VSplitContainer', 'TabContainer', 'HFlowContainer', 'VFlowContainer',
];

const EPS = 1e-9;

/** 把浮点误差内的 0/0.5/1 吸附到离散锚点(可读性优先,比例兜底,spec 开放问题 2)。 */
function snap(v: number): number {
  if (Math.abs(v) < 1e-6) return 0;
  if (Math.abs(v - 0.5) < 1e-6) return 0.5;
  if (Math.abs(v - 1) < 1e-6) return 1;
  return v;
}

export function solveAnchors(parent: { w: number; h: number }, child: Rect): AnchorsOffsets {
  if (!(parent.w > EPS) || !(parent.h > EPS)) {
    throw new Error(`INVALID_PARAMS: parent size must be positive, got ${parent.w}x${parent.h}`);
  }
  const al = snap(child.x / parent.w);
  const ar = snap((child.x + child.w) / parent.w);
  const at = snap(child.y / parent.h);
  const ab = snap((child.y + child.h) / parent.h);
  return {
    anchor_left: al, anchor_right: ar, anchor_top: at, anchor_bottom: ab,
    offset_left: Math.round(child.x - al * parent.w),
    offset_right: Math.round(child.x + child.w - ar * parent.w),
    offset_top: Math.round(child.y - at * parent.h),
    offset_bottom: Math.round(child.y + child.h - ab * parent.h),
  };
}
