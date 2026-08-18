# 原型翻译层 PR-3(ui_pixel_verify 像素采样验证)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ui 工具族新增 `ui_pixel_verify` action——对已构建场景窗口模式截图,对每个 bg 节点采样中心+四角内缩点,与目标色 RGB 欧氏距离判定,给出逐节点逐采样点结果(终验;spec §5)。

**Architecture:** 新文件 `src/tools/ui/pixel-verify.ts` 承载纯函数(采样点 clamp 数学 / PNG 像素读取 / 距离判定 / bg 目标收集)+ 编排(`runPixelVerify`:captureScreenshot 复用 → pngjs 解码 → 采样 → try/finally 清理 PNG)。`src/tools/ui/index.ts` 加 case(ACTIONS + TOOL_META `'write'` + schema/描述),`src/core/module-loader.ts` SLIM descHint 同步。集成测试沿 `test/integration/ui-import-integration.test.ts` 的 Windows-only skip 先例。本批连带 PR-2 遗留顺手项 T5a(M-1 句末措辞 4 处)+ T5c(孙层措辞 + 七槽白名单双份硬编码注释),涉及规则双副本 → 强制 version bump + STRICT rules-sync。

**Tech Stack:** TypeScript(ES2022/strict/ESM,import 带 `.js`)+ pngjs ^7(已在依赖,`PNG.sync.read/write`)+ Vitest + GDScript(仅复用既有 `src/scripts/screenshot_capture.gd`,本批不改 .gd)。

**Spec:** `docs/superpowers/specs/2026-08-17-prototype-stylebox-loop-design.md` §5(验收标准 3)、§7(ui_pixel_verify 测试行)、§8(改动面 PR-3 行)、§10.2(容差开放问题——集成校准)。

## Global Constraints

- 分支 `feat/prototype-stylebox-pr3`,从 master(a79b65b)开;基线版本 0.32.1。
- 简体中文回复;文件引用绝对路径;commit 用 Conventional Commits(type 英文前缀,subject 可中文)。
- 每任务完成即 commit;禁 `any`(ESLint error);import 一律带 `.js` 扩展名;TS 2 空格缩进。
- 规则双副本(`.claude/rules/godot-mcp-ui.md` ↔ `src/tools/rule-templates.ts` 对应段)**逐字同步**(归一化仅抹版本行),本批 Task 5 改双副本 → 必须跑 `npm version patch --no-git-tag-version` + `npm run version-sync` + `npm run build` + `STRICT=1 npm run check:rules-sync`。
- 最终版本号:**0.32.2**(patch;双副本变更强制 bump,spec §9)。
- 门禁(收尾全跑):`npm run lint` → `npm run build` → `npm test` → `npm run build-matrix` + `npm run diff-matrix`(no drift)→ `npm run check:budget` → `STRICT=1 npm run check:rules-sync` → `npm run version-check`(0.32.2)。
- `src/screenshot.ts`、`src/scripts/screenshot_capture.gd` **只复用不改动**(PR-4 才动渲染链)。
- 渲染前提(实测既知):Windows headless=dummy renderer 截图空白 → captureScreenshot 平台逻辑自动走窗口模式(会弹窗,文档化);Linux headless 2D CanvasItem 必空白 → `getBlankHint` 检测报错 + 集成测试 Windows-only skip。
- **设计偏离声明(spec §5「translate 得期望」)**:采样期望落地为**输入 geometry 直读**——节点 rect 与 bg 直取自输入(`normalizeColor` 归一),不调 `translateGeometry`。理由:bg 的翻译目标 `StyleBoxFlatSpec.bg_color` 值就是归一后 bg,与树内期望同源等价;输入直读避免依赖翻译器内部控件推断(text+interactive→Button 等),且 flow 直接子节点的 rect 只存在于输入(flow_expect)与输入本身。未映射控件 bg(规则 12)采样预期红,与 build_warnings 互为印证(Task 1 collectBgTargets 注释)。

---

### Task 1: 像素采样纯函数层(`pixel-verify.ts` 采样/判定/目标收集)

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\ui\prototype-import.ts:217`(`normalizeColor` 加 `export`)
- Create: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\ui\pixel-verify.ts`
- Test: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\pixel-verify.test.ts`

**Interfaces:**
- Consumes: `Rect`(from `./anchor-solver.js`,`{x,y,w,h}`)、`PrototypeGeometry`/`GeometryNode`(from `./prototype-import.js`)、`normalizeColor(c: string | number[], field: string, name: string): [number, number, number, number]`(0-1 RGBA,本任务导出)。
- Produces(Task 2/3 依赖,签名精确):
  - `export type SamplePointId = 'center' | 'tl' | 'tr' | 'br' | 'bl'`
  - `export interface SamplePoint { id: SamplePointId; x: number; y: number }`
  - `export interface PixelSample { id: SamplePointId; x: number; y: number; rgb: [number, number, number] | null; distance: number | null; ok: boolean }`
  - `export interface NodePixelResult { name: string; rect: Rect; target: [number, number, number]; samples: PixelSample[]; ok: boolean }`
  - `export interface BgTarget { name: string; rect: Rect; target: [number, number, number]; borderRadius: number; borderWidth: number }`
  - `export const CENTER_TOL = 20; export const CORNER_TOL = 60;`(0-255 欧氏距离;Task 4 集成校准,初值依据:纯色底噪 ~个位数、圆角/边框抗锯齿角点可达 ~40-50)
  - `export function computeSamplePoints(rect: Rect, borderRadius: number, borderWidth: number): SamplePoint[]`
  - `export function pixelAt(png: { width: number; height: number; data: Buffer }, x: number, y: number): [number, number, number] | null`
  - `export function rgbDistance(a: [number, number, number], b: [number, number, number]): number`
  - `export function collectBgTargets(geo: PrototypeGeometry): { targets: BgTarget[]; skipped: Array<{ name: string; reason: string }> }`
  - `export function judgeNode(name: string, rect: Rect, target: [number,number,number], points: SamplePoint[], samples: Array<{ x: number; y: number; rgb: [number,number,number] | null }>): NodePixelResult`(距离+容差判定,越界/rgb null → ok:false distance:null)

- [ ] **Step 1: 写失败测试(先于实现)**

创建 `test/pixel-verify.test.ts`:

```ts
// pixel-verify 纯函数单测(spec 2026-08-17-prototype-stylebox-loop-design.md §5,PR-3 Task 1):
// 采样点 clamp 数学 / PNG 像素读取(构造 PNG 精确断言)/ RGB 距离 / bg 目标收集(半透明 skip)。
// 不含 capture 编排(Task 2)与 handler 接线(Task 3)。
import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import {
  computeSamplePoints, pixelAt, rgbDistance, collectBgTargets,
  CENTER_TOL, CORNER_TOL,
} from '../src/tools/ui/pixel-verify.js';
import type { PrototypeGeometry } from '../src/tools/ui/prototype-import.js';

describe('computeSamplePoints(spec §5 内缩 clamp)', () => {
  // rect 100x60 @(10,20),radius 8 + border 2 → inset=min(10, 60/2-2=28)=10
  it('常规:borderRadius+border 宽度决定内缩', () => {
    const pts = computeSamplePoints({ x: 10, y: 20, w: 100, h: 60 }, 8, 2);
    expect(pts).toHaveLength(5);
    const by = Object.fromEntries(pts.map(p => [p.id, p]));
    expect(by.center).toEqual({ id: 'center', x: 60, y: 50 });
    expect(by.tl).toEqual({ id: 'tl', x: 20, y: 30 });
    expect(by.tr).toEqual({ id: 'tr', x: 100, y: 30 });
    expect(by.br).toEqual({ id: 'br', x: 100, y: 70 });
    expect(by.bl).toEqual({ id: 'bl', x: 20, y: 70 });
  });

  it('clamp 上界:borderRadius 超过短边一半时被 短边/2−2 钳制', () => {
    // rect 40x20,radius 30 → min(30, 20/2-2=8)=8;角点仍 rect 内
    const pts = computeSamplePoints({ x: 0, y: 0, w: 40, h: 20 }, 30, 0);
    const by = Object.fromEntries(pts.map(p => [p.id, p]));
    expect(by.tl).toEqual({ id: 'tl', x: 8, y: 8 });
    expect(by.br).toEqual({ id: 'br', x: 32, y: 12 });
  });

  it('clamp 下界:短边 <4 时 短边/2−2 为负,回落 0(角点=角,仍在图内)', () => {
    const pts = computeSamplePoints({ x: 5, y: 5, w: 3, h: 2 }, 0, 0);
    const by = Object.fromEntries(pts.map(p => [p.id, p]));
    expect(by.tl).toEqual({ id: 'tl', x: 5, y: 5 });
    expect(by.br).toEqual({ id: 'br', x: 8, y: 7 });
  });

  it('坐标 round 到整数(奇数宽高中心)', () => {
    const pts = computeSamplePoints({ x: 0, y: 0, w: 101, h: 61 }, 0, 0);
    expect(pts.find(p => p.id === 'center')).toEqual({ id: 'center', x: 50, y: 30 });
  });
});

describe('pixelAt(构造 PNG 精确读值)', () => {
  function solidPng(w: number, h: number, rgb: [number, number, number]): PNG {
    const png = new PNG({ width: w, height: h });
    for (let i = 0; i < w * h; i++) {
      png.data[i * 4] = rgb[0]; png.data[i * 4 + 1] = rgb[1];
      png.data[i * 4 + 2] = rgb[2]; png.data[i * 4 + 3] = 255;
    }
    return png;
  }

  it('读回构造色值(红底)', () => {
    const png = solidPng(4, 4, [255, 0, 0]);
    expect(pixelAt(png, 0, 0)).toEqual([255, 0, 0]);
    expect(pixelAt(png, 3, 3)).toEqual([255, 0, 0]);
  });

  it('越界返回 null(x/y 负、≥尺寸)', () => {
    const png = solidPng(4, 4, [0, 0, 255]);
    expect(pixelAt(png, -1, 0)).toBeNull();
    expect(pixelAt(png, 0, -1)).toBeNull();
    expect(pixelAt(png, 4, 0)).toBeNull();
    expect(pixelAt(png, 0, 4)).toBeNull();
  });
});

describe('rgbDistance', () => {
  it('0-255 空间欧氏距离', () => {
    expect(rgbDistance([0, 0, 0], [0, 0, 0])).toBe(0);
    expect(rgbDistance([255, 0, 0], [0, 0, 0])).toBeCloseTo(255, 5);
    expect(rgbDistance([255, 255, 0], [0, 0, 0])).toBeCloseTo(Math.sqrt(2) * 255, 5);
  });
});

describe('collectBgTargets(spec §5 「每 bg 节点」)', () => {
  const geo: PrototypeGeometry = {
    viewport: { w: 800, h: 600 },
    nodes: [
      { name: 'Card', rect: { x: 0, y: 0, w: 200, h: 80 }, bg: '#1a1f2e', borderRadius: 8, border: { width: 2, color: '#3ddc84' } },
      { name: 'HpBar', rect: { x: 10, y: 90, w: 120, h: 16 }, bg: '#222222' },
      { name: 'Plain', rect: { x: 10, y: 120, w: 50, h: 20 } },                        // 无 bg → 不采样
      { name: 'Ghost', rect: { x: 10, y: 150, w: 50, h: 20 }, bg: [10, 20, 30, 0.5] }, // 半透明 → skipped
      { name: 'Corners', rect: { x: 10, y: 180, w: 60, h: 60 }, bg: '#ff0000', borderRadius: { tl: 4, tr: 6, br: 10, bl: 2 } },
    ],
  };

  it('收集 bg 节点,hex 目标转 0-255,fill-only 不进(仅 bg 语义)', () => {
    const { targets, skipped } = collectBgTargets(geo);
    expect(targets.map(t => t.name)).toEqual(['Card', 'HpBar', 'Corners']);
    expect(targets[0]!.target).toEqual([0x1a, 0x1f, 0x2e]);
    expect(targets[0]!.borderRadius).toBe(8);
    expect(targets[0]!.borderWidth).toBe(2);
    expect(targets[1]!.borderWidth).toBe(0);
    expect(skipped).toEqual([{ name: 'Ghost', reason: expect.stringContaining('alpha') }]);
  });

  it('per-corner borderRadius 取四角 max(保守内缩)', () => {
    const { targets } = collectBgTargets(geo);
    expect(targets.find(t => t.name === 'Corners')!.borderRadius).toBe(10);
  });

  it('数组色 [r,g,b] 0-255 与 [r,g,b,a] 0-1 两种 ProtoColor 格式都归一', () => {
    const g2: PrototypeGeometry = {
      viewport: { w: 100, h: 100 },
      nodes: [
        { name: 'A', rect: { x: 0, y: 0, w: 10, h: 10 }, bg: [26, 31, 46] },
        { name: 'B', rect: { x: 0, y: 20, w: 10, h: 10 }, bg: [0.1, 0.2, 1.0, 1.0] },
      ],
    };
    const { targets } = collectBgTargets(g2);
    expect(targets[0]!.target).toEqual([26, 31, 46]);
    expect(targets[1]!.target).toEqual([26, 51, 255]);
  });
});

describe('容差常量(Task 4 集成校准锚点)', () => {
  it('中心严格、角点宽松(spec §5)', () => {
    expect(CENTER_TOL).toBeLessThan(CORNER_TOL);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/pixel-verify.test.ts`
Expected: FAIL——`Cannot find module '../src/tools/ui/pixel-verify.js'`(模块不存在)。

- [ ] **Step 3: 导出 normalizeColor + 写实现**

3a. `src/tools/ui/prototype-import.ts:217` 行首加 `export`:

```ts
export function normalizeColor(c: string | number[], field: string, name: string): [number, number, number, number] {
```

(函数体不动;仅加导出。)

3b. 创建 `src/tools/ui/pixel-verify.ts`:

```ts
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
 * 中心必在填充区内)。坐标 round 到整数(PNG 像素格)。
 */
export function computeSamplePoints(rect: Rect, borderRadius: number, borderWidth: number): SamplePoint[] {
  const minSide = Math.min(rect.w, rect.h);
  const inset = Math.max(0, Math.min(borderRadius + borderWidth, minSide / 2 - 2));
  const cx = Math.round(rect.x + rect.w / 2);
  const cy = Math.round(rect.y + rect.h / 2);
  return [
    { id: 'center', x: cx, y: cy },
    { id: 'tl', x: Math.round(rect.x + inset), y: Math.round(rect.y + inset) },
    { id: 'tr', x: Math.round(rect.x + rect.w - inset), y: Math.round(rect.y + inset) },
    { id: 'br', x: Math.round(rect.x + rect.w - inset), y: Math.round(rect.y + rect.h - inset) },
    { id: 'bl', x: Math.round(rect.x + inset), y: Math.round(rect.y + rect.h - inset) },
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/pixel-verify.test.ts`
Expected: PASS 全绿(14 用例)。

- [ ] **Step 5: 跑 lint + build 快检**

Run: `npm run lint && npm run build`
Expected: 两项 0 错误。

- [ ] **Step 6: Commit**

```bash
git add src/tools/ui/pixel-verify.ts src/tools/ui/prototype-import.ts test/pixel-verify.test.ts
git commit -m "feat(ui): ui_pixel_verify 纯函数层——采样点 clamp/像素读取/bg 目标收集"
```

---

### Task 2: capture 编排(`runPixelVerify`:截图→解码→采样→清理)

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\ui\pixel-verify.ts`(追加编排段)
- Test: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\pixel-verify.test.ts`(追加 describe)

**Interfaces:**
- Consumes: Task 1 全部导出;`captureScreenshot`/`getBlankHint`(from `../../screenshot.js`,**不改动该文件**);`PNG`(pngjs)。
- Produces(Task 3 依赖):
  - `export interface PixelVerifySummary { nodes: NodePixelResult[]; pass: number; fail: number; skipped: Array<{ name: string; reason: string }>; viewport: { w: number; h: number }; image: { width: number; height: number; scaled: boolean; cleaned_up: boolean }; tolerances: { center: number; corner: number }; note: string }`
  - `export async function runPixelVerify(params: { godotPath: string; projectPath: string; scenePath: string; geo: PrototypeGeometry }): Promise<{ ok: true; summary: PixelVerifySummary } | { ok: false; error: string; hint?: string }>`
  - `export function toResPath(projectPath: string, absPath: string): string`(绝对路径 → `res://` 形式;同盘内 `path.relative`,反斜杠转 `/`)

- [ ] **Step 1: 写失败测试(mock captureScreenshot + 真临时 PNG 文件)**

在 `test/pixel-verify.test.ts` 追加(顶部补 import):

```ts
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import { runPixelVerify, toResPath } from '../src/tools/ui/pixel-verify.js';
import { captureScreenshot, getBlankHint } from '../src/screenshot.js';
import type { ToolContext } from '../src/types.js';

vi.mock('../src/screenshot.js', () => ({
  captureScreenshot: vi.fn(),
  getBlankHint: vi.fn().mockReturnValue(''),
}));

const captureMock = vi.mocked(captureScreenshot);
const blankHintMock = vi.mocked(getBlankHint);

describe('toResPath', () => {
  it('项目内绝对路径 → res:// 相对形式(反斜杠转正斜杠)', () => {
    expect(toResPath('D:/proj', 'D:/proj/scenes/main.tscn')).toBe('res://scenes/main.tscn');
    expect(toResPath('D:\\proj', 'D:\\proj\\scenes\\main.tscn')).toBe('res://scenes/main.tscn');
  });
});

describe('runPixelVerify 编排(mock capture)', () => {
  let dir: string;

  /** 构造整图纯色 PNG 落盘,并让 mock captureScreenshot 返回成功(产出该文件)。 */
  function stubCaptureWithSolidPng(rgb: [number, number, number], w = 800, h = 600): void {
    captureMock.mockImplementation(async (opts) => {
      const png = new PNG({ width: w, height: h });
      for (let i = 0; i < w * h; i++) {
        png.data[i * 4] = rgb[0]; png.data[i * 4 + 1] = rgb[1];
        png.data[i * 4 + 2] = rgb[2]; png.data[i * 4 + 3] = 255;
      }
      writeFileSync(opts.outputPath, PNG.sync.write(png));
      return { success: true, imagePath: opts.outputPath, width: w, height: h };
    });
  }

  const geo: PrototypeGeometry = {
    viewport: { w: 800, h: 600 },
    nodes: [
      { name: 'Card', rect: { x: 100, y: 100, w: 200, h: 80 }, bg: '#1a1f2e' },
      { name: 'Accent', rect: { x: 100, y: 200, w: 200, h: 40 }, bg: '#3ddc84' },
    ],
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pixel-verify-ut-'));
    captureMock.mockReset();
    blankHintMock.mockReturnValue('');
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('同图全绿:PNG 与目标同色 → 全节点 ok + PNG 已清理(cleaned_up)', async () => {
    // 两节点同目标色 #1a1f2e,整图渲染该色 → 采样全绿路径
    const g2: PrototypeGeometry = {
      viewport: { w: 800, h: 600 },
      nodes: [
        { name: 'Card', rect: { x: 100, y: 100, w: 200, h: 80 }, bg: '#1a1f2e' },
        { name: 'Accent', rect: { x: 100, y: 200, w: 200, h: 40 }, bg: '#1a1f2e' },
      ],
    };
    stubCaptureWithSolidPng([0x1a, 0x1f, 0x2e]);
    const r = await runPixelVerify({ godotPath: 'godot', projectPath: dir, scenePath: join(dir, 'main.tscn'), geo: g2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary.pass).toBe(2);
    expect(r.summary.fail).toBe(0);
    expect(r.summary.nodes.every(n => n.ok)).toBe(true);
    expect(r.summary.image.cleaned_up).toBe(true);
    expect(existsSync(join(dir, '.godot', 'mcp_pixel_verify.png'))).toBe(false);
  });

  it('构造差异精确计数:整图 Accent 色 → Card 红(5 采样点)/Accent 绿,pass=1 fail=1', async () => {
    stubCaptureWithSolidPng([0x3d, 0xdc, 0x84]);
    const r = await runPixelVerify({ godotPath: 'godot', projectPath: dir, scenePath: join(dir, 'main.tscn'), geo });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary.pass).toBe(1);
    expect(r.summary.fail).toBe(1);
    const card = r.summary.nodes.find(n => n.name === 'Card')!;
    expect(card.ok).toBe(false);
    expect(card.samples).toHaveLength(5);
    expect(card.samples.every(s => !s.ok)).toBe(true);
    expect(card.samples.every(s => s.distance !== null && s.distance > 60)).toBe(true);
  });

  it('capture 失败 → ok:false 透传错误', async () => {
    captureMock.mockResolvedValue({ success: false, error: 'Screenshot failed (windowed mode). Godot exited with code 1.' });
    const r = await runPixelVerify({ godotPath: 'godot', projectPath: dir, scenePath: join(dir, 'main.tscn'), geo });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('Screenshot failed');
    // 失败路径也不留 PNG
    expect(existsSync(join(dir, '.godot', 'mcp_pixel_verify.png'))).toBe(false);
  });

  it('BLANK_DETECTED → ok:false 且附 hint(Linux headless 空白防线)', async () => {
    blankHintMock.mockReturnValue('2D CanvasItem content cannot render in headless mode.');
    try {
      stubCaptureWithSolidPng([0, 0, 0]);
      const r = await runPixelVerify({ godotPath: 'godot', projectPath: dir, scenePath: join(dir, 'main.tscn'), geo });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error).toContain('空白');
      expect(r.hint).toContain('headless');
    } finally {
      blankHintMock.mockReturnValue('');
    }
  });

  it('PNG 尺寸≠viewport → 线性缩放采样坐标 + image.scaled=true', async () => {
    // viewport 800x600,PNG 实际 400x300(半分辨率)→ 采样点同比例缩放,同色仍全绿
    stubCaptureWithSolidPng([0x1a, 0x1f, 0x2e], 400, 300);
    const r = await runPixelVerify({ godotPath: 'godot', projectPath: dir, scenePath: join(dir, 'main.tscn'), geo: {
      viewport: { w: 800, h: 600 },
      nodes: [{ name: 'Card', rect: { x: 100, y: 100, w: 200, h: 80 }, bg: '#1a1f2e' }],
    } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary.image.scaled).toBe(true);
    expect(r.summary.image.width).toBe(400);
    expect(r.summary.nodes[0]!.ok).toBe(true);
    expect(r.summary.nodes[0]!.samples.find(s => s.id === 'tl')).toMatchObject({ x: 50, y: 50 });
  });

  it('无 bg 节点 → 空结果 + note 声明(不是错误)', async () => {
    stubCaptureWithSolidPng([0, 0, 0]);
    const r = await runPixelVerify({ godotPath: 'godot', projectPath: dir, scenePath: join(dir, 'main.tscn'), geo: {
      viewport: { w: 800, h: 600 }, nodes: [{ name: 'Plain', rect: { x: 0, y: 0, w: 10, h: 10 } }],
    } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary.nodes).toHaveLength(0);
    expect(r.summary.note).toContain('无 bg 节点');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/pixel-verify.test.ts`
Expected: 新增 describe FAIL——`runPixelVerify`/`toResPath` 未导出。

- [ ] **Step 3: 实现编排段**

在 `src/tools/ui/pixel-verify.ts` 追加(顶部补 import):

```ts
import { readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PNG } from 'pngjs';
import { captureScreenshot, getBlankHint } from '../../screenshot.js';
```

```ts
// ─── capture 编排(Task 2)──────────────────────────────────────────────────

export interface PixelVerifySummary {
  nodes: NodePixelResult[];
  pass: number;
  fail: number;
  skipped: Array<{ name: string; reason: string }>;
  viewport: { w: number; h: number };
  image: { width: number; height: number; scaled: boolean; cleaned_up: boolean };
  tolerances: { center: number; corner: number };
  note: string;
}

/** 绝对路径 → res:// 形式(screenshot_capture.gd 的 ResourceLoader.exists/load 需要)。 */
export function toResPath(projectPath: string, absPath: string): string {
  return 'res://' + relative(projectPath, absPath).replace(/\\/g, '/');
}

const PIXEL_VERIFY_NOTE = '终验定位(spec §5):几何 layout_verify + style_verify 全绿后才跑一次'
  + '(每次 capture 窗口模式弹窗 + 秒级耗时,迭代每轮跑会拖垮收敛循环);'
  + '采样基准 = 输入 geometry 的视口 rect,挂载父须原点对齐(同 layout_verify 约束);'
  + 'flow 子节点的实际渲染位置由容器排布决定,与输入 rect 的偏差正是 flow_verify 的收敛对象'
  + '(终验前提全绿时偏差已在容差内;采样红时先查 flow_verify——位置未收敛与色错都表现为红)';

/**
 * ui_pixel_verify 编排:collectBgTargets → captureScreenshot(窗口模式,viewport=geo.viewport)
 * → PNG 解码 → 逐节点采样点计算(必要时按 PNG/viewport 线性缩放)→ 判定 → try/finally
 * 清理 PNG 中间产物(spec §5:临时名落项目内,失败路径也清理)。
 * 返回 ok:false 的两类:capture 失败(含 BLANK hint)/ PNG 解码失败。
 * cleaned_up 语义:finally 无条件 rmSync(force:true 不抛),成功路径直接写 true。
 */
export async function runPixelVerify(params: {
  godotPath: string; projectPath: string; scenePath: string; geo: PrototypeGeometry;
}): Promise<{ ok: true; summary: PixelVerifySummary } | { ok: false; error: string; hint?: string }> {
  const { godotPath, projectPath, scenePath, geo } = params;
  const { targets, skipped } = collectBgTargets(geo);
  const note = PIXEL_VERIFY_NOTE + (targets.length === 0 ? ';本次 geometry 无 bg 节点,无采样目标' : '');
  if (targets.length === 0) {
    return { ok: true, summary: emptySummary(geo, skipped, note) };
  }

  const tmpPng = join(projectPath, '.godot', 'mcp_pixel_verify.png');
  try {
    const shot = await captureScreenshot({
      godotPath, projectPath,
      scene: toResPath(projectPath, scenePath),
      outputPath: tmpPng,
      viewportSize: { width: geo.viewport.w, height: geo.viewport.h },
      timeout: 60,
    });
    if (!shot.success) {
      return { ok: false, error: `像素截图失败: ${shot.error ?? 'unknown'}`, hint: getBlankHint(shot.godotOutput ?? '') || undefined };
    }
    // Linux headless 可能「成功」产出空白 PNG——BLANK_DETECTED 显式拦截,不采样出全红误导
    const blankHint = getBlankHint(shot.godotOutput ?? '');
    if (blankHint) {
      return { ok: false, error: '像素截图为空白(headless 2D CanvasItem 不可渲染)', hint: blankHint };
    }

    let png: PNG;
    try {
      png = PNG.sync.read(readFileSync(tmpPng));
    } catch (err) {
      return { ok: false, error: `PNG 解码失败: ${err instanceof Error ? err.message : String(err)}` };
    }

    // 采样坐标缩放:PNG 尺寸与 geometry viewport 不一致(如 content scale/窗口边框差异)时
    // 按线性比例缩放,保持采样点与渲染内容的相对位置;scaled 标记暴露给消费方。
    const scaled = png.width !== geo.viewport.w || png.height !== geo.viewport.h;
    const sx = png.width / geo.viewport.w;
    const sy = png.height / geo.viewport.h;

    const nodes: NodePixelResult[] = targets.map(t => {
      const points = computeSamplePoints(t.rect, t.borderRadius, t.borderWidth);
      const samples = points.map(p => {
        const x = Math.round(p.x * sx);
        const y = Math.round(p.y * sy);
        return { x, y, rgb: pixelAt(png, x, y) };
      });
      return judgeNode(t.name, t.rect, t.target, points, samples);
    });

    return {
      ok: true,
      summary: {
        nodes,
        pass: nodes.filter(n => n.ok).length,
        fail: nodes.filter(n => !n.ok).length,
        skipped,
        viewport: { w: geo.viewport.w, h: geo.viewport.h },
        image: { width: png.width, height: png.height, scaled, cleaned_up: true },
        tolerances: { center: CENTER_TOL, corner: CORNER_TOL },
        note,
      },
    };
  } finally {
    rmSync(tmpPng, { force: true });
  }
}

function emptySummary(geo: PrototypeGeometry, skipped: Array<{ name: string; reason: string }>, note: string): PixelVerifySummary {
  return {
    nodes: [], pass: 0, fail: 0, skipped,
    viewport: { w: geo.viewport.w, h: geo.viewport.h },
    image: { width: 0, height: 0, scaled: false, cleaned_up: true },
    tolerances: { center: CENTER_TOL, corner: CORNER_TOL },
    note,
  };
}
```

(ESM 项目内禁用 `require`,顶部 import 已含所需模块;成功路径 `cleaned_up: true` 由 finally 无条件 `rmSync(force:true)` 保证,测试以 `existsSync(...)==false` 断言清理语义。)

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/pixel-verify.test.ts`
Expected: PASS 全绿(20 用例)。

- [ ] **Step 5: lint + build**

Run: `npm run lint && npm run build`
Expected: 0 错误。

- [ ] **Step 6: Commit**

```bash
git add src/tools/ui/pixel-verify.ts test/pixel-verify.test.ts
git commit -m "feat(ui): runPixelVerify 编排——capture 复用/PNG 解码/缩放采样/try-finally 清理"
```

---

### Task 3: handler 接线(ACTIONS/case/TOOL_META/schema/SLIM/matrix/budget)

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\ui\types.ts:9-22`(ACTIONS)
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\ui\index.ts`(case + 共用 geometry 解析提取 + description + properties + TOOL_META)
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\core\module-loader.ts:229`(SLIM descHint)
- Test: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\pixel-verify.test.ts`(追加 handler 负向 + meta 断言)

**Interfaces:**
- Consumes: Task 2 `runPixelVerify`/`PixelVerifySummary`;`handleUiImportPrototype` 内嵌的 geometry/geometry_path 解析段(`index.ts:551-577`,本任务提取为共用函数)。
- Produces: `ui` 工具新 action `ui_pixel_verify`(参数:公共 `project_path` + `scene_path`(必填)+ `geometry`/`geometry_path`(二选一,同 import 语义));返回 `{ pixel_verify: PixelVerifySummary }`。

- [ ] **Step 1: 写失败测试**

`test/pixel-verify.test.ts` 追加(顶部补 import):

```ts
import { handleTool, TOOL_META } from '../src/tools/ui/index.js';
import { ACTIONS } from '../src/tools/ui/types.js';
```

```ts
describe('ui_pixel_verify handler 接线', () => {
  function createCtx(): ToolContext {
    return {
      opsScript: '/fake/ops.gd',
      findGodot: async () => 'C:/godot/godot.exe',
      runningProcess: null, setRunningProcess: () => {},
      outputBuffer: [], setOutputBuffer: () => {},
      processStartTime: 0, setProcessStartTime: () => {},
      projectDir: process.cwd(), setProjectDir: () => {},
      parseGodotConfig: () => ({}),
    } as unknown as ToolContext;
  }

  it('geometry 与 geometry_path 都缺 → INVALID_PARAMS', async () => {
    const r = await handleTool('ui', { action: 'ui_pixel_verify', project_path: process.cwd(), scene_path: 'main.tscn' }, createCtx());
    const text = (r?.content?.[0] as { text: string }).text;
    expect(text).toContain('INVALID_PARAMS');
    expect(text).toContain('必须提供其一');
  });

  it('geometry_path 越界逃逸(../) → INVALID_PARAMS(路径白名单负向)', async () => {
    const r = await handleTool('ui', { action: 'ui_pixel_verify', project_path: process.cwd(), scene_path: 'main.tscn', geometry_path: '../outside.json' }, createCtx());
    const text = (r?.content?.[0] as { text: string }).text;
    expect(text).toContain('INVALID_PARAMS');
    expect(text).toContain('geometry_path');
  });

  it('scene_path 缺失 → INVALID_PARAMS(pixel_verify 必须指向已构建场景)', async () => {
    const r = await handleTool('ui', { action: 'ui_pixel_verify', project_path: process.cwd(), geometry: { viewport: { w: 10, h: 10 }, nodes: [] } }, createCtx());
    const text = (r?.content?.[0] as { text: string }).text;
    expect(text).toContain('INVALID_PARAMS');
    expect(text).toContain('scene_path');
  });

  it('ACTIONS/TOOL_META 登记一致(spec §5 actionRisks write)', () => {
    expect(ACTIONS).toContain('ui_pixel_verify');
    expect(TOOL_META['ui']!.actionRisks!['ui_pixel_verify']).toBe('write');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/pixel-verify.test.ts`
Expected: 新用例 FAIL——`ui_pixel_verify` 未注册(default 分支 UNKNOWN_ACTION / ACTIONS 不含)。

- [ ] **Step 3: 实现**

3a. `src/tools/ui/types.ts` ACTIONS 数组 `ui_import_prototype` 行后加一行:

```ts
  'ui_import_prototype',
  'ui_pixel_verify',
```

3b. `src/tools/ui/index.ts` 五处:

(i) 顶部 import 追加:

```ts
import { runPixelVerify } from './pixel-verify.js';
```

(ii) 工具 description(`:30` 的 description 字符串)在「原型: …返回 style_verify 逐槽位样式 diff/flow_verify flow 直接子层 rect diff)。」句后追加:

```
像素终验: ui_pixel_verify(bg 节点截图采样 vs 目标色 RGB 距离;Windows 窗口模式会弹窗,几何+style_verify 全绿后跑一次)。
```

(iii) `properties` 里 `geometry`(`:163`)与 `geometry_path`(`:166`)描述开头由 `ui_import_prototype:` 改为 `ui_import_prototype/ui_pixel_verify:`(两行描述全文保留,仅改前缀;`scene_path` 描述追加一句 `;ui_pixel_verify: 必填,已构建场景(ui_import_prototype persist 产物)`)。

(iv) **提取共用 geometry 解析**(DRY:import 内嵌段提取,行为不变):把 `handleUiImportPrototype` 中 `// geometry / geometry_path 二选一…` 到 `return opsErrorResult(ERROR_CODES.INVALID_PARAMS, 'geometry 与 geometry_path 必须提供其一'); }` 整段(`:551-577`)提取为文件级函数(放 `handleUiImportPrototype` 上方):

```ts
/** geometry/geometry_path 二选一解析(ui_import_prototype 与 ui_pixel_verify 共用):
 * 都给 → geometry 优先 + warning;都不给 → INVALID_PARAMS;geometry_path 经
 * normalizeUserProjectPath + resolveWithinRoot 白名单(越界 INVALID_PARAMS)。 */
function resolveGeometryInput(
  args: Record<string, unknown>,
  projectPath: string,
): { ok: true; rawGeometry: unknown; preWarnings: string[] } | { ok: false; result: ToolResult } {
  const geometryPathRaw = args.geometry_path as string | undefined;
  if (args.geometry !== undefined && args.geometry !== null) {
    const preWarnings: string[] = [];
    if (geometryPathRaw !== undefined) {
      preWarnings.push('geometry 与 geometry_path 同时提供: geometry 优先, geometry_path 被忽略');
    }
    return { ok: true, rawGeometry: args.geometry, preWarnings };
  }
  if (geometryPathRaw !== undefined) {
    let absGeometryPath: string;
    try {
      absGeometryPath = resolveWithinRoot(projectPath, normalizeUserProjectPath(geometryPathRaw));
    } catch (err) {
      return { ok: false, result: opsErrorResult(ERROR_CODES.INVALID_PARAMS, `geometry_path 非法: ${getErrorMessage(err)}`) };
    }
    try {
      return { ok: true, rawGeometry: JSON.parse(readFileSync(absGeometryPath, 'utf-8')), preWarnings: [] };
    } catch (err) {
      return { ok: false, result: opsErrorResult(ERROR_CODES.INVALID_PARAMS, `geometry_path 文件读取或 JSON 解析失败: ${getErrorMessage(err)}`) };
    }
  }
  return { ok: false, result: opsErrorResult(ERROR_CODES.INVALID_PARAMS, 'geometry 与 geometry_path 必须提供其一') };
}
```

`handleUiImportPrototype` 内原段替换为调用(行为不变,现集成测试保护):

```ts
  const resolved = resolveGeometryInput(args, projectPath);
  if (!resolved.ok) return resolved.result;
  const preWarnings = resolved.preWarnings;
  const rawGeometry = resolved.rawGeometry;
```

(v) case 接线:`case 'ui_import_prototype':` 前加:

```ts
      case 'ui_pixel_verify':
        // 特殊链路:capture 是独立 spawn(窗口模式 driver 参数不同,spec §5 capture 不并入
        // executor 链),不走公共单次执行段,提前 return——同 ui_import_prototype 模式。
        return await handleUiPixelVerify(args, projectPath, godot);
```

并新增 handler(放 `handleUiImportPrototype` 后):

```ts
/**
 * ui_pixel_verify(spec §5 终验):入参同 import(geometry/geometry_path 二选一 + 必填
 * scene_path 指向 ui_import_prototype persist 产物)→ parseGeometry → runPixelVerify
 * (capture → decode → 采样 → 判定)。不做 translate/translate 产物比对——采样基准是
 * 输入视口 rect(终验前提:layout_verify/style_verify 已全绿,期望≈实测)。
 */
async function handleUiPixelVerify(
  args: Record<string, unknown>,
  projectPath: string,
  godot: string,
): Promise<ToolResult> {
  const sceneRaw = args.scene_path as string | undefined;
  if (!sceneRaw || !String(sceneRaw).trim()) {
    return opsErrorResult(ERROR_CODES.INVALID_PARAMS, 'ui_pixel_verify 需要 scene_path 指向已构建场景(ui_import_prototype persist 产物)');
  }
  let scenePath: string;
  try {
    scenePath = resolveWithinRoot(projectPath, normalizeUserProjectPath(String(sceneRaw)));
  } catch (err) {
    return opsErrorResult(ERROR_CODES.INVALID_PARAMS, `scene_path 非法: ${getErrorMessage(err)}`);
  }
  const resolved = resolveGeometryInput(args, projectPath);
  if (!resolved.ok) return resolved.result;
  let geo: PrototypeGeometry;
  try {
    geo = parseGeometry(resolved.rawGeometry);
  } catch (err) {
    return opsErrorResult(ERROR_CODES.INVALID_PARAMS, getErrorMessage(err));
  }
  const r = await runPixelVerify({ godotPath: godot, projectPath, scenePath, geo });
  if (!r.ok) {
    return opsErrorResult(ERROR_CODES.SCRIPT_EXEC_FAILED, r.error + (r.hint ? `\nHint: ${r.hint}` : ''));
  }
  return textResult(JSON.stringify(opsSuccess({ pixel_verify: r.summary })));
}
```

(vi) TOOL_META `actionRisks`(`:718` 后)加:

```ts
      ui_import_prototype: 'write', ui_pixel_verify: 'write',
```

3c. `src/core/module-loader.ts:229` descHint 尾部(`→ 返回 style_verify/flow_verify` 后)追加:

```
; ui_pixel_verify→geometry/geometry_path+scene_path(必填,已构建场景;bg 节点截图采样 vs 目标色,Windows 窗口模式弹窗;终验——几何+style_verify 全绿后跑一次)
```

- [ ] **Step 4: 跑测试确认通过 + 既有测试无回归**

Run: `npx vitest run test/pixel-verify.test.ts test/prototype-import.test.ts`
Expected: PASS(prototype-import 单测保护 resolveGeometryInput 提取的无回归;若仓内另有 ui-import 相关单测文件,一并列入命令)。

- [ ] **Step 5: build + matrix + budget**

Run: `npm run build && npm run build-matrix && npm run diff-matrix && npm run check:budget`
Expected: build 0 错;matrix 重建含 ui_pixel_verify(action 数 240→241);diff-matrix no drift;budget 0 error(3 既有 warn 允许)。

- [ ] **Step 6: Commit**

```bash
git add src/tools/ui/types.ts src/tools/ui/index.ts src/core/module-loader.ts docs/capability-matrix.json docs/capability-matrix.md test/pixel-verify.test.ts
git commit -m "feat(ui): ui_pixel_verify 接线——ACTIONS/case/TOOL_META write/SLIM descHint/matrix"
```

---

### Task 4: Windows 集成验收 + 容差校准 + coverage 决策

**Files:**
- Create: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\integration\ui-pixel-verify-integration.test.ts`
- 不改 `vitest.config.ts`(coverage 决策:pixel-verify.ts **不排除**,理由写入测试头注释)。

**Interfaces:**
- Consumes: `handleTool('ui', { action: 'ui_import_prototype' / 'ui_pixel_verify', … })`;fixture `test/fixtures/prototype-geometry/css-card.json`(PR-1 已建,viewport 800×600,含 bg/borderRadius/border 节点)。

- [ ] **Step 1: 写集成测试(Windows-only skip 先例)**

```ts
// test/integration/ui-pixel-verify-integration.test.ts
// PR-3 集成验收(spec 2026-08-17-prototype-stylebox-loop-design.md §5/§7):
// 真跑 Godot 窗口模式(会短暂弹窗——Windows headless=dummy renderer 截图空白,窗口模式
// 是唯一可靠渲染路径,spec §5 实测前提)。三用例:
//   1. css-card:ui_import_prototype 建场 → ui_pixel_verify 同图全绿(逐 bg 节点 5 采样点);
//   2. 容差校准(§10.2):首跑若阈值不过,记录实际 distance 分布 → 校准常量 → 复跑全绿,
//      校准过程在本文件注释如实留档(不静默调阈值);
//   3. 负向:geometry_path '../' 逃逸 → INVALID_PARAMS(集成层白名单,沿 import 用例 3 先例)。
// coverage 决策:pixel-verify.ts 不进 coverage exclude——纯函数(Task 1)跨平台单测覆盖,
// 编排 mock 单测(Task 2)覆盖分支,与 game-bridge「Linux CI 完全无法跑其测试」的排除理由
// 不同;本集成文件 Windows-only skip 照 ui-import-integration.test.ts:40 先例(const run = !!GODOT && win32,describe.skipIf)。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleTool } from '../../src/tools/ui/index.js';
import type { ToolContext, ToolResult } from '../../src/types.js';

const GODOT = process.env.GODOT_PATH;
const run = !!GODOT && process.platform === 'win32';
const CARD_FIXTURE = fileURLToPath(new URL('../fixtures/prototype-geometry/css-card.json', import.meta.url));

describe.skipIf(!run)('ui_pixel_verify 集成验收(真跑 Godot 窗口模式)', () => {
  let dir: string;

  function createCtx(): ToolContext {
    return {
      opsScript: '/fake/ops.gd',
      findGodot: async () => GODOT!,
      runningProcess: null, setRunningProcess: () => {},
      outputBuffer: [], setOutputBuffer: () => {},
      processStartTime: 0, setProcessStartTime: () => {},
      projectDir: dir, setProjectDir: () => {},
      parseGodotConfig: () => ({}),
    } as unknown as ToolContext;
  }
  const textOf = (r: ToolResult | null): string => {
    const el = r?.content?.[0];
    if (!el || el.type !== 'text') throw new Error('content[0] is not text');
    return el.text;
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ui-pixel-verify-'));
    // css-card viewport 800x600 → 项目尺寸同建(anchor 拉伸防线,同 import 集成先例)
    writeFileSync(join(dir, 'project.godot'),
      `config_version=5\n\n[display]\nwindow/size/viewport_width=800\nwindow/size/viewport_height=600\n`);
    writeFileSync(join(dir, 'main.tscn'),
      `[gd_scene format=3]\n\n[node name="Main" type="Control"]\noffset_right = 800.0\noffset_bottom = 600.0\n`);
    mkdirSync(join(dir, 'proto'), { recursive: true });
    copyFileSync(CARD_FIXTURE, join(dir, 'proto', 'css-card.json'));
  });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it('css-card:import 建场(前置绿)→ ui_pixel_verify 同图全绿', { timeout: 180_000 }, async () => {
    const imported = await handleTool('ui', {
      action: 'ui_import_prototype',
      project_path: dir, scene_path: 'main.tscn', geometry_path: 'proto/css-card.json',
    }, createCtx());
    const imp = JSON.parse(textOf(imported)) as {
      success: boolean; data?: { layout_verify?: { diff?: unknown[] }; style_verify?: unknown[] };
    };
    // 终验前置(spec §5):几何 + style 全绿才跑 pixel_verify——前置不绿时如实失败,
    // 不绕过前置直接像素验证(那会掩盖几何错位的采样错位)。
    expect(imp.success, JSON.stringify(imp)).toBe(true);

    const result = await handleTool('ui', {
      action: 'ui_pixel_verify',
      project_path: dir, scene_path: 'main.tscn', geometry_path: 'proto/css-card.json',
    }, createCtx());
    const out = JSON.parse(textOf(result)) as {
      success: boolean;
      data?: { pixel_verify?: { nodes: Array<{ name: string; ok: boolean; samples: Array<{ distance: number | null }> }>; pass: number; fail: number; image: { width: number; height: number } } };
      error?: string;
    };
    expect(out.error).toBeUndefined();
    const pv = out.data?.pixel_verify;
    expect(pv, JSON.stringify(out)).toBeDefined();
    // 采样节点数 = fixture 中带 bg 的节点数(校准锚点:数字以 fixture 实测为准,勿照抄)
    // ——首跑执行者先 console.log(JSON.stringify(pv!.nodes.map(n => ({ n: n.name, ok: n.ok,
    //    maxD: Math.max(...n.samples.map(s => s.distance ?? -1)) })))) 记录分布,再收紧断言。
    expect(pv!.fail).toBe(0);
    expect(pv!.pass).toBeGreaterThan(0);
    expect(pv!.nodes.every(n => n.ok)).toBe(true);
  });

  it('geometry_path ../ 逃逸 → INVALID_PARAMS(集成层路径白名单)', { timeout: 30_000 }, async () => {
    const result = await handleTool('ui', {
      action: 'ui_pixel_verify',
      project_path: dir, scene_path: 'main.tscn', geometry_path: '../escape.json',
    }, createCtx());
    expect(textOf(result)).toContain('INVALID_PARAMS');
  });
});
```

- [ ] **Step 2: 真跑集成(含容差校准循环)**

Run: `GODOT_PATH="$GODOT_PATH" npx vitest run test/integration/ui-pixel-verify-integration.test.ts --timeout 180000`
Expected 首跑可能 FAIL(阈值初值 20/60 与真渲染底噪不符,或发现 2D 线性色空间偏差)。校准流程(§10.2 开放问题闭环):
1. 从失败输出取每节点每采样点 `distance` 分布(测试注释里的 console.log 探针);
2. 若分布是**底噪声**(全点 < ~30):把 `CENTER_TOL/CORNER_TOL` 上调到实测 max+裕量(如 center=max*1.5, corner=max*1.5),并在常量注释记录实测分布;
3. 若分布是**系统性偏移**(如 RGB 各通道恒定偏移——linear/sRGB 色彩空间差):**禁止**用大阈值掩盖——停下,在 pixel-verify.ts 头注释与本测试注释记录实测偏移值,把 target 换算处按实测校准(如加 gamma 校正),并在最终审查文档声明;
4. 复跑至全绿,把最终阈值与依据写进 `CENTER_TOL/CORNER_TOL` 注释。

- [ ] **Step 3: 单测全量 + lint/build 回归**

Run: `npm run lint && npm run build && npm test`
Expected: 全绿(集成用例在 Windows 环境真跑,非 Windows skip)。

- [ ] **Step 4: Commit**

```bash
git add test/integration/ui-pixel-verify-integration.test.ts src/tools/ui/pixel-verify.ts
git commit -m "test(ui): ui_pixel_verify Windows 集成验收+容差校准(§10.2 闭环)"
```

---

### Task 5: 规则双副本(ui_pixel_verify 段 + T5a/T5c)+ version bump + STRICT rules-sync

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\.claude\rules\godot-mcp-ui.md`(`:130` T5a、`:139` T5c、新增 ui_pixel_verify 段)
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\rule-templates.ts`(对应镜像段 `:612`/`:621` + 新增段镜像)
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\ui\index.ts:687`(`_note` 孙层措辞,T5c)
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\ui\types.ts:94-102`(STYLEBOX_SLOTS 注释,T5c)
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\ui\ui-measure.ts:46`(`_all_slots` 注释,T5c)
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\README.md:641`(T5a)
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\CHANGELOG.md:15`(T5a)
- Modify: `package.json` + `manifest.json` 等(version-sync 管)

**Interfaces:**
- Consumes: Task 3 已上线的 `ui_pixel_verify`;Task 4 校准后的阈值事实。
- Produces: 版本 0.32.2;双副本一致(STRICT 门禁过)。

- [ ] **Step 1: T5a——4 处「以 style_verify 数值暴露」措辞修正**

实质(PR-2 终审 MIN-1):border 四边各异生产者仅取 top,style_verify 期望与实测**同源于同一翻译产出**,恒绿,暴露不了三边差异;真暴露渠道是像素级验证。4 处统一改为:

`.claude/rules/godot-mcp-ui.md:130` 与 `src/tools/rule-templates.ts:612` 镜像段,把:

```
**四边各异不单独 warning**——生产者仅取 top,其余三边差异静默,最终以 style_verify 数值暴露
```

改为:

```
**四边各异不单独 warning**——生产者仅取 top,其余三边差异静默;style_verify 无法暴露该差异(期望与实测同源于同一翻译产出,恒绿),真暴露渠道是 ui_pixel_verify 像素采样
```

(注意 rule-templates.ts 侧是模板字符串内的转义文本,保持该文件现有引号/反引号风格逐字镜像;两段除版本行外必须逐字一致。)

`README.md:641`(v0.32.1 版本表行)把句末 `M-1 border 四边各异不单独 warning 双副本显式声明(生产者仅取 top,以 style_verify 数值暴露)` 改为 `M-1 border 四边各异不单独 warning 双副本显式声明(生产者仅取 top;style_verify 同源恒绿暴露不了,真暴露渠道是像素采样——0.32.2 ui_pixel_verify)`。

`CHANGELOG.md:15`(0.32.1 段 M-1 行)把 `border 四边各异不单独 warning(生产者仅取 top)` 改为 `border 四边各异不单独 warning(生产者仅取 top;该差异 style_verify 同源恒绿暴露不了,真暴露渠道为 0.32.2 的 ui_pixel_verify 像素采样)`。

- [ ] **Step 2: T5c——孙层措辞 + 七槽双份硬编码注释**

2a. 孙层措辞(3 处):
- `src/tools/ui/index.ts:687`:`;孙层为近似覆盖` → `;孙层由 layout_verify 近似覆盖(期望相对输入父原点,容器排布后天然带偏移)`;
- `.claude/rules/godot-mcp-ui.md:139`:「孙层为近似覆盖,期望相对输入父原点,容器排布后天然带偏移」→「孙层由 **layout_verify** 近似覆盖(非 flow_verify)——期望相对输入父原点,容器排布后天然带偏移」;
- `src/tools/rule-templates.ts:621` 镜像同改(逐字一致)。

2b. 七槽白名单 TS/GD 双份硬编码互指注释:
- `src/tools/ui/types.ts` `STYLEBOX_SLOTS` 定义上方注释追加一行:`双份硬编码:GD 侧副本在 ui-measure.ts 生成脚本的 _all_slots(override 并集扫描),扩槽须两处同步。`
- `src/tools/ui/ui-measure.ts:46` 行 `_all_slots` 定义改为带尾注:`const _all_slots := ["panel", "normal", "background", "fill", "hover", "pressed", "disabled"]  # 与 types.ts STYLEBOX_SLOTS 双份硬编码,扩槽须两处同步`(此行是生成 GDScript 的模板字符串内容——**GDScript 注释语法是 `#`,不改字符串结构,只在行尾加注释**;确认该行位于模板字符串内时同步检查生成脚本测试快照是否需要更新:`npx vitest run test/ui-measure.test.ts` 若有快照断言含该行,先跑测试看红再同步快照)。

- [ ] **Step 3: 新增 ui_pixel_verify 规则段(双副本,spec §5 使用模式约束)**

`.claude/rules/godot-mcp-ui.md` 在 flow_verify/verify_coverage 段(约 `:139`)之后新增(= `src/tools/rule-templates.ts` 对应位置镜像同文,逐字一致):

```markdown
- **ui_pixel_verify(像素终验)**：对已构建场景（`scene_path` 必填，指 `ui_import_prototype` persist 产物）窗口模式截图，对每个 bg 节点采样中心+四角内缩点（内缩 `min(borderRadius+border.width, 短边/2−2)`），与目标色 RGB 欧氏距离判定（中心容差 20、角点 60，0-255 空间；实测校准值见 pixel-verify.ts 常量注释）。**定位是终验而非迭代反馈**——几何 layout_verify + style_verify 全绿后才跑一次（每次 capture 窗口模式弹窗 + 秒级耗时）。Windows 窗口模式专属（headless=dummy renderer 截图空白；Linux headless 2D CanvasItem 亦空白，工具会以 BLANK hint 报错）。半透明 bg（alpha<1）跳过（合成后采样色≠bg_color）；采样基准=输入视口 rect，挂载父须原点对齐（同 layout_verify 约束）；PNG 中间产物临时落 `.godot/` 且失败路径也清理。
```

(中心/角点容差数字以 Task 4 校准后常量为准——若校准改了 20/60,本段同步;rule-templates.ts 侧注意模板字符串内反引号转义为 `\``。)

- [ ] **Step 4: version bump + 同步 + STRICT 校验**

Run(依次):
```bash
npm version patch --no-git-tag-version        # 0.32.1 → 0.32.2
npm run version-sync                            # 同步 manifest.json 等
npm run build                                   # check-rules 脚本消费 build 产物
STRICT=1 npm run check:rules-sync               # 双副本 9+ 段全一致,drift 阻断
```
Expected: version-check 后续在 Task 6 全跑;此处 rules-sync 必须「9 files consistent / 0 drift」。

- [ ] **Step 5: 快速回归**

Run: `npm run lint && npm run build && npx vitest run test/pixel-verify.test.ts test/ui-measure.test.ts 2>/dev/null || npx vitest run test/pixel-verify.test.ts`
Expected: 0 错误全绿(ui-measure 快照若因注释行变更,同步后绿)。

- [ ] **Step 6: Commit**

```bash
git add .claude/rules/godot-mcp-ui.md src/tools/rule-templates.ts src/tools/ui/index.ts src/tools/ui/types.ts src/tools/ui/ui-measure.ts README.md CHANGELOG.md package.json package-lock.json
git commit -m "docs(ui): ui_pixel_verify 规则段+T5a/T5c 措辞修正(双副本)+0.32.2 bump"
```

(manifest.json 等 version-sync 产物一并 `git status` 检查入列。)

---

### Task 6: CHANGELOG/README 收尾 + 全量门禁 + 终审交接

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\CHANGELOG.md`(新增 `[0.32.2]` 段)
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\README.md`(版本表加 0.32.2 行)

- [ ] **Step 1: CHANGELOG 新段(在 `[0.32.1]` 段之上)**

```markdown
## [0.32.2] - 2026-08-18

### Added

- **`ui_pixel_verify` 像素终验**(原型翻译层 PR-3,spec §5):ui 工具新 action——入参同 `ui_import_prototype`(geometry/geometry_path 二选一)+ 必填 `scene_path`(已构建场景);窗口模式截图(Windows 专属,headless dummy renderer 空白)→ PNG 解码 → 每 bg 节点采样中心+四角内缩点(内缩 clamp `min(borderRadius+border.width, 短边/2−2)` 防越界)→ 与目标色 RGB 欧氏距离判定(中心/角点分级容差,实测校准);半透明 bg 跳过(合成后不可直判);PNG 中间产物 try/finally 清理;BLANK hint 显式拦截 Linux headless 空白;定位**终验**(几何+style_verify 全绿后跑一次,规则文档已写明)。`actionRisks: write`。

### Changed

- M-1 措辞修正(PR-2 T5a,4 处):border 四边各异「以 style_verify 数值暴露」改为准确语义——style_verify 期望/实测同源恒绿暴露不了,真暴露渠道是 ui_pixel_verify 像素采样。
- 孙层覆盖措辞精确化(PR-2 T5c):「孙层为近似覆盖」→「孙层由 layout_verify 近似覆盖(期望相对输入父原点)」;STYLEBOX_SLOTS(TS)与 measure 生成脚本 `_all_slots`(GD)双份硬编码加互指注释。
```

- [ ] **Step 2: README 版本表加行(`:641` 的 v0.32.1 行之上)**

```markdown
| **v0.32.2** | 2026-08-18 | **原型翻译层像素终验(ui_pixel_verify,PR-3)**:ui 工具新 action——对已构建场景窗口模式截图(Windows 专属),每 bg 节点采样中心+四角内缩点(内缩 clamp 防圆角越界)与目标色 RGB 距离判定(中心/角点分级容差);半透明 bg 跳过;BLANK 拦截;PNG 临时产物必清理;定位终验(几何+style_verify 全绿后跑一次)。附带 PR-2 措辞修正(T5a border 暴露渠道/T5c 孙层覆盖来源)。43 工具/241 action。 |
```

(action 数以 `npm run diff-matrix` 实际输出为准——241 是 240+1 推算,若 diff 显示不同,以实测数字写。)

- [ ] **Step 3: 全量门禁(真跑,贴输出)**

Run(依次,任何一项红则修复重跑):
```bash
npm run lint                                  # 0 error
npm run build                                 # 0 error
npm test                                      # 全绿(含 Windows 集成真跑)
npm run build-matrix && npm run diff-matrix   # no drift
npm run check:budget                          # 0 error(3 既有 warn 允许)
STRICT=1 npm run check:rules-sync             # 9 模板一致
npm run version-check                         # 0.32.2
```

- [ ] **Step 4: Commit + 终审交接**

```bash
git add CHANGELOG.md README.md
git commit -m "docs(changelog): 0.32.2 段——ui_pixel_verify 像素终验(PR-3)"
```

随后进入 superpowers 收尾流程(主会话执行,不属本 plan 任务):派 code-reviewer 子代理终审(范围:Task 1-6 全部 commit + spec §5/§7/§8 PR-3 行逐项核销 + AGENTS.md 仓库级约束独立核查)→ `docs/reviews/2026-08-18-prototype-stylebox-pr3.md` 归档 → memory 登记(`feature-decision-log: stylebox-pixel-verify-pr3` + 工程教训)→ Obsidian 开发日志 → push 前 pre-push review → 开 PR(merge 留用户)→ ledger 交接行。

---

## 执行注意(全任务通用)

1. **测试先红后绿**:每任务 Step 1 写测试 → Step 2 确认红 → 实现 → 绿。跳过红验证 = TDD 违规。
2. **快照护栏**:写进文档的数字(action 数 241、用例数、阈值)落盘前用命令实测(`grep -c`/`npm run diff-matrix` 输出),不照抄本 plan 推算值。
3. **不动文件**:`src/screenshot.ts`、`src/scripts/*.gd`、`build/`、`docs/capability-matrix.*`(只经 `npm run build-matrix` 生成)、`package-lock.json`(只经 npm 命令)。
4. **双副本逐字一致**:Task 5 的规则段落两文件镜像,归一化只抹版本行——任何措辞差都会被 STRICT 拦断;写完立即跑 `STRICT=1 npm run check:rules-sync`。
5. **集成校准诚实原则**(Task 4 Step 2):阈值校准记录分布数据;系统性色彩偏移不许大阈值掩盖——记录偏移、根因分析、审查文档声明。
