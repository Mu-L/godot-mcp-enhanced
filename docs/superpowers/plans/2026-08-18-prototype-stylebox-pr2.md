# PR-2 verify 层(style_verify + flow_verify)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ui_import_prototype` 返回 `style_verify`(逐节点逐槽位逐属性 target/actual/delta)与 `flow_verify`(flow 直接子节点期望 rect vs 实测 global rect)数字清单;`ui_measure_layout` 挂 `style_verify`;同时落 PR-1 终审转来的 5 条顺手项(M-1/M-2/M-5 校验与声明、fill-only 灰底 warning×2)。

**Architecture:** 三段:纯函数层(`layout-diff.ts` 加 diffStyles/diffFlow/flattenStyleTargets)→ 翻译层(`prototype-import.ts` 产出 `flow_expect`)→ GD 读回层(`ui-measure.ts` 期望清单内嵌 + `get_theme_stylebox` 按需读回)。判定信息传递机制按 spec §4.1 I-B 拍板:期望清单 TS 侧序列化内嵌进 measure 脚本,运行时 `has_theme_stylebox_override` 仅作补充并集条件(禁止 GD 纯自判)。

**Tech Stack:** TypeScript(ES2022/strict/ESM,import 带 `.js` 扩展名)、Vitest、GDScript(Godot 4.5-4.7,tab 缩进)。

**Spec:** `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\docs\superpowers\specs\2026-08-17-prototype-stylebox-loop-design.md` §4(PR-2 范围)、§7(测试策略)、§8(改动面)、§10.5(开放问题:flow 容差实测校准)。

## Global Constraints

- **语言**:所有自然语言输出(测试描述/警告文案/注释)用简体中文;代码标识符英文。
- **ESLint 零警告**:禁 `any`、未使用变量 error(参数前缀 `_` 豁免)、`prefer-const`。
- **ESM**:import 必须带 `.js` 扩展名(`./types.js`)。
- **分支**:`feat/prototype-stylebox-pr2`,基线 `master=ba8498f`(2026-08-18 已核实)。
- **版本**:0.32.0 → **0.32.1**(patch;命令 `npm version patch --no-git-tag-version`,双副本变更强制 bump)。
- **双副本约束**:凡改 `.claude/rules/godot-mcp-ui.md`,必须同步 `src/tools/rule-templates.ts` 对应镜像段(反引号在 rule-templates 内转义为 `` \` ``);核验 `STRICT=1 npm run check:rules-sync`(需先 `npm run build`)。
- **完成门禁**(每任务提交前):`npm run lint` + `npm run build` + `npm test` 全绿;PR 收尾追加 `STRICT=1 npm run check:rules-sync` + `npm run build-matrix` + `npm run check:budget` + `npm run version-check`。
- **GD 注入安全**:期望清单内嵌走 `gdEscape(JSON.stringify(...))` 单字符串 + GD 侧 `JSON.parse_string`(手写树 name 是任意字符串,禁止裸拼 GD 字面量)。
- **测试超时**:单测默认 10000ms;集成需 `GODOT_PATH` + Windows(`describe.skipIf(!run)`)。
- **禁改**:`build/`、`docs/capability-matrix.*`(走 `npm run build-matrix`)、`package-lock.json`、`.godot/`。

---

### Task 1: 纯函数层——layout-diff.ts 加 style/flow diff

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\ui\layout-diff.ts`(文件现 125 行,追加 PR-2 段)
- Test: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\ui-layout-diff.test.ts`(已有,追加 describe)

**Interfaces:**
- Consumes: 现有 `MeasuredNode`/`DiffEntry`/`flattenTargets`(layout-diff.ts:12-36)、`UiNodeSpec.styleboxes`(types.ts:126)。
- Produces(Task 3/4 依赖,签名必须一字不差):
  - `export interface StyleReading { path: string; slot: string; flat: boolean; type?: string; bg_color?: [number, number, number, number]; corner_radius?: { tl: number; tr: number; br: number; bl: number }; border_width?: { left: number; top: number; right: number; bottom: number }; border_color?: [number, number, number, number]; }`
  - `export interface StyleDiffEntry { path: string; slot: string; field: string; target: number | number[] | string | null; actual: number | number[] | string | null; delta: number | number[] | null; ok: boolean; }`
  - `export const STYLE_COLOR_TOL = 0.002;`
  - `export interface StyleTargetEntry { path: string; slot: string; box: StyleBoxFlatSpec }`
  - `export function flattenStyleTargets(tree: UiNodeSpec, prefix?: string): StyleTargetEntry[]`
  - `export function styleExpectList(targets: StyleTargetEntry[]): Array<{ path: string; slots: string[] }>`
  - `export function diffStyles(readings: StyleReading[], targets: StyleTargetEntry[], colorTol?: number): StyleDiffEntry[]`
  - `export function diffFlow(measured: MeasuredNode[], flowExpect: Array<{ path: string; rect: Rect }>, tolerancePx?: number): DiffEntry[]`
  - `MeasuredNode` 追加 `styles?: StyleReading[];`

- [ ] **Step 1: 写失败测试**(追加到 `test/ui-layout-diff.test.ts` 末尾)

```ts
// ─── PR-2 Task 1: style_verify / flow_verify 纯函数 ────────────────────────

import { flattenStyleTargets, styleExpectList, diffStyles, diffFlow, STYLE_COLOR_TOL } from '../src/tools/ui/layout-diff.js';
import type { StyleReading, StyleDiffEntry } from '../src/tools/ui/layout-diff.js';
import type { UiNodeSpec } from '../src/tools/ui/types.js';

describe('flattenStyleTargets / styleExpectList(PR-2)', () => {
  const tree: UiNodeSpec = {
    type: 'Panel', name: 'Root', rect: { x: 0, y: 0, w: 100, h: 100 },
    styleboxes: [{ slot: 'panel', box: { bg_color: [0.1, 0.12, 0.18, 1] } }],
    children: [
      { type: 'ProgressBar', name: 'Hp', rect: { x: 8, y: 8, w: 80, h: 10 },
        styleboxes: [
          { slot: 'background', box: { bg_color: [0, 0, 0, 1] } },
          { slot: 'fill', box: { bg_color: [0.2, 0.8, 0.4, 1] } },
        ] },
    ],
  };
  it('flattenStyleTargets:逐节点逐槽位,path 链与 flattenTargets 同构(根级无前缀)', () => {
    const out = flattenStyleTargets(tree);
    expect(out.map(t => `${t.path}:${t.slot}`)).toEqual([
      'Root:panel', 'Root/Hp:background', 'Root/Hp:fill',
    ]);
  });
  it('styleExpectList:同 path 多槽聚合(顺序保持)', () => {
    const list = styleExpectList(flattenStyleTargets(tree));
    expect(list).toEqual([
      { path: 'Root', slots: ['panel'] },
      { path: 'Root/Hp', slots: ['background', 'fill'] },
    ]);
  });
  it('无 styleboxes 的树 → 两个函数均空数组', () => {
    const plain: UiNodeSpec = { type: 'Panel', name: 'P' };
    expect(flattenStyleTargets(plain)).toEqual([]);
    expect(styleExpectList([])).toEqual([]);
  });
});

describe('diffStyles(PR-2)', () => {
  const target = { path: 'Card', slot: 'panel', box: {
    bg_color: [0.1, 0.12, 0.18, 1], corner_radius: 8, border_width: 2, border_color: [0.24, 0.86, 0.52, 1],
  } };
  const flatReading: StyleReading = {
    path: 'Card', slot: 'panel', flat: true,
    bg_color: [0.1, 0.12, 0.18, 1],
    corner_radius: { tl: 8, tr: 8, br: 8, bl: 8 },
    border_width: { left: 2, top: 2, right: 2, bottom: 2 },
    border_color: [0.24, 0.86, 0.52, 1],
  };
  it('全字段命中 → 全绿,11 条(bg1+corner4+border_width4+border_color1)', () => {
    const out = diffStyles([flatReading], [target]);
    expect(out).toHaveLength(11);
    expect(out.every(e => e.ok)).toBe(true);
    const bg = out.find(e => e.field === 'bg_color')!;
    expect(bg.target).toEqual([0.1, 0.12, 0.18, 1]);
    expect(bg.delta).toEqual([0, 0, 0, 0]);
    const c = out.find(e => e.field === 'corner_radius_top_left')!;
    expect(c.target).toBe(8);
    expect(c.actual).toBe(8);
  });
  it('颜色 float32 漂移在容差内绿(0.2 → 0.2000000029 级),超容差红', () => {
    const r: StyleReading = { ...flatReading, bg_color: [0.1 + STYLE_COLOR_TOL, 0.12, 0.18, 1] };
    const out = diffStyles([r], [target]);
    expect(out.find(e => e.field === 'bg_color')!.ok).toBe(true);
    const r2: StyleReading = { ...flatReading, bg_color: [0.1 + STYLE_COLOR_TOL * 10, 0.12, 0.18, 1] };
    const out2 = diffStyles([r2], [target]);
    const bg2 = out2.find(e => e.field === 'bg_color')!;
    expect(bg2.ok).toBe(false);
    expect(bg2.delta).toEqual([STYLE_COLOR_TOL * 10, 0, 0, 0]);
  });
  it('非 StyleBoxFlat(Label 未 override → StyleBoxEmpty)→ 单条 type 红条目,不进字段 diff', () => {
    const r: StyleReading = { path: 'Card', slot: 'normal', flat: false, type: 'StyleBoxEmpty' };
    const out = diffStyles([r], [{ path: 'Card', slot: 'normal', box: { bg_color: [1, 1, 1, 1] } }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.field).toBe('type');
    expect(out[0]!.target).toBe('StyleBoxFlat');
    expect(out[0]!.actual).toBe('StyleBoxEmpty');
    expect(out[0]!.ok).toBe(false);
  });
  it('override 没设上(get 回默认主题数值)→ 字段 diff 红(§4.1 核心防线)', () => {
    // Panel 默认主题 panel 槽是 StyleBoxFlat 灰底 + 无圆角无边框
    const defaultTheme: StyleReading = {
      path: 'Card', slot: 'panel', flat: true,
      bg_color: [0.1, 0.1, 0.1, 1],
      corner_radius: { tl: 0, tr: 0, br: 0, bl: 0 },
      border_width: { left: 0, top: 0, right: 0, bottom: 0 },
      border_color: [0.8, 0.8, 0.8, 1],
    };
    const out = diffStyles([defaultTheme], [target]);
    expect(out.find(e => e.field === 'bg_color')!.ok).toBe(false);
    expect(out.find(e => e.field === 'corner_radius_top_left')!.ok).toBe(false);
    expect(out.find(e => e.field === 'border_width_left')!.ok).toBe(false);
  });
  it('reading 缺失(节点不在测量集)→ (reading missing) 红条目', () => {
    const out = diffStyles([], [target]);
    expect(out).toHaveLength(1);
    expect(out[0]!.field).toBe('(reading missing)');
    expect(out[0]!.ok).toBe(false);
  });
  it('期望字段缺省不比对(box 只有 bg_color 时仅 1 条;draw_center 永不比)', () => {
    const t = { path: 'X', slot: 'panel', box: { bg_color: [0, 0, 0, 1], draw_center: false } };
    const out = diffStyles([{ path: 'X', slot: 'panel', flat: true, bg_color: [0, 0, 0, 1] }], [t]);
    expect(out).toHaveLength(1);
    expect(out.every(e => e.ok)).toBe(true);
  });
  it('corner_radius 对象形态:{tl:8} 展开 tl=8 其余 0(与生成器同缺省)', () => {
    const t = { path: 'Y', slot: 'panel', box: { corner_radius: { tl: 8 } } };
    const r: StyleReading = { path: 'Y', slot: 'panel', flat: true,
      corner_radius: { tl: 8, tr: 0, br: 0, bl: 0 } };
    const out = diffStyles([r], [t]);
    expect(out).toHaveLength(4);
    expect(out.every(e => e.ok)).toBe(true);
    expect(out.find(e => e.field === 'corner_radius_bottom_right')!.target).toBe(0);
  });
});

describe('diffFlow(PR-2)', () => {
  const measured = [
    { path: 'R/H/H_Flow/A', type: 'Button', rect: { x: 100, y: 100, w: 72, h: 40 } },
    { path: 'R/H/H_Flow/B', type: 'Button', rect: { x: 268, y: 100, w: 72, h: 40 } },
  ];
  const expect1 = [
    { path: 'R/H/H_Flow/A', rect: { x: 100, y: 104, w: 72, h: 32 } },
    { path: 'R/H/H_Flow/B', rect: { x: 268, y: 104, w: 72, h: 32 } },
  ];
  it('期望为视口绝对、actual 直接对比(不换父相对);x 命中 y/h 超容差 → 对应维度红', () => {
    const out = diffFlow(measured, expect1, 2);
    expect(out).toHaveLength(2);
    const a = out[0]!;
    expect(a.delta.dx).toBe(0);
    expect(a.delta.dy).toBe(-4);
    expect(a.delta.dh).toBe(8);
    expect(a.ok).toBe(false);
  });
  it('容差内全绿', () => {
    const out = diffFlow(measured, expect1, 10);
    expect(out.every(e => e.ok)).toBe(true);
  });
  it('节点缺失 → actual:null + NaN delta,ok:false', () => {
    const out = diffFlow(measured, [{ path: 'R/H/H_Flow/GONE', rect: { x: 0, y: 0, w: 1, h: 1 } }]);
    expect(out[0]!.actual).toBeNull();
    expect(out[0]!.delta.dy).toBeNaN();
    expect(out[0]!.ok).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/ui-layout-diff.test.ts`
Expected: FAIL(导入的 `flattenStyleTargets`/`diffStyles`/`diffFlow`/`STYLE_COLOR_TOL` 不存在)

- [ ] **Step 3: 实现**(追加到 `src/tools/ui/layout-diff.ts`;import 行改 `import type { UiNodeSpec, StyleBoxFlatSpec } from './types.js';`;`MeasuredNode` 接口加 `styles?: StyleReading[];`)

```ts
// ─── PR-2: style_verify / flow_verify(spec §4.1/§4.2)────────────────────────

/** measure 读回的单槽位样式(GD _walk 产出 JSON 形状;flat=false 时仅 type 有值)。 */
export interface StyleReading {
  path: string;
  slot: string;
  flat: boolean;
  type?: string;
  bg_color?: [number, number, number, number];
  corner_radius?: { tl: number; tr: number; br: number; bl: number };
  border_width?: { left: number; top: number; right: number; bottom: number };
  border_color?: [number, number, number, number];
}

/** style_verify 单条:逐槽位逐属性 diff(spec §4.1)。 */
export interface StyleDiffEntry {
  path: string;
  slot: string;
  field: string;
  target: number | number[] | string | null;
  actual: number | number[] | string | null;
  delta: number | number[] | null;
  ok: boolean;
}

/** Color float32 存储的序列化精度(实测 Godot 4.7.1:0.2 → 0.2000000029,
 * 集成用例 5 以 0.002 容差断言——见 test/integration/ui-import-integration.test.ts)。 */
export const STYLE_COLOR_TOL = 0.002;

export interface StyleTargetEntry { path: string; slot: string; box: StyleBoxFlatSpec }

/** expect 树 → stylebox 期望清单(path 链语义与 flattenTargets 同构,根级无前缀)。 */
export function flattenStyleTargets(tree: UiNodeSpec, prefix?: string): StyleTargetEntry[] {
  const selfPath = prefix ? `${prefix}/${tree.name}` : tree.name;
  const out: StyleTargetEntry[] = [];
  if (tree.styleboxes) {
    for (const sb of tree.styleboxes) out.push({ path: selfPath, slot: sb.slot, box: sb.box });
  }
  for (const c of tree.children ?? []) out.push(...flattenStyleTargets(c, selfPath));
  return out;
}

/** 期望清单 → measure 脚本的 path→slots 内嵌清单(GD 侧按需读回判定的并集左侧)。 */
export function styleExpectList(targets: StyleTargetEntry[]): Array<{ path: string; slots: string[] }> {
  const byPath = new Map<string, string[]>();
  for (const t of targets) {
    const arr = byPath.get(t.path) ?? [];
    if (!arr.includes(t.slot)) arr.push(t.slot);
    byPath.set(t.path, arr);
  }
  return [...byPath].map(([path, slots]) => ({ path, slots }));
}

const CORNER_FIELDS = [
  ['tl', 'corner_radius_top_left'],
  ['tr', 'corner_radius_top_right'],
  ['br', 'corner_radius_bottom_right'],
  ['bl', 'corner_radius_bottom_left'],
] as const;

const BORDER_FIELDS = [
  ['left', 'border_width_left'],
  ['top', 'border_width_top'],
  ['right', 'border_width_right'],
  ['bottom', 'border_width_bottom'],
] as const;

function colorDiff(
  path: string, slot: string, field: string, target: number[], actual: number[], tol: number,
): StyleDiffEntry {
  const delta = target.map((t, i) => (actual[i] ?? NaN) - t);
  const ok = delta.every(d => Math.abs(d) <= tol);
  return { path, slot, field, target, actual, delta, ok };
}

/** 目标(StyleBoxFlatSpec)vs 实测读回逐字段 diff。只比 box 中显式设置的字段
 * (缺省字段不比对——生成器同规则缺省不写);非 Flat 以单条 type 红条目暴露
 * (N-5:Label 未 override 的 normal 槽是 StyleBoxEmpty,读 bg_color 会崩/误判);
 * corner/border 宽度为整数属性精确匹配,颜色按 STYLE_COLOR_TOL(float32)。 */
export function diffStyles(
  readings: StyleReading[],
  targets: StyleTargetEntry[],
  colorTol: number = STYLE_COLOR_TOL,
): StyleDiffEntry[] {
  const byKey = new Map(readings.map(r => [`${r.path}/${r.slot}`, r]));
  const out: StyleDiffEntry[] = [];
  for (const t of targets) {
    const r = byKey.get(`${t.path}/${t.slot}`);
    if (!r) {
      // 节点不在测量集(路径不存在/超深/超 2000)——期望落空,显式红条目
      out.push({ path: t.path, slot: t.slot, field: '(reading missing)', target: null, actual: null, delta: null, ok: false });
      continue;
    }
    if (!r.flat) {
      out.push({ path: t.path, slot: t.slot, field: 'type', target: 'StyleBoxFlat', actual: r.type ?? '(non-flat)', delta: null, ok: false });
      continue;
    }
    // GD flat=true 时四组字段必全产出;防御性跳过缺失(不伪装成 diff 结果)
    if (t.box.bg_color !== undefined && r.bg_color) {
      out.push(colorDiff(t.path, t.slot, 'bg_color', [...t.box.bg_color], [...r.bg_color], colorTol));
    }
    if (t.box.corner_radius !== undefined && r.corner_radius) {
      const u = typeof t.box.corner_radius === 'number' ? t.box.corner_radius : undefined;
      const o = typeof t.box.corner_radius === 'object' ? t.box.corner_radius : {};
      for (const [k, field] of CORNER_FIELDS) {
        const tv = o[k] ?? u ?? 0;  // 与生成器 genStyleboxLines 同缺省(未指定角=0)
        const av = r.corner_radius[k]!;
        out.push({ path: t.path, slot: t.slot, field, target: tv, actual: av, delta: av - tv, ok: av === tv });
      }
    }
    if (t.box.border_width !== undefined && r.border_width) {
      for (const [k, field] of BORDER_FIELDS) {
        const tv = t.box.border_width;
        const av = r.border_width[k]!;
        out.push({ path: t.path, slot: t.slot, field, target: tv, actual: av, delta: av - tv, ok: av === tv });
      }
    }
    if (t.box.border_color !== undefined && r.border_color) {
      out.push(colorDiff(t.path, t.slot, 'border_color', [...t.box.border_color], [...r.border_color], colorTol));
    }
  }
  return out;
}

/** flow_verify(spec §4.2):flow 直接子层期望(输入视口绝对)vs measure 实测
 * (global rect,视口绝对)直接 diff——不做父相对换算(与 diffLayout 的关键差异,
 * 消解 B-2 盲区)。孙层不进(近似覆盖,纳入会产稳定系统性偏差报警=噪声)。 */
export function diffFlow(
  measured: MeasuredNode[],
  flowExpect: Array<{ path: string; rect: Rect }>,
  tolerancePx = 2,
): DiffEntry[] {
  const byPath = new Map(measured.map(m => [m.path, m]));
  return flowExpect.map(t => {
    const m = byPath.get(t.path);
    if (!m) {
      return { path: t.path, target: t.rect, actual: null,
        delta: { dx: NaN, dy: NaN, dw: NaN, dh: NaN }, ok: false };
    }
    const dx = m.rect.x - t.rect.x, dy = m.rect.y - t.rect.y;
    const dw = m.rect.w - t.rect.w, dh = m.rect.h - t.rect.h;
    const ok = Math.abs(dx) <= tolerancePx && Math.abs(dy) <= tolerancePx
      && Math.abs(dw) <= tolerancePx && Math.abs(dh) <= tolerancePx;
    return { path: t.path, target: t.rect, actual: m.rect, delta: { dx, dy, dw, dh }, ok };
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/ui-layout-diff.test.ts`
Expected: PASS(新增 3 describe 全绿,原有用例不回归)

- [ ] **Step 5: 提交**

```bash
git add src/tools/ui/layout-diff.ts test/ui-layout-diff.test.ts
git commit -m "feat(ui): style/flow diff 纯函数层(diffStyles/diffFlow/flattenStyleTargets)"
```

---

### Task 2: 翻译层——flow_expect 产出 + B-2 文案改写 + fill-only 灰底 warning(顺手项 3/4)

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\ui\prototype-import.ts`(TranslateResult 49-53 行 / buildSpec 276-397 / translateGeometry 401-443)
- Test: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\prototype-import.test.ts`(追加 describe;注意 600 行附近已有「fill 给非 ProgressBar」用例文案断言保持 contains 语义)

**Interfaces:**
- Consumes: 现有 `buildSpec`/`translateGeometry`/`uniqueName`/`ROOT_NAME`。
- Produces(Task 4 依赖):`TranslateResult` 新增 `flow_expect: Array<{ path: string; rect: Rect }>`——path 为最终树内路径(含 `_Flow` 容器层与 `uniqueName` 改名后的合成根名),rect 为**输入视口绝对坐标**。

- [ ] **Step 1: 写失败测试**(追加到 `test/prototype-import.test.ts` 末尾)

```ts
// ─── PR-2 Task 2: flow_expect 产出 + fill-only 灰底 warning ────────────────

describe('flow_expect(PR-2,spec §4.2)', () => {
  const geo = (nodes: unknown[]) => ({ viewport: { w: 1280, h: 720 }, nodes });

  it('flow 直接子节点 → flow_expect 条目(path 含 _Flow 层,rect 为输入视口绝对)', () => {
    const r = translateGeometry(geo([
      { name: 'Holder', rect: { x: 100, y: 100, w: 408, h: 40 }, flow: 'row', justify: 'space-between' },
      { name: 'BtnA', rect: { x: 100, y: 104, w: 72, h: 32 }, type: 'Button', text: 'A' },
      { name: 'BtnB', rect: { x: 268, y: 104, w: 72, h: 32 }, type: 'Button', text: 'B' },
    ]) as never);
    expect(r.flow_expect).toEqual([
      { path: '_PrototypeRoot/Holder/Holder_Flow/BtnA', rect: { x: 100, y: 104, w: 72, h: 32 } },
      { path: '_PrototypeRoot/Holder/Holder_Flow/BtnB', rect: { x: 268, y: 104, w: 72, h: 32 } },
    ]);
  });
  it('flow 孙层不进 flow_expect(仅直接子层);孙层 rect 照旧保留在树中', () => {
    const r = translateGeometry(geo([
      { name: 'F', rect: { x: 0, y: 0, w: 400, h: 100 }, flow: 'row' },
      { name: 'C1', rect: { x: 0, y: 0, w: 200, h: 100 } },
      { name: 'G1', rect: { x: 10, y: 10, w: 50, h: 30 }, text: 'g' },
    ]) as never);
    expect(r.flow_expect).toEqual([{ path: '_PrototypeRoot/F/F_Flow/C1', rect: { x: 0, y: 0, w: 200, h: 100 } }]);
    const c1 = r.tree.children![0]!.children![0]!.children![0]!;
    expect(c1.name).toBe('C1');
    expect(c1.children![0]!.rect).toBeDefined(); // 孙层保留 rect(近似覆盖)
  });
  it('嵌套 flow:内层 flow 直接子也进 flow_expect(path 全链)', () => {
    const r = translateGeometry(geo([
      { name: 'Outer', rect: { x: 0, y: 0, w: 400, h: 200 }, flow: 'row' },
      { name: 'Inner', rect: { x: 0, y: 0, w: 200, h: 200 }, flow: 'column' },
      { name: 'Leaf', rect: { x: 5, y: 5, w: 100, h: 30 }, text: 'x' },
    ]) as never);
    expect(r.flow_expect).toEqual([
      { path: '_PrototypeRoot/Outer/Outer_Flow/Inner', rect: { x: 0, y: 0, w: 200, h: 200 } },
      { path: '_PrototypeRoot/Outer/Outer_Flow/Inner/Inner_Flow/Leaf', rect: { x: 5, y: 5, w: 100, h: 30 } },
    ]);
  });
  it('合成根撞名改名时 path 用最终树名(禁硬编码 ROOT_NAME)', () => {
    const r = translateGeometry(geo([
      { name: '_PrototypeRoot', rect: { x: 0, y: 0, w: 1280, h: 720 }, flow: 'row' },
      { name: 'A', rect: { x: 0, y: 0, w: 50, h: 30 }, text: 'a' },
    ]) as never);
    expect(r.tree.name).toBe('_PrototypeRoot2');   // uniqueName 改名
    expect(r.flow_expect[0]!.path).toBe('_PrototypeRoot2/_PrototypeRoot/_PrototypeRoot_Flow/A');
  });
  it('无 flow → flow_expect 空数组', () => {
    const r = translateGeometry(geo([
      { name: 'A', rect: { x: 0, y: 0, w: 50, h: 30 }, text: 'a' },
    ]) as never);
    expect(r.flow_expect).toEqual([]);
  });
  it('B-2 warning 文案改为 flow_verify 数字覆盖措辞', () => {
    const r = translateGeometry(geo([
      { name: 'F', rect: { x: 0, y: 0, w: 400, h: 100 }, flow: 'row' },
      { name: 'C1', rect: { x: 0, y: 0, w: 200, h: 100 }, text: 'c' },
    ]) as never);
    const w = r.warnings.find(x => x.includes('flow'))!;
    expect(w).toContain('flow_verify');
    expect(w).toContain('直接子节点');
    expect(w).not.toContain('screenshot diff 兜底');
  });
});

describe('fill-only 灰底 warning(PR-2 顺手项 3/4,PR-1 终审转来)', () => {
  const geo = (nodes: unknown[]) => ({ viewport: { w: 800, h: 600 }, nodes });

  it('显式 Panel fill-only:fill 忽略 warning 追加默认主题灰底声明', () => {
    const r = translateGeometry(geo([
      { name: 'P', rect: { x: 0, y: 0, w: 100, h: 50 }, type: 'Panel', fill: '#3ddc84' },
    ]) as never);
    const w = r.warnings.find(x => x.includes('fill 仅 ProgressBar'))!;
    expect(w).toContain('灰底');
    expect(r.tree.children![0]!.styleboxes).toBeUndefined(); // 无 override 产出
  });
  it('推断布局壳 fill-only:同样灰底声明(透明壳被 fill 输入阻断)', () => {
    const r = translateGeometry(geo([
      { name: 'Shell', rect: { x: 0, y: 0, w: 100, h: 50 }, fill: '#3ddc84' },
    ]) as never);
    const w = r.warnings.find(x => x.includes('fill 仅 ProgressBar'))!;
    expect(w).toContain('灰底');
    expect(r.tree.children![0]!.properties!.self_modulate).toBeUndefined(); // 未设透明壳
  });
  it('fill+bg(显式 Panel):仅 fill 忽略 warning,无灰底声明(有 override 不灰底)', () => {
    const r = translateGeometry(geo([
      { name: 'P', rect: { x: 0, y: 0, w: 100, h: 50 }, type: 'Panel', bg: '#1a1f2e', fill: '#3ddc84' },
    ]) as never);
    const w = r.warnings.find(x => x.includes('fill 仅 ProgressBar'))!;
    expect(w).not.toContain('灰底');
  });
  it('fill-only Label:fill 忽略 warning 无灰底措辞(Label 默认主题透明,非灰底)', () => {
    const r = translateGeometry(geo([
      { name: 'L', rect: { x: 0, y: 0, w: 100, h: 30 }, text: 'x', fill: '#3ddc84' },
    ]) as never);
    const w = r.warnings.find(x => x.includes('fill 仅 ProgressBar'))!;
    expect(w).not.toContain('灰底');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/prototype-import.test.ts`
Expected: FAIL(`r.flow_expect` undefined;灰底文案不存在)

- [ ] **Step 3: 实现**

3a. `TranslateResult` 加字段(prototype-import.ts:49-53):

```ts
export interface TranslateResult {
  tree: UiNodeSpec;
  warnings: string[];
  coverage: { targets: number; total_nodes: number };
  /** PR-2(spec §4.2):flow 直接子节点期望清单——path 为最终树内路径(含 _Flow
   * 容器层与 uniqueName 改名后的合成根名),rect 为输入视口绝对坐标。 */
  flow_expect: Array<{ path: string; rect: Rect }>;
}
```

3b. `buildSpec` 加两个参数(签名 + 3 处递归调用点):

```ts
function buildSpec(
  node: WorkNode,
  parentAbs: { x: number; y: number },
  warnings: string[],
  taken: Set<string>,
  depth: number,
  pathPrefix: string,
  flowExpect: Array<{ path: string; rect: Rect }>,
): UiNodeSpec {
```

flow 分支(现 370-391 行)容器构造后追加收集:

```ts
    const container: UiNodeSpec = {
      type: flowType,
      name: uniqueName(`${node.cleanName}_Flow`, taken),
      anchor_preset: 'full_rect',
      layout: flowLayout,
      children: node.children.map(c => {
        // PR-2:flow 直接子层期望(视口绝对 rect;path=前缀/本节点/_Flow/子名)
        flowExpect.push({ path: `${pathPrefix}/${node.cleanName}/${container.name}/${c.cleanName}`, rect: c.spec.rect });
        const child = buildSpec(c, { x: abs.x, y: abs.y }, warnings, taken, depth + 2,
          `${pathPrefix}/${node.cleanName}/${container.name}`, flowExpect);
        delete child.rect;
        child.flex = { min_width: c.spec.rect.w, min_height: c.spec.rect.h };
        warnings.push(`flow 子节点 "${c.cleanName}": rect 尺寸映射为 flex.min_width/min_height(HUG 文本场景可能偏大)`);
        return child;
      }),
    };
```

普通子分支(现 393-395 行):

```ts
  if (node.children.length > 0) {
    spec.children = node.children.map(c => buildSpec(c, { x: abs.x, y: abs.y }, warnings, taken, depth + 1,
      `${pathPrefix}/${node.cleanName}`, flowExpect));
  }
```

3c. `translateGeometry` 主函数(现 420-442 行):`const flowExpect: Array<{ path: string; rect: Rect }> = [];` 顶层调用传 `rootName, flowExpect`;返回对象加 `flow_expect: flowExpect`;B-2 warning 文案改写:

```ts
  const warnings: string[] = [];
  const work = buildTree(geo, cleanNames);
  const taken = new Set(cleanNames);
  const flowExpect: Array<{ path: string; rect: Rect }> = [];

  // 合成根:透明 Panel 壳,rect=viewport(视口原点);名字与输入清洗名去重。
  const rootName = uniqueName(ROOT_NAME, taken);
  const tree: UiNodeSpec = {
    type: 'Panel',
    name: rootName,
    rect: { x: 0, y: 0, w: geo.viewport.w, h: geo.viewport.h },
    properties: { self_modulate: [1, 1, 1, 0] },
    children: work.map(w => buildSpec(w, { x: 0, y: 0 }, warnings, taken, 2, rootName, flowExpect)),
  };

  // B-2(2026-08-18 PR-2 改写):flow 直接子节点丢 rect 不受 layout_verify 覆盖——
  // 补偿防线从「screenshot diff 兜底」升级为 flow_verify 数字清单(消解 B-2 盲区)。
  const flowChildCount = countDroppedRects(work);
  if (flowChildCount > 0) {
    const coverage = { targets: flattenTargets(tree).length, total_nodes: geo.nodes.length };
    warnings.push(
      `flow 直接子节点共 ${flowChildCount} 个: layout_verify 不覆盖(丢 rect),由 flow_verify 数字覆盖(期望=输入视口 rect vs 容器排布实测 global rect,逐节点 Δx/Δy/Δw/Δh);孙层为近似覆盖(期望相对输入父原点,容器排布后天然带偏移)(verify_coverage.targets=${coverage.targets}/total_nodes=${coverage.total_nodes})`);
  }

  return { tree, warnings, coverage: { targets: flattenTargets(tree).length, total_nodes: geo.nodes.length }, flow_expect: flowExpect };
```

3d. fill-only 灰底 warning(现 337-339 行改写;顺手项 3/4):

```ts
    if (hasFill && type !== 'ProgressBar') {
      // PR-2 顺手项 3/4(PR-1 终审转来):fill-only(无 bg/border)时不产任何 override
      // 且推断布局壳的透明壳被阻断 → 默认主题渲染。Panel 系是灰底(Label 默认透明),
      // 显式声明让 AI 可见;fill+bg 时有 override 不灰底,不发灰底措辞。
      if (type === 'Panel' && !hasBg && !hasBorderish) {
        warnings.push(`节点 "${node.cleanName}": fill 仅 ProgressBar 支持,已忽略;且无 bg/border → 未产 stylebox override、未设透明壳(推断布局壳),将以默认主题灰底渲染——应有底色请显式给 bg`);
      } else {
        warnings.push(`节点 "${node.cleanName}": fill 仅 ProgressBar 支持,已忽略`);
      }
    }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/prototype-import.test.ts`
Expected: PASS(新增 2 describe 全绿;600 行既有「fill 仅 ProgressBar」断言为 contains 语义不受影响)

- [ ] **Step 5: 提交**

```bash
git add src/tools/ui/prototype-import.ts test/prototype-import.test.ts
git commit -m "feat(ui): 翻译层产出 flow_expect + fill-only 灰底 warning(顺手项3/4)"
```

---

### Task 3: GD 读回层——ui-measure.ts 样式按需读回 + ui-layout.ts M-2/M-5 校验

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\ui\ui-measure.ts`(genUiMeasureScript 全函数)
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\ui\ui-layout.ts`(validateUiNodeSpec 172-193 段)
- Test: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\ui-measure.test.ts`(追加)
- Test: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\ui-layout.test.ts`(追加)

**Interfaces:**
- Consumes: Task 1 的 `styleExpectList` 产出形态 `Array<{ path: string; slots: string[] }>`、`StyleReading`(TS 消费侧)。
- Produces(Task 4 依赖):`genUiMeasureScript(scenePath, nodePath?, maxDepth, styleExpect?: ReadonlyArray<{ path: string; slots: string[] }>)`——第 4 参可选,缺省/空数组时脚本行为与现状完全一致(向后兼容);有期望时 measure 输出 `nodes[i].styles`(期望清单 ∪ override 非空的节点)。

- [ ] **Step 1: 写失败测试**(追加到 `test/ui-measure.test.ts`)

```ts
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
```

(追加到 `test/ui-layout.test.ts` 末尾;M-2/M-5)

```ts
// ─── PR-2 Task 3: validate 层 M-2/M-5 校验(PR-1 终审顺手项) ────────────────

describe('validateUiNodeSpec styleboxes 补强校验(PR-2 M-2/M-5)', () => {
  const gen = (spec: unknown) => genUiBuildLayoutScript(spec as never, { w: 1280, h: 720 }, true);

  it('M-2:bg_color 非四元数组 → INVALID_PARAMS', () => {
    expect(() => gen({ type: 'Panel', name: 'P', styleboxes: [{ slot: 'panel', box: { bg_color: [0.1, 0.2, 0.3] } }] }))
      .toThrow('bg_color must be an array of exactly 4 finite numbers in [0,1]');
  });
  it('M-2:bg_color 值域外(1.5)→ INVALID_PARAMS', () => {
    expect(() => gen({ type: 'Panel', name: 'P', styleboxes: [{ slot: 'panel', box: { bg_color: [0, 0, 0, 1.5] } }] }))
      .toThrow('bg_color must be an array of exactly 4 finite numbers in [0,1]');
  });
  it('M-2:border_color 同款校验(非数组/含字符串)→ INVALID_PARAMS', () => {
    expect(() => gen({ type: 'Panel', name: 'P', styleboxes: [{ slot: 'panel', box: { border_color: 'red' as unknown as [number, number, number, number] } }] }))
      .toThrow('border_color must be an array of exactly 4 finite numbers in [0,1]');
    expect(() => gen({ type: 'Panel', name: 'P', styleboxes: [{ slot: 'panel', box: { border_color: [0, 0, 0, 'a' as unknown as number] } }] }))
      .toThrow('border_color must be an array of exactly 4 finite numbers in [0,1]');
  });
  it('M-2:合法四元 0-1 数组通过(负向护栏)', () => {
    expect(() => gen({ type: 'Panel', name: 'P', styleboxes: [{ slot: 'panel', box: { bg_color: [0, 0.5, 1, 1], border_color: [1, 1, 1, 0.5] } }] }))
      .not.toThrow();
  });
  it('M-5:corner_radius 布尔/null/数组 → INVALID_PARAMS(原先静默当 0)', () => {
    for (const bad of [true, null, [8, 8, 8, 8]]) {
      expect(() => gen({ type: 'Panel', name: 'P', styleboxes: [{ slot: 'panel', box: { corner_radius: bad as never } }] }))
        .toThrow('corner_radius must be a number or an object {tl,tr,br,bl}');
    }
  });
  it('M-5:合法 number 与对象形态通过(负向护栏)', () => {
    expect(() => gen({ type: 'Panel', name: 'P', styleboxes: [{ slot: 'panel', box: { corner_radius: 8 } }] })).not.toThrow();
    expect(() => gen({ type: 'Panel', name: 'P', styleboxes: [{ slot: 'panel', box: { corner_radius: { tl: 4 } }] })).not.toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/ui-measure.test.ts test/ui-layout.test.ts`
Expected: FAIL(新 describe 全红:parse_string/has_override 不存在;校验不抛)

- [ ] **Step 3: 实现 ui-measure.ts**

`genUiMeasureScript` 签名加第 4 参,模板三处扩展(完整新函数——`_initialize` 之前注入状态变量;`_walk` 的 `if n is Control:` 块内 entry 构造后追加读回段;顶部注入 `_all_slots`):

```ts
// ui_measure_layout:headless 整树 computed rect 测量。
// 执行链路(spec B-1 选型):executor 链(executeGdscriptTrusted),full-class extends
// SceneTree 脚本——gdscript-executor 对此类脚本走 injectHelpers 且不自动追加 _mcp_done,
// 因此可先 process_frame 等布局稳定再输出(随机 marker 由 executor replaceAll 注入)。
// 注意:SCENE_TREE_HEADER 的 _mcp_done() 已含 quit(0)(gdscript-templates.ts:138-141,
// 带 Engine.get_main_loop() 守卫),_emit 不再显式 quit,避免重复。
// maxDepth clamp 1-64;NaN/Infinity 回落默认 16,防生成 `depth > NaN` 非法 GDScript。
// PR-2(spec §4.1):styleExpect 期望清单(path→slots)内嵌为 JSON 字符串 + GD 侧
// parse(name 是任意字符串,禁裸拼 GD 字面量);读回判定 = 期望清单 ∪ has_theme_stylebox_override
// (I-B 拍板:并集左侧是期望——「override 没设上」的节点 has_override=false 也必须被读到,
// 以默认主题数值 diff 暴露;右侧补手写树/手动 override 场景)。

import { gdEscape, SCENE_TREE_HEADER } from '../shared.js';

export function genUiMeasureScript(
  scenePath: string,
  nodePath: string | undefined,
  maxDepth: number,
  styleExpect?: ReadonlyArray<{ path: string; slots: readonly string[] }>,
): string {
  const sp = gdEscape(scenePath);
  const np = nodePath ? gdEscape(nodePath) : '';
  const depth = Math.max(1, Math.min(64, Math.floor(Number.isFinite(maxDepth) ? maxDepth : 16)));
  const styleInit = styleExpect && styleExpect.length > 0
    ? `\tvar _se_parsed = JSON.parse_string("${gdEscape(JSON.stringify(Object.fromEntries(styleExpect.map(e => [e.path, [...e.slots]]))))}")\n\tvar _style_expect: Dictionary = _se_parsed if typeof(_se_parsed) == TYPE_DICTIONARY else {}\n`
    : '\tvar _style_expect: Dictionary = {}\n';
  return `${SCENE_TREE_HEADER}

const _all_slots := ["panel", "normal", "background", "fill", "hover", "pressed", "disabled"]

var _frames := 0
var _stable_count := 0
var _last_snapshot := ""
var _target: Node = null
var _count := 0

func _initialize():
${styleInit}\tif not _mcp_load_scene("${sp}"):
\t\t_mcp_done()
\t\treturn
\t_target = _mcp_scene_instance
${np ? `\tif "${np}" != "":
\t\tvar _n = _mcp_get_scene_node("${np}")
\t\tif _n == null:
\t\t\t_mcp_output("error", "Node not found: ${np}")
\t\t\t_mcp_done()
\t\t\treturn
\t\t_target = _n` : ''}
\tprocess_frame.connect(_on_measure_frame)

func _on_measure_frame() -> void:
\t_frames += 1
\tvar snap := _snapshot()
\tif snap == _last_snapshot:
\t\t_stable_count += 1
\telse:
\t\t_stable_count = 0
\t\t_last_snapshot = snap
\tif _stable_count >= 2 or _frames >= 5:
\t\tprocess_frame.disconnect(_on_measure_frame)
\t\t_emit()

func _snapshot() -> String:
\tvar parts: Array = []
\t_snap_walk(_target, 0, parts)
\treturn ";".join(parts)

func _snap_walk(n: Node, depth: int, parts: Array) -> void:
\tif depth > ${depth} or _count >= 2000:
\t\treturn
\tif n is Control:
\t\tvar c := n as Control
\t\tparts.append("%d,%d,%d,%d" % [int(c.global_position.x), int(c.global_position.y), int(c.size.x), int(c.size.y)])
\t\t_count += 1
\tfor ch in n.get_children():
\t\t_snap_walk(ch, depth + 1, parts)

func _emit() -> void:
\tvar nodes: Array = []
\t_count = 0
\t_walk(_target, 0, nodes)
\t# C1(M-a/M-b): stalled = 5 帧上限内未达到 2 帧稳定快照;viewport 作为 layout_verify
\t# 根级 rect 的参照系。注意用 content_scale_size 而非 Window.size / get_visible_rect()——
\t# headless --script 模式下 Window 实际尺寸不反映 project 设置(实测 100x100/2496x?),
\t# content_scale_size 才是 display/window/size 的直接映射(实测 1280x720)。
\tvar _vp := root.content_scale_size
\t_mcp_output("measure", JSON.stringify({
\t\t"stable_after_frames": _frames,
\t\t"stalled": _frames >= 5 and _stable_count < 2,
\t\t"viewport": {"w": _vp.x, "h": _vp.y},
\t\t"nodes": nodes}))
\t_mcp_done()

func _walk(n: Node, depth: int, nodes: Array) -> void:
\tif depth > ${depth} or _count >= 2000:
\t\treturn
\tif n is Control:
\t\tvar c := n as Control
\t\tvar entry := {
\t\t\t"path": str(_target.get_path_to(n)),
\t\t\t"type": n.get_class(),
\t\t\t"rect": {"x": c.global_position.x, "y": c.global_position.y, "w": c.size.x, "h": c.size.y},
\t\t\t"anchors": {"left": c.anchor_left, "right": c.anchor_right, "top": c.anchor_top, "bottom": c.anchor_bottom},
\t\t\t"offsets": {"left": c.offset_left, "right": c.offset_right, "top": c.offset_top, "bottom": c.offset_bottom},
\t\t\t"visible": c.is_visible_in_tree(),
\t\t}
\t\tif "text" in n:
\t\t\tentry["text"] = str(n.get("text"))
\t\t# PR-2:style 按需读回(期望清单 ∪ override 非空;spec §4.1)
\t\tvar _slots: Array = []
\t\tfor s in _style_expect.get(entry["path"], []):
\t\t\t_slots.append(str(s))
\t\tfor s in _all_slots:
\t\t\tif c.has_theme_stylebox_override(s) and not _slots.has(s):
\t\t\t\t_slots.append(s)
\t\tif _slots.size() > 0:
\t\t\tvar _styles: Array = []
\t\t\tfor s in _slots:
\t\t\t\tvar _sb = c.get_theme_stylebox(s)
\t\t\t\tvar _e := {"slot": s}
\t\t\t\tif _sb is StyleBoxFlat:
\t\t\t\t\tvar _f := _sb as StyleBoxFlat
\t\t\t\t\t_e["flat"] = true
\t\t\t\t\t_e["bg_color"] = [_f.bg_color.r, _f.bg_color.g, _f.bg_color.b, _f.bg_color.a]
\t\t\t\t\t_e["corner_radius"] = {"tl": _f.corner_radius_top_left, "tr": _f.corner_radius_top_right, "br": _f.corner_radius_bottom_right, "bl": _f.corner_radius_bottom_left}
\t\t\t\t\t_e["border_width"] = {"left": _f.border_width_left, "top": _f.border_width_top, "right": _f.border_width_right, "bottom": _f.border_width_bottom}
\t\t\t\t\t_e["border_color"] = [_f.border_color.r, _f.border_color.g, _f.border_color.b, _f.border_color.a]
\t\t\t\telse:
\t\t\t\t\t_e["flat"] = false
\t\t\t\t\t_e["type"] = _sb.get_class()
\t\t\t\t_styles.append(_e)
\t\t\tentry["styles"] = _styles
\t\tnodes.append(entry)
\t\t_count += 1
\tfor ch in n.get_children():
\t\t_walk(ch, depth + 1, nodes)
`;
}
```

> 实现注意:①`styleInit` 注入在 `_initialize()` 首行(场景 load 之前,字典准备好即可);②`_style_expect.get(key, [])` 用 GD 4 Dictionary.get 默认值语法;③`_slots.has(s)` 是 Array.has(GD 4 存在);④JSON.stringify 的 slots 数组经 parse 后是 Array,`for s in` 迭代 ✓。

- [ ] **Step 4: 实现 ui-layout.ts M-2/M-5 校验**(validateUiNodeSpec 的 styleboxes 段,border_width 校验后追加)

```ts
      // PR-2 M-2(PR-1 终审转来):bg_color/border_color 四元 number 数组对称校验
      // (无注入向量——colorToGd 只认数组形态,坏输入原先在生成层静默/产出错行;
      // 此处早拒提升 INVALID_PARAMS 质量)
      for (const key of ['bg_color', 'border_color'] as const) {
        const c = b[key];
        if (c !== undefined) {
          const bad = !Array.isArray(c) || c.length !== 4
            || c.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1);
          if (bad) {
            throw new Error(`INVALID_PARAMS: styleboxes ${key} must be an array of exactly 4 finite numbers in [0,1]`);
          }
        }
      }
      // PR-2 M-5:corner_radius 布尔/null/数组原先静默当 0(Object.values(布尔)=[] 空过,
      // 生成器 `typeof object` 分支产 {} → 四角全 0)——显式拒
      if (b.corner_radius !== undefined && typeof b.corner_radius !== 'number'
        && (typeof b.corner_radius !== 'object' || b.corner_radius === null || Array.isArray(b.corner_radius))) {
        throw new Error('INVALID_PARAMS: styleboxes corner_radius must be a number or an object {tl,tr,br,bl}');
      }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run test/ui-measure.test.ts test/ui-layout.test.ts`
Expected: PASS(新 describe 全绿;`ui-import-prototype.test.ts` 的 measure mock 输出若无 styles 字段不受影响——styles 是可选字段)

- [ ] **Step 6: 提交**

```bash
git add src/tools/ui/ui-measure.ts src/tools/ui/ui-layout.ts test/ui-measure.test.ts test/ui-layout.test.ts
git commit -m "feat(ui): measure 脚本样式按需读回 + validate 层 M-2/M-5 校验"
```

---

### Task 4: 接线层——import 链/measure case 挂 style_verify 与 flow_verify

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\ui\index.ts`(import 行 17 / measure case 450-459 / 注入段 479-506 / handleUiImportPrototype 636/663-689 / description 30 行 / `_note` 676)
- Test: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\ui-import-prototype.test.ts`(已有 vi.mock executor 的 handler 级测试,追加)

**Interfaces:**
- Consumes: Task 1 `flattenStyleTargets`/`styleExpectList`/`diffStyles`/`diffFlow`/`StyleReading`;Task 2 `TranslateResult.flow_expect`;Task 3 `genUiMeasureScript` 第 4 参。
- Produces: `ui_import_prototype` 返回 data 新增 `style_verify: StyleDiffEntry[]` 与 `flow_verify: DiffEntry[]`;`ui_measure_layout`(expect_tree 时)data 新增 `style_verify`。

- [ ] **Step 1: 写失败测试**(追加到 `test/ui-import-prototype.test.ts`;复用该文件既有的 executor mock 模式——先读该文件 15-95 行的 mock 形态,按同样方式让 executeGdscriptTrusted 按调用序返回 build 输出与 measure 输出两次)

测试要点(写完整代码,measure mock 的 nodes/styles 按 GD 产出真实形状——memory 教训「mock 全绿≠真实契约」):

```ts
// ─── PR-2 Task 4: import 链 style_verify/flow_verify 接线 ───────────────────

describe('ui_import_prototype 返回 style_verify/flow_verify(PR-2)', () => {
  // mock 形态照该文件既有 setup:executeGdscriptTrusted 第 1 次调用返回 build 输出
  // ({data:{persist:{saved:true},warnings:[]}}),第 2 次返回 measure 输出——nodes 含
  // stylebox 期望节点的 styles 字段(GD _walk 产出真实形状,非臆测字段)。
  // geometry:Card(Panel bg+radius)+ Holder(flow row)→ BtnA(flow 直接子)。
  // measure mock:
  //   nodes = [
  //     { path: '_PrototypeRoot', rect: {x:0,y:0,w:800,h:600}, type: 'Panel' },
  //     { path: '_PrototypeRoot/Card', rect: {x:40,y:40,w:320,h:200}, type: 'Panel',
  //       styles: [{ slot: 'panel', flat: true, bg_color: [0.102, 0.122, 0.18, 1],
  //         corner_radius: {tl:12,tr:12,br:12,bl:12}, border_width: {left:2,top:2,right:2,bottom:2},
  //         border_color: [0.24, 0.863, 0.518, 1] }] },   // float32 漂移级差异 → 绿
  //     { path: '_PrototypeRoot/Holder', rect: {x:0,y:300,w:400,h:40}, type: 'Panel' },
  //     { path: '_PrototypeRoot/Holder/Holder_Flow', rect: {x:0,y:300,w:400,h:40}, type: 'HBoxContainer' },
  //     { path: '_PrototypeRoot/Holder/Holder_Flow/BtnA', rect: {x:100,y:304,w:72,h:32}, type: 'Button' },
  //   ]
  // 断言:
  //   1. style_verify 全绿且含 Card/panel 的 bg_color 条目(field 'bg_color',delta ≤0.002);
  //   2. flow_verify 含 1 条 BtnA(target=输入视口 rect {100,304,72,32},actual 直接对比,ok:true);
  //   3. verify_coverage._note 含 'flow_verify' 措辞(不再只说 screenshot diff 兜底);
  //   4. measure 脚本生成参数含期望清单(mock 捕获第 2 次调用的 code,
  //      toContain 'JSON.parse_string' 与 'Holder_Flow');
  //   5. 无 stylebox 无 flow 的 geometry → style_verify=[] 且 flow_verify=[]。
  // 另一组负向:styles 缺失(override 没设上场景)→ mock 节点无 styles 字段
  //   → style_verify 出 '(reading missing)' 红条目。
});
```

> 执行者按上述要点展开完整测试代码(mock 序列形状必须从该文件既有 setup 复制改造,断言值按要点逐条落实)。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/ui-import-prototype.test.ts`
Expected: FAIL(style_verify/flow_verify 字段不存在)

- [ ] **Step 3: 实现**(index.ts 五处)

3a. import 行(17 行旁):

```ts
import { flattenTargets, flattenStyleTargets, styleExpectList, diffLayout, diffStyles, diffFlow, detectOverlaps, detectOutOfBounds } from './layout-diff.js';
```

3b. `ui_measure_layout` case(458 行):

```ts
        const styleExpect = expectTree ? styleExpectList(flattenStyleTargets(expectTree)) : undefined;
        script = genUiMeasureScript(scenePath, nodePathRaw ? normalizeNodePath(nodePathRaw) : undefined, maxDepth, styleExpect);
```

3c. 注入段(491-501 行,layout_verify 组装旁):

```ts
          const measured = measure?.nodes ?? [];
          const targets = flattenTargets(expectTree);
          // PR-2:expect_tree 同构复用 style_verify(spec §4.1 挂两处之二)
          const styleReadings = measured.flatMap(n => (n.styles ?? []).map(s => ({ path: n.path, ...s })));
          const wrapped = {
            targets,
            diff: diffLayout(measured, targets, 2),
            overlaps: detectOverlaps(measured),
            out_of_bounds: detectOutOfBounds(measured),
            viewport: measure?.viewport,
          };
          const merged = { ...parsed, data: { ...parsed.data, layout_verify: wrapped,
            style_verify: diffStyles(styleReadings, flattenStyleTargets(expectTree)) } };
```

3d. `handleUiImportPrototype`:measure 调用(636 行)与组装(663-689 行):

```ts
  // ② measure(第二次 spawn):nodePath=挂载父节点……PR-2:styleExpect 期望清单内嵌
  //   (I-B 拍板:并集左侧,override 没设上的节点也必须被读到)。
  const styleTargets = flattenStyleTargets(translated.tree);
  const measureScript = genUiMeasureScript(scenePath, parentPath, 16, styleExpectList(styleTargets));
```

组装段(665 行后):

```ts
    const measure = measureOut.data?.measure;
    const measured = measure?.nodes ?? [];
    const targets = flattenTargets(translated.tree);
    const layoutVerify = { /* 现状不动 */ };
    // PR-2:style_verify(逐槽位样式 diff)+ flow_verify(flow 直接子层数字清单)
    const styleReadings = measured.flatMap(n => (n.styles ?? []).map(s => ({ path: n.path, ...s })));
    const styleVerify = diffStyles(styleReadings, styleTargets);
    const flowVerify = diffFlow(measured, translated.flow_expect, tolerance);
    const verifyCoverage = {
      ...translated.coverage,
      _note: 'targets 为受 layout_verify 几何覆盖的节点数(含合成根 _PrototypeRoot,无 flow 时 = 输入节点数+1);flow 直接子节点丢 rect 不在 layout_verify 覆盖内,由 flow_verify 数字覆盖(期望=输入视口 rect);孙层为近似覆盖',
    };
    return textResult(JSON.stringify(opsSuccess({
      tree: translated.tree,
      build_warnings: buildWarnings,
      measure: { /* 现状不动 */ },
      verify_coverage: verifyCoverage,
      layout_verify: layoutVerify,
      style_verify: styleVerify,
      flow_verify: flowVerify,
      persist: buildOut.data?.persist,
    }, measureOut.warnings ?? [])));
```

3e. 工具 description(30 行)原型段追加返回说明:

```
原型: ui_import_prototype(几何 JSON 一次调用翻译+构建+测量+校验+持久化;bg/fill/borderRadius/border→StyleBoxFlat,落盘 theme_override_styles/<slot>;返回 style_verify 逐槽位样式 diff/flow_verify flow 直接子层 rect diff)
```

3f. module-loader SLIM descHint(`src/core/module-loader.ts:229`)ui_import_prototype 段追加 `→ 返回 style_verify/flow_verify`(提交后跑 check:budget 验证)。

- [ ] **Step 4: 跑测试确认通过 + 全量回归**

Run: `npx vitest run test/ui-import-prototype.test.ts && npm test`
Expected: PASS 全绿

- [ ] **Step 5: 提交**

```bash
git add src/tools/ui/index.ts src/core/module-loader.ts test/ui-import-prototype.test.ts
git commit -m "feat(ui): import 链/measure 挂 style_verify+flow_verify 接线"
```

---

### Task 5: 双副本同步 + M-1 降级声明 + 版本 + CHANGELOG + matrix/budget

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\.claude\rules\godot-mcp-ui.md`(:130 字段清单 border 措辞 / :136 返回行 / :139 verify_coverage 段 / 新增 style_verify·flow_verify 要点段)
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\rule-templates.ts`(:612-621 对应镜像段,逐字同步,反引号转义 `` \` ``)
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\package.json`(version 0.32.1)
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\CHANGELOG.md`(顶部新增 0.32.1 段)
- 生成: `docs/capability-matrix.{json,md}`(`npm run build-matrix`,不手改)

**Interfaces:**
- Consumes: Task 1-4 的最终行为(diff 形状/容差/挂载点)。
- Produces: 规则双副本逐字一致(`STRICT=1 npm run check:rules-sync` 绿)。

- [ ] **Step 1: 改 `.claude/rules/godot-mcp-ui.md` 四处**(两文件同步,以下为 ui.md 侧措辞;rule-templates.ts 侧同段逐字镜像 + 反引号转义)

1. 字段清单段 border 措辞(M-1 降级声明):
   旧:「`border`(`{width,color}` 统一四边,CSS 四边不同时取 top)」
   新:「`border`(`{width,color}` 统一四边,CSS 四边不同时取 top;**四边各异不单独 warning**——生产者仅取 top,其余三边差异静默,最终以 style_verify 数值暴露)」

2. 「返回」行:
   旧:`**返回**:\`{ tree, build_warnings, measure: {stable_after_frames, stalled, viewport}, verify_coverage, layout_verify: {targets, diff, overlaps, out_of_bounds, viewport}, persist }\`。`
   新:`**返回**:\`{ tree, build_warnings, measure: {stable_after_frames, stalled, viewport}, verify_coverage, layout_verify: {targets, diff, overlaps, out_of_bounds, viewport}, style_verify, flow_verify, persist }\`。`

3. verify_coverage 段:
   旧末句:「**flow 直接子节点丢 rect、不在覆盖内**——flow 子树(spacer/min_size/justify 映射)出错时 verify 仍绿,唯一补偿防线是 \`screenshot(action=diff)\` 像素验收。」
   新末句:「**flow 直接子节点丢 rect、不在 layout_verify 覆盖内——由 \`flow_verify\` 数字覆盖**(期望=输入视口 rect vs 容器排布实测 global rect,逐节点 Δx/Δy/Δw/Δh;孙层为近似覆盖,期望相对输入父原点,容器排布后天然带偏移)。」

4. 新增要点段(紧随 verify_coverage 段后):

```
- **style_verify(逐槽位样式 diff)**:`ui_import_prototype` 返回与 `ui_measure_layout`(expect_tree 时)均挂;对「期望清单内节点 ∪ 槽位 override 非空节点」按需读回 `get_theme_stylebox(slot)`(override 优先、回落默认主题——**override 没设上时以默认主题数值 diff 暴露**);非 StyleBoxFlat(如 Label 未 override 的 normal 槽 StyleBoxEmpty)以 type 红条目暴露、不进字段 diff;仅比 box 显式设置的字段,颜色容差 0.002(Color float32 精度)、corner/border 宽度精确匹配。
- **flow_verify 容差语义**:直接子层 Δ 的合理阈值可大于几何 verify 的 2px(HTML flex 默认 align stretch vs Godot size_flags 默认 fill 的固有数值差)——偏差即价值,暴露后按 Δ 在原型侧修或加 size_flags;`tolerance` 参数同款可调。
```

- [ ] **Step 2: 同步 `src/tools/rule-templates.ts` 镜像段**(同措辞;该文件内反引号写作 `` \` ``;改后必跑门禁)

- [ ] **Step 3: 版本 bump + CHANGELOG**

```bash
npm version patch --no-git-tag-version   # 0.32.0 → 0.32.1
```

CHANGELOG 顶部新增(格式照 0.32.0 段惯例):

```markdown
## [0.32.1] - 2026-08-18

### Added — 原型翻译层 verify 层(style_verify + flow_verify,PR-2)

- **style_verify(逐节点逐槽位逐属性 diff)**:`ui_import_prototype` 返回与 `ui_measure_layout`(expect_tree 时)新增 `style_verify: [{path, slot, field, target, actual, delta, ok}]`——measure 脚本按需读回(期望清单 ∪ `has_theme_stylebox_override` 并集,期望清单 TS 侧序列化内嵌防「override 没设上被静默架空」)`get_theme_stylebox(slot)` 生效值;非 StyleBoxFlat(如 Label 未 override 的 StyleBoxEmpty)以 type 红条目暴露;颜色容差 0.002(Color float32 精度)。
- **flow_verify(消解上轮 B-2 盲区)**:`TranslateResult` 产出 `flow_expect`(flow 直接子节点最终树路径 + 输入视口绝对 rect,合成根改名后实际名字),import 链与 measure 实测 global rect 直接 diff → `flow_verify: [{path, target, actual, delta, ok}]`;B-2 补偿防线从「screenshot diff 兜底」升级为数字清单;孙层维持近似覆盖(防系统性偏差噪声)。
- **validate 层补强(PR-1 终审 M-2/M-5)**:`bg_color`/`border_color` 四元 number 数组对称校验;`corner_radius` 布尔/null/数组显式拒(原先静默当 0)。
- **fill-only 灰底 warning(PR-1 终审顺手项 3/4)**:显式 Panel/推断布局壳 fill-only(无 bg/border)时声明将以默认主题灰底渲染(透明壳被 fill 输入阻断);fill+bg 场景不误报。
- **M-1 border 降级声明**:border 四边各异不单独 warning(生产者仅取 top),规则双副本显式声明。
```

- [ ] **Step 4: 跑门禁**

```bash
npm run build && STRICT=1 npm run check:rules-sync && npm run build-matrix && npm run check:budget && npm run version-check
```
Expected: 全绿(9 模板一致 / budget 0 err / version 0.32.1)

- [ ] **Step 5: 提交**

```bash
git add .claude/rules/godot-mcp-ui.md src/tools/rule-templates.ts package.json package-lock.json CHANGELOG.md docs/capability-matrix.json docs/capability-matrix.md
git commit -m "docs(ui): 双副本 flow_verify/style_verify 规则 + M-1 声明 + v0.32.1"
```

---

### Task 6: 集成验收(Windows 真跑 Godot,spec §7/§11.3 教训:生成快照不可替代)

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\integration\ui-import-integration.test.ts`(用例 2 改写 / 用例 4 扩展 / 用例 6 扩展 / 新增用例 7)

**Interfaces:**
- Consumes: Task 1-4 全链路;`GODOT_PATH` 环境变量。
- Produces: 实测校准记录(flow_verify 直接子层实测 delta 固化断言,spec §10.5 开放问题的决策输入)。

- [ ] **Step 1: 用例 2 改写——flow_verify 断言**(parse 类型加 `flow_verify: Array<{path,target,actual,delta,ok}>`)

断言要点:
1. `flow_verify` 3 条,path 为 `_PrototypeRoot/Holder/Holder_Flow/Btn{A,B,C}`;
2. `target` = 输入视口 rect(100/268/436, y=104, 72x32);
3. **x 方向精确**(dx≈0——space-between 排布与输入一致,既有 gap 96 断言同源);
4. **y/h 校准循环**:首跑 `console.log(JSON.stringify(flow_verify))` 观察实测(HBox 子节点垂直 size_flags 默认 fill → 预期 stretch 到容器高 40,即 dy≈-4/dh≈+8;以实测为准),跑红→修绿固化实测值断言;若系统性偏差存在,注释声明「HTML align 语义 vs Godot fill 的固有偏差,flow_verify 如实暴露(spec §4.2 偏差即价值),修正属原型侧/后续翻译规则」——**不伪装全绿**;
5. 用例 2 现有 `targets===2` 断言保留(覆盖率语义不变)。

- [ ] **Step 2: 用例 4 扩展——style_verify 全绿断言**

parse 类型加 `style_verify: Array<{path,slot,field,target,actual,delta,ok}>`。断言:
1. `style_verify.every(e => e.ok)` 全绿(override 全部落盘生效——**这正是「生成快照全绿≠引擎行为」的数字防线**);
2. 抽查 CardBg/panel 的 `bg_color` 条目 target `[0.102, 0.122, 0.18, 1]`(归一 #1a1f2e)delta 分量 ≤0.002;
3. 抽查 `corner_radius_top_left`(target 12)与 `border_width_left`(target 2)全等;
4. BorderOnly(无 bg)不产 bg_color 条目、HpBar 有 background+fill 两槽各 1 条 bg_color;
5. 条目计数护栏:`style_verify` 总长 = 34(CardBg 11 + Title 6 + TagChip 6 + BorderOnly 9 + HpBar 2;fixture 变更须同步,照用例 1 的 23 节点护栏先例)。

- [ ] **Step 3: 用例 6 扩展——三组合 style_verify(端到端验证 override 真设上)**

`runCombo` 的 parsed 增加:
- bg-only:style_verify 含 background 槽 bg_color 绿条目(target = #223022 归一值);
- fill-only:style_verify **只有** fill 槽 1 条绿(target = #3ddc84 归一值)——同时验证「期望清单只含产出槽」(fill-only 翻译不产 background override,style_expect 不含它);
- bg+fill:两条(background+fill)全绿。

- [ ] **Step 4: 新增用例 7——手写树 override 并集条件(spec §4.1 右侧)**

临时项目 `ui_build_layout`(persist,tree 带 `styleboxes`)→ `genUiMeasureScript`(第 4 参 **undefined**,executor 层直调)→ measure nodes 中该节点 `styles` 含 override 槽(flat=true)——验证无期望清单时 override 非空节点也被读到(手写树场景)。

- [ ] **Step 5: 跑集成 + 全量**

```bash
# 需 GODOT_PATH 环境变量
npx vitest run test/integration/ui-import-integration.test.ts && npm test
```
Expected: PASS(校准循环按实测固化;集成耗时记录随测试输出留档)

- [ ] **Step 6: 提交**

```bash
git add test/integration/ui-import-integration.test.ts
git commit -m "test(ui): PR-2 集成验收 flow_verify/style_verify 实测校准"
```

---

### Task 7: 收尾——全门禁 + 第三方审查 + memory + ledger

**Files:**
- Create: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\docs\reviews\2026-08-18-prototype-stylebox-pr2.md`
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\.superpowers\sdd\progress.md`(交接行)

- [ ] **Step 1: 全量门禁独立复跑**

```bash
npm run lint && npm run build && npm test && STRICT=1 npm run check:rules-sync && npm run build-matrix && npm run diff-matrix && npm run check:budget && npm run version-check
```
Expected: 全绿,贴输出

- [ ] **Step 2: 派 code-reviewer 子代理独立审查**(隔离视角;审查范围照 AGENTS.md「plan 落地后必出第三方审查文档」——含仓库级约束独立核查:rule-templates 同步/matrix/build/budget/version,不只对照本 plan §改动面打勾);归档 `docs/reviews/2026-08-18-prototype-stylebox-pr2.md`(判定 + 逐维度 file:line 证据 + Blocking/Nits)。

- [ ] **Step 3: 审查意见处置**(BLOCKING/Important 必修;Nit triage 留档或顺手修)

- [ ] **Step 4: memory 登记**(`feature-decision-log: stylebox-verify-pr2`:commit 清单/关键决策含被拒方案/I-B 按需读回机制/实测校准数据/deferred 项) + Obsidian 开发日志(`D:\workspace\Obsidian\GodotMCP\开发日志\2026-08-18 PR-2 verify 层.md`)。

- [ ] **Step 5: ledger 交接行 + push**

`.superpowers/sdd/progress.md` 追加 PR-2 收尾段(状态/commit/审查判定/挂账);push 分支开 PR(标题 `feat(ui): PR-2 verify 层 style_verify+flow_verify`,描述含改了什么/为什么/怎么验证)。**PR merge 留用户**(PR-1 惯例)。

---

## Self-Review 记录

- **Spec 覆盖**:§4.1 style_verify → Task 1/3/4;§4.2 flow_verify → Task 1/2/4;§8 PR-2 批次行(measure/diff/接线/翻译器/双副本/测试改写/matrix/CHANGELOG/门禁)→ Task 1-7 逐行对应;§7 测试策略(翻译单测/生成器单测/集成校准/跨批次演进)→ Task 2/3/6;5 条顺手项 → Task 2(3/4)、Task 3(M-2/M-5)、Task 5(M-1);§10.5 flow 容差 → Task 6 Step 1 校准循环。无遗漏。
- **类型一致性**:`StyleReading`/`StyleDiffEntry`/`StyleTargetEntry`/`flow_expect` 形态在 Task 1(定义)/Task 3(GD 产出 JSON)/Task 4(消费)三处一致;`genUiMeasureScript` 第 4 参 `ReadonlyArray<{ path: string; slots: readonly string[] }>` 与 `styleExpectList` 返回 `Array<{ path: string; slots: string[] }>` 兼容。
- **占位符扫描**:Task 4 Step 1 测试给的是要点展开式(既有 mock setup 复制改造,断言逐条落实)——执行者须先读该文件 15-95 行既有 mock 形态再写,不属 TBD;其余任务代码完整。
