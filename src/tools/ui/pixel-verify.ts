// ui_pixel_verify 纯函数层(spec 2026-08-17-prototype-stylebox-loop-design.md §5,PR-3):
// 采样点 clamp 数学 / PNG 像素读取 / RGB 距离判定 / bg 目标收集。
// capture 编排(runPixelVerify)同文件下方,Task 2 落地。
// 颜色语义:输入 bg 经 normalizeColor 归一为 0-1 RGBA,目标色换算 round(c*255) 进 0-255
// 空间与 PNG 采样值直接欧氏距离(Godot 2D canvas 默认不做 linear-sRGB 转换;若集成实测
// 发现系统性偏移,在 Task 4 校准并如实记录,不静默调阈值掩盖)。
import type { Rect } from './anchor-solver.js';
import { normalizeColor } from './prototype-import.js';
import type { PrototypeGeometry } from './prototype-import.js';

/** 采样点标识:中心 + 四角(tl/tr/br/bl)。 */
export type SamplePointId = 'center' | 'tl' | 'tr' | 'br' | 'bl';

export interface SamplePoint { id: SamplePointId; x: number; y: number }

export interface PixelSample {
  id: SamplePointId;
  x: number; y: number;                    // 实际采样坐标(编排层可能已按 PNG/viewport 比例缩放)
  rgb: [number, number, number] | null;    // 0-255;越界/读不到 → null
  distance: number | null;                 // 与 target 的 0-255 欧氏距离;rgb null 时 null
  ok: boolean;
}

export interface NodePixelResult {
  name: string;
  rect: Rect;                              // 输入视口 rect(采样基准)
  target: [number, number, number];        // 0-255
  samples: PixelSample[];
  ok: boolean;                             // 全采样点过
}

export interface BgTarget {
  name: string;
  rect: Rect;
  target: [number, number, number];
  borderRadius: number;                    // per-corner 对象已取 max
  borderWidth: number;
}

/** 判定容差(0-255 欧氏距离):中心严格、角点宽松(spec §5,阈值 §10.2 集成校准)。 */
export const CENTER_TOL = 20;
export const CORNER_TOL = 60;

/**
 * 中心 + 四角内缩采样点(spec §5)。内缩量 clamp:min(borderRadius + borderWidth,
 * 短边/2 − 2)——防 borderRadius > 短边一半时角点越界;短边 < 4 时下限回落 0
 * (角点=rect 角,仍在图内,由 pixelAt 越界 null 兜底)。中心点不内缩(圆角矩形
 * 中心必在填充区内)。坐标 floor 到整数像素格(0-indexed:奇数尺寸中心取左中像素,
 * 如 w=101 → 50;Math.round 对 half 值向上取整得 51/31,与测试断言 50/30 冲突,
 * 以断言为准裁定 floor,整数输入下两者等价)。
 */
export function computeSamplePoints(rect: Rect, borderRadius: number, borderWidth: number): SamplePoint[] {
  const minSide = Math.min(rect.w, rect.h);
  const inset = Math.max(0, Math.min(borderRadius + borderWidth, minSide / 2 - 2));
  const cx = Math.floor(rect.x + rect.w / 2);
  const cy = Math.floor(rect.y + rect.h / 2);
  return [
    { id: 'center', x: cx, y: cy },
    { id: 'tl', x: Math.floor(rect.x + inset), y: Math.floor(rect.y + inset) },
    { id: 'tr', x: Math.floor(rect.x + rect.w - inset), y: Math.floor(rect.y + inset) },
    { id: 'br', x: Math.floor(rect.x + rect.w - inset), y: Math.floor(rect.y + rect.h - inset) },
    { id: 'bl', x: Math.floor(rect.x + inset), y: Math.floor(rect.y + rect.h - inset) },
  ];
}

/** 读 PNG(解码后 {width,height,data:RGBA Buffer})指定像素 RGB;越界返回 null。 */
export function pixelAt(png: { width: number; height: number; data: Buffer }, x: number, y: number): [number, number, number] | null {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return null;
  const idx = (y * png.width + x) * 4;
  return [png.data[idx]!, png.data[idx + 1]!, png.data[idx + 2]!];
}

/** 0-255 空间 RGB 欧氏距离。 */
export function rgbDistance(a: [number, number, number], b: [number, number, number]): number {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * 收集采样目标:输入 geometry 中带 bg 的节点(spec §5「每 bg 节点」;fill-only 不进——
 * fill 槽语义属 ProgressBar 内部渲染,非本工具首版范围)。半透明 bg(alpha < 0.999)
 * skipped:合成后采样色 ≠ bg_color,像素直判不可用——诚实跳过不伪装判定。
 * per-corner borderRadius 对象取四角 max(保守内缩)。
 * 注意:未映射控件(如 LineEdit 带 bg,规则 12)的 bg 被翻译层忽略、渲染无该色——
 * 本函数仍收集之,采样预期红;这与 build_warnings 的「样式丢失」警告互为印证,是诚实
 * 信号不是误报(实现期若发现高频误报噪声,可升级为按 styleboxSlotFor skip+reason,
 * 须同步单测)。
 */
export function collectBgTargets(geo: PrototypeGeometry): { targets: BgTarget[]; skipped: Array<{ name: string; reason: string }> } {
  const targets: BgTarget[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  for (const nd of geo.nodes) {
    if (nd.bg === undefined) continue;
    const rgba = normalizeColor(nd.bg, 'bg', nd.name);
    if (rgba[3] < 0.999) {
      skipped.push({ name: nd.name, reason: `bg alpha=${rgba[3]}(半透明):与底层合成后采样色≠bg_color,像素直判不可用` });
      continue;
    }
    const r = typeof nd.borderRadius === 'number' ? nd.borderRadius
      : Math.max(nd.borderRadius?.tl ?? 0, nd.borderRadius?.tr ?? 0, nd.borderRadius?.br ?? 0, nd.borderRadius?.bl ?? 0);
    targets.push({
      name: nd.name,
      rect: nd.rect,
      target: [Math.round(rgba[0] * 255), Math.round(rgba[1] * 255), Math.round(rgba[2] * 255)],
      borderRadius: r,
      borderWidth: nd.border?.width ?? 0,
    });
  }
  return { targets, skipped };
}

/**
 * 逐点判定组装 NodePixelResult。points/samples 由编排层成对给出(samples 的 rgb 已
 * 含越界 null);中心点用 CENTER_TOL、角点用 CORNER_TOL;rgb null(越界/读不到)
 * 记 ok:false + distance:null——越界采样点是问题不是噪声,必须红。
 */
export function judgeNode(
  name: string, rect: Rect, target: [number, number, number],
  points: SamplePoint[], samples: Array<{ x: number; y: number; rgb: [number, number, number] | null }>,
): NodePixelResult {
  const out: PixelSample[] = points.map((p, i) => {
    const s = samples[i]!;
    const distance = s.rgb === null ? null : rgbDistance(s.rgb, target);
    const tol = p.id === 'center' ? CENTER_TOL : CORNER_TOL;
    return { id: p.id, x: s.x, y: s.y, rgb: s.rgb, distance, ok: distance !== null && distance <= tol };
  });
  return { name, rect, target, samples: out, ok: out.every(s => s.ok) };
}
