# PR-1 StyleBox 通道 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** proto JSON 的 `bg/fill/borderRadius/border` 翻译为真正的 StyleBoxFlat(替代 modulate 近似),覆盖 Panel/ProgressBar/Button/Label 四类控件槽位,含 evaluate 取数模板扩展与规则双副本同步。

**Architecture:** 三层改动:类型层(`types.ts` 加 `styleboxes` 字段 + slot 枚举白名单校验)→ 翻译层(`prototype-import.ts` 规则 9 重写,modulate 通道删除)→ 生成器层(`ui-layout.ts` 拼 `StyleBoxFlat.new()` 构造块,变量名复用 nextId)。样式槽位走 UiNodeSpec 独立字段,`properties`/`valueToGd` 不动。

**Tech Stack:** TypeScript(ES2022/strict/ESM,import 带 `.js` 扩展名)、zod v4、Vitest、GDScript(Godot 4.5-4.7)。

**Spec:** `docs/superpowers/specs/2026-08-17-prototype-stylebox-loop-design.md` §3(PR-1 范围),§10 开放问题 1/3/4。

## Global Constraints

- **语言**:所有自然语言输出(测试描述/警告文案/注释)用简体中文;代码标识符英文。
- **ESLint 零警告**:禁 `any`(`@typescript-eslint/no-explicit-any: error`)、未使用变量 error(参数前缀 `_` 豁免)、`prefer-const`。
- **ESM**:import 必须带 `.js` 扩展名(`./types.js`)。
- **版本**:`package.json` 0.31.4 → **0.32.0**(minor,BREAKING:bg 语义变更;命令 `npm version minor --no-git-tag-version`)。
- **双副本约束**:凡改 `.claude/rules/godot-mcp-*.md`,必须同步 `src/tools/rule-templates.ts` 对应镜像段;核验 `STRICT=1 npm run check:rules-sync`(需先 `npm run build`)。
- **完成门禁**(每任务提交前):`npm run lint` + `npm run build` + `npm test` 全绿;本 PR 结束追加 `STRICT=1 npm run check:rules-sync` + `npm run build-matrix` + `npm run check:budget`。
- **测试超时**:单测默认 10000ms;集成测试需 `GODOT_PATH` 环境变量 + Windows(`describe.skipIf(!run)`,run = `!!GODOT_PATH && win32`)。
- **颜色格式**:`#rrggbb` / `[r,g,b]` 0-255 / `[r,g,b,a]` 0-1 三种,归一由 `normalizeColor` 处理。
- **禁改**:`build/`、`docs/capability-matrix.*`(生成产物,走 `npm run build-matrix`)、`package-lock.json`。

---

### Task 1: 类型层——StyleBoxSlot/StyleBoxFlatSpec + validateUiNodeSpec 校验

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\ui\types.ts`(UiNodeSpec 定义在 92-101 行)
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\ui\ui-layout.ts`(validateUiNodeSpec 在 153-177 行)
- Test: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\ui-layout.test.ts`

**Interfaces:**
- Consumes: 现有 `UiNodeSpec`(types.ts:92-101)、`colorToGd`(types.ts:121-126,Task 3 用)。
- Produces(Task 2/3 依赖,签名必须一字不差):
  - `export type StyleBoxSlot = 'panel' | 'normal' | 'background' | 'fill' | 'hover' | 'pressed' | 'disabled';`
  - `export const STYLEBOX_SLOTS: readonly StyleBoxSlot[]`(七值白名单)
  - `export interface StyleBoxFlatSpec { bg_color?: [number, number, number, number]; corner_radius?: number | { tl?: number; tr?: number; br?: number; bl?: number }; border_width?: number; border_color?: [number, number, number, number]; draw_center?: boolean; }`
  - `export interface StyleBoxOverride { slot: StyleBoxSlot; box: StyleBoxFlatSpec }`
  - `UiNodeSpec.styleboxes?: StyleBoxOverride[]`

- [ ] **Step 1: 写失败测试**(追加到 `test/ui-layout.test.ts` 末尾;该文件已有 genUiBuildLayoutScript 相关 describe,直接追加新 describe)

```ts
// ─── PR-1 Task 1: styleboxes 类型层校验 ────────────────────────────────────

describe('validateUiNodeSpec styleboxes 校验(PR-1)', () => {
  const call = (spec: unknown) => {
    // 走公共入口间接触发 validateUiNodeSpec(其非导出,经 genUiBuildLayoutScript 调用)
    const { genUiBuildLayoutScript } = await import('../src/tools/ui/ui-layout.js');
    return genUiBuildLayoutScript(spec as never, { w: 1280, h: 720 }, true);
  };

  it('合法 styleboxes(panel 槽 + bg_color + corner_radius 对象)通过', async () => {
    const script = await call({
      type: 'Panel', name: 'Card', rect: { x: 0, y: 0, w: 100, h: 50 },
      styleboxes: [{ slot: 'panel', box: { bg_color: [0.1, 0.12, 0.18, 1], corner_radius: { tl: 8, br: 4 } } }],
    });
    expect(script).toContain('StyleBoxFlat.new()');
  });

  it('slot 白名单外 → throw(INVALID_PARAMS)', async () => {
    await expect(call({
      type: 'Panel', name: 'X', rect: { x: 0, y: 0, w: 10, h: 10 },
      styleboxes: [{ slot: 'focus', box: { bg_color: [1, 0, 0, 1] } }],
    })).rejects.toThrow(/styleboxes slot "focus" is not whitelisted/);
  });

  it('corner_radius 负值 → throw', async () => {
    await expect(call({
      type: 'Panel', name: 'X', rect: { x: 0, y: 0, w: 10, h: 10 },
      styleboxes: [{ slot: 'panel', box: { corner_radius: -1 } }],
    })).rejects.toThrow(/corner_radius must be non-negative/);
  });

  it('border_width 非有限数 → throw', async () => {
    await expect(call({
      type: 'Button', name: 'B', rect: { x: 0, y: 0, w: 10, h: 10 },
      styleboxes: [{ slot: 'normal', box: { border_width: Number.POSITIVE_INFINITY } }],
    })).rejects.toThrow(/border_width must be a non-negative finite number/);
  });
});
```

> 注:若该文件现有测试不使用顶层 `await import`,把 `call` 改为先在文件顶部 `import { genUiBuildLayoutScript } from '../src/tools/ui/ui-layout.js';`,call 内直接调用——以文件现有 import 风格为准。校验发生在生成前的 validate 阶段,throw 即失败,不产出脚本。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/ui-layout.test.ts -t "styleboxes"`
Expected: FAIL——`StyleBoxFlat.new()` not found(类型未加,`styleboxes` 字段被生成器忽略,不产出构造行;slot 白名单外不 throw)

- [ ] **Step 3: 实现 types.ts**(插在 `UiNodeSpec` 定义之前,约 91 行处)

```ts
// ─── PR-1: StyleBox 通道类型 ────────────────────────────────────────────────

/** theme_override_styleboxes 槽位白名单(spec §3.3)。
 * hover/pressed/disabled 仅供 ui_build_layout 手写树入口,翻译器永不产出;
 * focus/read_only 等显式不进(YAGNI:每扩一槽须定义语义边界+测试面)。 */
export type StyleBoxSlot = 'panel' | 'normal' | 'background' | 'fill' | 'hover' | 'pressed' | 'disabled';

export const STYLEBOX_SLOTS: readonly StyleBoxSlot[] = [
  'panel', 'normal', 'background', 'fill', 'hover', 'pressed', 'disabled',
];

/** StyleBoxFlat 描述(spec §3.2);corner_radius 支持统一值或四角对象。 */
export interface StyleBoxFlatSpec {
  bg_color?: [number, number, number, number];        // 0-1
  corner_radius?: number | { tl?: number; tr?: number; br?: number; bl?: number };
  border_width?: number;                               // 统一四边
  border_color?: [number, number, number, number];
  draw_center?: boolean;
}

export interface StyleBoxOverride {
  slot: StyleBoxSlot;
  box: StyleBoxFlatSpec;
}
```

`UiNodeSpec` 加一个字段(92-101 行的 type 字面量内,`flex?: FlexChild;` 之后):

```ts
export type UiNodeSpec = {
  type: string;
  name: string;
  properties?: Record<string, unknown>;
  anchor_preset?: string;
  rect?: Rect;
  layout?: FlexLayout;
  flex?: FlexChild;
  styleboxes?: StyleBoxOverride[];   // PR-1:样式槽位(spec §3.2)
  children?: UiNodeSpec[];
};
```

- [ ] **Step 4: 实现 ui-layout.ts 校验**(validateUiNodeSpec 内,`if (spec.flex)` 块之后、`if (spec.children)` 之前插入)

```ts
  if (spec.styleboxes) {
    for (const sb of spec.styleboxes) {
      if (!STYLEBOX_SLOTS.includes(sb.slot)) {
        throw new Error(`INVALID_PARAMS: styleboxes slot "${sb.slot}" is not whitelisted (allowed: ${STYLEBOX_SLOTS.join(', ')})`);
      }
      const b = sb.box;
      const radii = typeof b.corner_radius === 'number'
        ? [b.corner_radius]
        : Object.values(b.corner_radius ?? {});
      if (radii.some(v => typeof v !== 'number' || v < 0 || !Number.isFinite(v))) {
        throw new Error('INVALID_PARAMS: styleboxes corner_radius must be non-negative finite number(s)');
      }
      if (b.border_width !== undefined && (typeof b.border_width !== 'number' || b.border_width < 0 || !Number.isFinite(b.border_width))) {
        throw new Error('INVALID_PARAMS: styleboxes border_width must be a non-negative finite number');
      }
    }
  }
```

同时确认 ui-layout.ts 头部 import 加 `STYLEBOX_SLOTS`:`import { ..., STYLEBOX_SLOTS } from './types.js';`(并入现有 from './types.js' 的 import 列表)。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run test/ui-layout.test.ts -t "styleboxes"`
Expected: 4 PASS(第 1 例 PASS 依赖 Task 3 的构造块——**本任务先让 2/3/4 例过,第 1 例仍 FAIL 属预期,在 Task 3 完成后转绿**;或将第 1 例断言临时改为「脚本生成不 throw」,Task 3 时改回。推荐后者:本任务断言 `expect(() => call(...)).not.toThrow()` 形式)

Run: `npm run build`
Expected: tsc 零错误

- [ ] **Step 6: Commit**

```bash
git add src/tools/ui/types.ts src/tools/ui/ui-layout.ts test/ui-layout.test.ts
git commit -m "feat(ui): styleboxes 类型层——StyleBoxSlot 白名单与 StyleBoxFlatSpec 校验"
```

---

### Task 2: 翻译层——zod 字段 + 槽位映射 + 规则 9 重写/规则 7 修正

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\ui\prototype-import.ts`(NodeSchema 75-93 行、GeometryNode 26-39 行、buildSpec 240-331 行、PROGRESS_BAR_MIN_HEIGHT 预警 270-274 行)
- Test: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\prototype-import.test.ts`(改写 309-314/354-357/481-483 三处 BREAKING 断言 + 新增用例)

**Interfaces:**
- Consumes: Task 1 的 `StyleBoxSlot`/`StyleBoxOverride`/`StyleBoxFlatSpec`(from `./types.js`)。
- Produces(Task 3/4 依赖):
  - `export function styleboxSlotFor(type: string): StyleBoxSlot | undefined`(Panel→'panel'、ProgressBar→'background'、Button|Label→'normal'、其余 undefined)
  - `GeometryNode` 新字段:`fill?: string | number[]`、`borderRadius?: number | { tl?: number; tr?: number; br?: number; bl?: number }`、`border?: { width: number; color: string | number[] }`
  - 翻译产物:节点带 bg/border/radius/fill 时 `UiNodeSpec.styleboxes`(bg 槽 + ProgressBar 的 fill 槽);**properties.modulate 从此不再产出**

- [ ] **Step 1: 改写 3 处 BREAKING 断言 + 写新失败测试**

`test/prototype-import.test.ts` 中:

(a) 309-314 行用例整体替换为:

```ts
  it('有 bg → styleboxes panel 槽 bg_color(不再 modulate)', () => {
    const { tree, warnings } = tr(geo([n('Bg', 0, 0, 100, 50, { bg: '#10141f' })]));
    const p = findNode(tree, 'Bg')!;
    expect(p.properties?.modulate).toBeUndefined();
    expect(p.styleboxes).toEqual([
      { slot: 'panel', box: { bg_color: [16 / 255, 20 / 255, 31 / 255, 1] } },
    ]);
    expect(warnings.some(w => w.includes('近似'))).toBe(false);
  });
```

(b) 354-357 行用例替换为:

```ts
  it('显式 type Panel 有 bg → panel 槽 stylebox,无灰底翻转 warning(负例)', () => {
    const { tree, warnings } = tr(geo([n('PB', 0, 0, 100, 50, { type: 'Panel', bg: '#10141f' })]));
    expect(findNode(tree, 'PB')!.styleboxes).toHaveLength(1);
    expect(warnings.some(w => w.includes('gray panel stylebox'))).toBe(false);
  });
```

(c) 481-483 行用例替换为:

```ts
  it('bg [r,g,b](0-255)→ stylebox bg_color 归一', () => {
    const { tree } = tr(geo([n('P', 0, 0, 80, 40, { bg: [10, 20, 30] })]));
    expect(findNode(tree, 'P')!.styleboxes![0]!.box.bg_color).toEqual([10 / 255, 20 / 255, 30 / 255, 1]);
  });
```

(d) 文件末尾追加新 describe:

```ts
// ─── PR-1 Task 2: 样式三件套翻译规则 ───────────────────────────────────────

describe('StyleBox 通道翻译(PR-1)', () => {
  it('ProgressBar: bg→background 槽 + fill→fill 槽双 stylebox', () => {
    const { tree } = tr(geo([n('Hp', 0, 0, 120, 20, { type: 'ProgressBar', value: 0.5, bg: '#222222', fill: '#3ddc84' })]));
    const sb = findNode(tree, 'Hp')!.styleboxes!;
    expect(sb.map(s => s.slot)).toEqual(['background', 'fill']);
    expect(sb[1]!.box.bg_color).toEqual([61 / 255, 220 / 255, 132 / 255, 1]);
  });

  it('Button/Label 有 bg → normal 槽(badge 映射)', () => {
    const { tree: t1 } = tr(geo([n('Tag', 0, 0, 40, 20, { text: 'NEW', bg: '#3ddc84' })]));
    expect(findNode(t1, 'Tag')!.styleboxes![0]!.slot).toBe('normal');   // text+无 interactive → Label
    const { tree: t2 } = tr(geo([n('Btn', 0, 0, 60, 30, { text: '确定', interactive: true, bg: '#2255aa' })]));
    expect(findNode(t2, 'Btn')!.styleboxes![0]!.slot).toBe('normal');   // interactive+text → Button
  });

  it('bg 缺省但 border/borderRadius 存在 → draw_center=false(CSS 透明底)', () => {
    const { tree } = tr(geo([n('BO', 0, 0, 60, 30, { type: 'Panel', borderRadius: 8, border: { width: 2, color: '#7a8aab' } })]));
    const box = findNode(tree, 'BO')!.styleboxes![0]!.box;
    expect(box.draw_center).toBe(false);
    expect(box.bg_color).toBeUndefined();
    expect(box.corner_radius).toBe(8);
    expect(box.border_width).toBe(2);
    expect(box.border_color).toEqual([122 / 255, 138 / 255, 171 / 255, 1]);
  });

  it('borderRadius 四角对象原样保留', () => {
    const { tree } = tr(geo([n('R4', 0, 0, 60, 30, { type: 'Panel', bg: '#111111', borderRadius: { tl: 8, br: 4 } })]));
    expect(findNode(tree, 'R4')!.styleboxes![0]!.box.corner_radius).toEqual({ tl: 8, br: 4 });
  });

  it('未映射控件(LineEdit)带 bg → warning + 忽略(不产 stylebox)', () => {
    const { tree, warnings } = tr(geo([n('LE', 0, 0, 100, 24, { type: 'LineEdit', bg: '#123456' })]));
    expect(findNode(tree, 'LE')!.styleboxes).toBeUndefined();
    expect(warnings.some(w => w.includes('LE') && w.includes('样式槽位'))).toBe(true);
  });

  it('fill 给非 ProgressBar → warning + 忽略', () => {
    const { tree, warnings } = tr(geo([n('LB', 0, 0, 40, 20, { text: 'x', fill: '#ff0000' })]));
    expect(findNode(tree, 'LB')!.styleboxes).toBeUndefined();
    expect(warnings.some(w => w.includes('fill 仅 ProgressBar'))).toBe(true);
  });

  it('规则 7 修正:无 stylebox 的 ProgressBar h<27 才预警;带 bg 时不预警', () => {
    const { warnings: w1 } = tr(geo([n('P1', 0, 0, 100, 16, { type: 'ProgressBar', value: 0.5 })]));
    expect(w1.some(w => w.includes('will be clamped'))).toBe(true);
    const { warnings: w2 } = tr(geo([n('P2', 0, 0, 100, 16, { type: 'ProgressBar', value: 0.5, bg: '#222222', fill: '#3ddc84' })]));
    expect(w2.some(w => w.includes('will be clamped'))).toBe(false);
  });

  it('parseGeometry:borderRadius 负值 → INVALID_PARAMS;border 坏颜色 → INVALID_PARAMS', () => {
    expect(() => parseGeometry(geo([n('X', 0, 0, 10, 10, { borderRadius: -1 })] as never)))
      .toThrow(/INVALID_PARAMS/);
    expect(() => parseGeometry(geo([n('Y', 0, 0, 10, 10, { border: { width: 1, color: 'not-a-color' } })])))
      .toThrow(/INVALID_PARAMS/);
  });
});
```

> 注意第一个负例的 `as never`:`n()` 的 extra 类型是 `Partial<GeometryNode>`,borderRadius 负值在**接口层**类型合法(校验在 zod),所以传参要绕过 TS 类型;若 `n()` 直接接受则去掉 `as never`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/prototype-import.test.ts`
Expected: FAIL——改写的 3 用例(styleboxes undefined)+ 新 describe 全红(字段不存在,`borderRadius` 甚至无法通过 zod)

- [ ] **Step 3: 实现翻译层**

(a) `GeometryNode` 接口(26-39 行)加三字段:

```ts
export interface GeometryNode {
  name: string;
  rect: Rect;
  type?: string;
  text?: string;
  fontSize?: number;
  color?: string | number[];
  bg?: string | number[];
  fill?: string | number[];                                                    // PR-1:ProgressBar fill 槽色
  borderRadius?: number | { tl?: number; tr?: number; br?: number; bl?: number };  // PR-1:四角
  border?: { width: number; color: string | number[] };                        // PR-1:统一四边
  align?: ProtoAlign;
  value?: number;
  flow?: 'row' | 'column';
  justify?: 'flex-start' | 'center' | 'flex-end' | 'space-between' | 'space-around' | 'space-evenly';
  interactive?: boolean;
}
```

(b) zod schema(75-93 行 NodeSchema 内,`bg:` 之后加):

```ts
  fill: ProtoColor.optional(),
  borderRadius: z.union([
    z.number().finite().min(0),
    z.strictObject({
      tl: z.number().finite().min(0).optional(),
      tr: z.number().finite().min(0).optional(),
      br: z.number().finite().min(0).optional(),
      bl: z.number().finite().min(0).optional(),
    }),
  ]).optional(),
  border: z.strictObject({
    width: z.number().finite().min(0),
    color: ProtoColor,
  }).optional(),
```

(c) import 行加类型(顶部):`import type { StyleBoxFlatSpec, StyleBoxOverride, StyleBoxSlot } from './types.js';`(并入现有 `from './types.js'` import)。

(d) `inferType` 之后新增槽位映射(模块级函数):

```ts
/** PR-1 规则:bg/border/radius → theme_override_styleboxes 槽位;undefined = 控件无映射槽(spec §3.4)。 */
export function styleboxSlotFor(type: string): StyleBoxSlot | undefined {
  switch (type) {
    case 'Panel': return 'panel';
    case 'ProgressBar': return 'background';
    case 'Button':
    case 'Label': return 'normal';
    default: return undefined;
  }
}
```

(e) `buildSpec` 内**替换** 278-295 行的 bg/透明壳段为(注意保留规则 4 透明壳与显式 Panel 灰底 warning 的 else-if 结构——透明壳判定输入「无 bg」不变):

```ts
  // PR-1 规则 9v2:样式三件套 → StyleBoxFlat(modulate 近似通道删除)。
  const hasBg = nd.bg !== undefined;
  const hasBorderish = nd.border !== undefined || nd.borderRadius !== undefined;
  const hasFill = nd.fill !== undefined;
  const slot = styleboxSlotFor(type);
  let styleboxes: StyleBoxOverride[] | undefined;
  if (hasBg || hasBorderish || hasFill) {
    const box: StyleBoxFlatSpec = {};
    if (hasBg) {
      box.bg_color = normalizeColor(nd.bg!, 'bg', nd.name);
    } else if (hasBorderish) {
      box.draw_center = false; // spec I-2:CSS「有边框无背景」是透明底,引擎默认灰底+draw_center=true 会翻转
    }
    if (nd.borderRadius !== undefined) box.corner_radius = nd.borderRadius;
    if (nd.border !== undefined) {
      box.border_width = nd.border.width;
      box.border_color = normalizeColor(nd.border.color, 'border.color', nd.name);
    }
    if (slot !== undefined) {
      styleboxes = [{ slot, box }];
      if (hasFill && type === 'ProgressBar') {
        styleboxes.push({ slot: 'fill', box: { bg_color: normalizeColor(nd.fill!, 'fill', nd.name) } });
      }
    } else {
      warnings.push(`节点 "${node.cleanName}"(${type}): bg/fill/border 无该控件的样式槽位,已忽略(换 Panel/Button/Label/ProgressBar 或外包 Panel)`);
    }
    if (hasFill && type !== 'ProgressBar') {
      warnings.push(`节点 "${node.cleanName}": fill 仅 ProgressBar 支持,已忽略`);
    }
  } else if (nd.flow !== undefined || (nd.type === undefined && nd.text === undefined && nd.value === undefined)) {
    // 规则 4(final review I-1 收窄):只有**推断为布局壳 Panel**才设透明壳;禁 modulate(级联陷阱)。
    props.self_modulate = [1, 1, 1, 0];
    warnings.push(`node "${node.cleanName}" inferred as layout-only Panel and set transparent (self_modulate alpha 0); set bg or type to keep it visible`);
  } else if (nd.type !== undefined && type === 'Panel') {
    warnings.push(`node "${node.cleanName}" explicit Panel without bg renders with the Godot default theme gray panel stylebox (web prototype div is transparent by default); set bg to match the prototype or drop type to let it be inferred as a transparent layout shell`);
  }
```

(f) `spec` 构造行(302 行)加 styleboxes 展开:

```ts
  const spec: UiNodeSpec = {
    type, name: node.cleanName, rect: rel,
    ...(Object.keys(props).length > 0 ? { properties: props } : {}),
    ...(styleboxes !== undefined ? { styleboxes } : {}),
  };
```

(g) 规则 7 预警(270-274 行)加「无任何 stylebox」条件:

```ts
  if (type === 'ProgressBar' && rel.h < PROGRESS_BAR_MIN_HEIGHT && styleboxes === undefined) {
    warnings.push(`节点 "${node.cleanName}": ProgressBar height below Godot 4.7 default theme minimum (~${PROGRESS_BAR_MIN_HEIGHT}px): will be clamped`);
  }
```

> 顺序要求:(g) 的判定依赖 `styleboxes` 变量,故 (e) 段必须移到 (g) 之前执行——实际文件里把整段新逻辑放在 fontSize 段之后、ProgressBar 预警之前即可。注释同步:270-271 行的旧说明改为「仅无 stylebox override 的 ProgressBar 用 27px 阈值(spec I-3:有 override 时钳制由 background+fill 两槽 override 的最小尺寸决定,不可静态预知)」。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/prototype-import.test.ts`
Expected: 全 PASS(含改写 3 例 + 新 8 例;fast-check 属性测试也须仍绿)

Run: `npm run lint && npm run build`
Expected: 零错误

- [ ] **Step 5: Commit**

```bash
git add src/tools/ui/prototype-import.ts test/prototype-import.test.ts
git commit -m "feat(prototype): 样式三件套翻译为 StyleBoxFlat(bg BREAKING)+规则7 override 条件修正"
```

---

### Task 3: 生成器——genStyleboxLines 构造块

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\ui\ui-layout.ts`(新函数 + `uiNodeToGd` 470-496 行插入 + `uiNodeToGdWithLayout` 522-535 行后插入)
- Test: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\ui-layout.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `UiNodeSpec.styleboxes`;`colorToGd`(types.ts:121,确认 ui-layout.ts 已 import,若无则并入 `from './types.js'` 列表)。
- Produces: 生成的 GDScript 含 `StyleBoxFlat.new()` 构造块;变量 `_sb_N` 与 `_saved_N`/`_margin_N` 同作用域唯一(复用 nextId,N-7)。

- [ ] **Step 1: 写失败测试**(追加到 test/ui-layout.test.ts)

```ts
describe('genStyleboxLines 构造块(PR-1 Task 3)', () => {
  const gen = (spec: unknown) => genUiBuildLayoutScript(spec as never, { w: 800, h: 600 }, true);

  it('bg+radius+border → 完整构造块(panel 槽)', () => {
    const s = gen({
      type: 'Panel', name: 'Card', rect: { x: 0, y: 0, w: 100, h: 50 },
      styleboxes: [{
        slot: 'panel',
        box: { bg_color: [0.1, 0.12, 0.18, 1], corner_radius: 8, border_width: 2, border_color: [0.24, 0.86, 0.52, 1] },
      }],
    });
    expect(s).toContain('var _sb_1 := StyleBoxFlat.new()');
    expect(s).toContain('_sb_1.bg_color = Color(0.1, 0.12, 0.18, 1)');
    expect(s).toContain('_sb_1.corner_radius_top_left = 8');
    expect(s).toContain('_sb_1.corner_radius_bottom_right = 8');
    expect(s).toContain('_sb_1.border_width_left = 2');
    expect(s).toContain('_sb_1.border_color = Color(0.24, 0.86, 0.52, 1)');
    expect(s).toContain('node.set("theme_override_styleboxes/panel", _sb_1)');
  });

  it('draw_center=false 与四角对象展开;两节点变量名递增不冲突', () => {
    const s = gen({
      type: 'Panel', name: 'P0', rect: { x: 0, y: 0, w: 50, h: 50 },
      styleboxes: [{ slot: 'panel', box: { corner_radius: { tl: 8, br: 4 }, draw_center: false } }],
      children: [{
        type: 'Panel', name: 'P1', rect: { x: 10, y: 10, w: 20, h: 20 },
        styleboxes: [{ slot: 'panel', box: { bg_color: [1, 0, 0, 1] } }],
      }],
    });
    expect(s).toContain('_sb_1.draw_center = false');
    expect(s).toContain('_sb_1.corner_radius_top_right = 0');   // 对象缺省角 = 0
    expect(s).toContain('_sb_1.corner_radius_bottom_left = 0');
    expect(s).toContain('var _sb_2 := StyleBoxFlat.new()');      // nextId 递增,无同名 var
    expect(s.match(/var _sb_1 :=/g)).toHaveLength(1);
  });

  it('ProgressBar 双槽(background+fill)各产构造块', () => {
    const s = gen({
      type: 'ProgressBar', name: 'Hp', rect: { x: 0, y: 0, w: 120, h: 20 },
      styleboxes: [
        { slot: 'background', box: { bg_color: [0.13, 0.13, 0.13, 1] } },
        { slot: 'fill', box: { bg_color: [0.24, 0.86, 0.52, 1] } },
      ],
    });
    expect(s).toContain('node.set("theme_override_styleboxes/background", _sb_1)');
    expect(s).toContain('node.set("theme_override_styleboxes/fill", _sb_2)');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/ui-layout.test.ts -t "genStyleboxLines"`
Expected: FAIL——`StyleBoxFlat.new()` not found

- [ ] **Step 3: 实现 genStyleboxLines**(ui-layout.ts,`uiNodeToGd` 函数之前)

```ts
/** PR-1:styleboxes → StyleBoxFlat 构造块(spec §3.2)。变量名 _sb_N 复用 nextId 全局
 * 命名空间——整树拼进单个 _initialize() 作用域,与 _saved_N/_margin_N 同层,同名 var 是
 * GDScript 编译错(审查 N-7)。colorToGd 出 [r,g,b,a] → Color(...) 表达式。 */
function genStyleboxLines(spec: UiNodeSpec, indent: string, nextId: () => number): string {
  if (!spec.styleboxes || spec.styleboxes.length === 0) return '';
  const blocks: string[] = [];
  for (const sb of spec.styleboxes) {
    const v = `_sb_${nextId()}`;
    const b = sb.box;
    const lines: string[] = [`var ${v} := StyleBoxFlat.new()`];
    if (b.bg_color !== undefined) lines.push(`${v}.bg_color = ${colorToGd(b.bg_color)}`);
    if (b.draw_center !== undefined) lines.push(`${v}.draw_center = ${b.draw_center}`);
    if (b.corner_radius !== undefined) {
      const u = typeof b.corner_radius === 'number' ? b.corner_radius : undefined;
      const o = typeof b.corner_radius === 'object' && b.corner_radius !== null ? b.corner_radius : {};
      lines.push(
        `${v}.corner_radius_top_left = ${o.tl ?? u ?? 0}`,
        `${v}.corner_radius_top_right = ${o.tr ?? u ?? 0}`,
        `${v}.corner_radius_bottom_right = ${o.br ?? u ?? 0}`,
        `${v}.corner_radius_bottom_left = ${o.bl ?? u ?? 0}`,
      );
    }
    if (b.border_width !== undefined) {
      lines.push(
        `${v}.border_width_left = ${b.border_width}`,
        `${v}.border_width_top = ${b.border_width}`,
        `${v}.border_width_right = ${b.border_width}`,
        `${v}.border_width_bottom = ${b.border_width}`,
      );
    }
    if (b.border_color !== undefined) lines.push(`${v}.border_color = ${colorToGd(b.border_color)}`);
    lines.push(`node.set("theme_override_styleboxes/${sb.slot}", ${v})`);
    blocks.push(lines.map(l => `${indent}${l}`).join('\n'));
  }
  return '\n' + blocks.join('\n');
}
```

两处调用点:

(a) `uiNodeToGd` 内,475 行 `node.name = ...${anchorLine}${propLines}` 行改为拼接 styleLines(构造在 propLines 定义之后):

```ts
  const styleLines = genStyleboxLines(spec, indent, nextId);
```

且 470-475 行的 lines 模板串末尾追加 `${styleLines}`:

```ts
  let lines = `${indent}node = ClassDB.instantiate("${gdEscape(spec.type)}")
${indent}if node == null:
${indent}\t_mcp_output("error", "Failed to instantiate: ${gdEscape(spec.type)}")
${indent}\t_mcp_done()
${indent}\treturn
${indent}node.name = "${gdEscape(spec.name)}"${anchorLine}${propLines}${styleLines}`;
```

(b) `uiNodeToGdWithLayout` 内,535 行 properties 块之后、537 行 `genFlexContainerProps` 之前插入:

```ts
  lines += genStyleboxLines(spec, indent, nextId);
```

(此分支覆盖手写树给容器节点 stylebox 的场景;翻译器的 flow 壳 Panel 走非 layout 分支,不受影响。)

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/ui-layout.test.ts`
Expected: 全 PASS(含 Task 1 遗留的第 1 例转绿——脚本含 StyleBoxFlat.new())

Run: `npm run build`
Expected: 零错误

- [ ] **Step 5: Commit**

```bash
git add src/tools/ui/ui-layout.ts test/ui-layout.test.ts
git commit -m "feat(ui): 生成器 StyleBoxFlat 构造块(_sb_N 复用 nextId 命名空间)"
```

---

### Task 4: fixture 升级 + 集成测试(需 GODOT_PATH + Windows)

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\fixtures\prototype-geometry\rts-hud.json`
- Create: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\fixtures\prototype-geometry\css-card.json`
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\integration\ui-import-integration.test.ts`

**Interfaces:**
- Consumes: Task 2/3 全部产出(翻译→styleboxes→构造块→persist 落盘)。
- Produces: 集成验收证据(.tscn 含 StyleBoxFlat sub_resource;Label normal 槽 headless 实测;ProgressBar 三组合钳制行为记录)。

- [ ] **Step 1: 升级 rts-hud.json**(改 4 个节点,**其余 19 个不动**;fixture 路径 `test/fixtures/prototype-geometry/rts-hud.json`)

```
Minimap 行:  {"name": "Minimap", ..., "bg":"#10141f" }        → 追加 "borderRadius": 8
CmdPanel 行: {"name": "CmdPanel", ..., "bg":"#10141f" }       → 追加 "borderRadius": 6, "border": {"width": 1, "color": "#3a4a5a"}
UnitPanel 行:{"name": "UnitPanel", ..., "bg":"#10141f" }      → 追加 "borderRadius": 6
HpBar 行:    {"name": "HpBar", ..., "type":"ProgressBar", "value": 0.72 }
             → 追加 "bg": "#223022", "fill": "#3ddc84"
```

改动原则:TopBar/Bg 保持纯 bg(作 panel 槽对照);HpBar h=27 恰好等于旧钳制值,加 bg+fill 后钳制消失但 h 不变,不破坏既有 layout 全绿断言。

- [ ] **Step 2: 新建 css-card.json**(覆盖 spec §7 声明的场景:Label badge/圆角边框/border 无 bg/HP fill)

```json
{
  "viewport": { "w": 800, "h": 600 },
  "nodes": [
    { "name": "CardBg",   "rect": {"x":40,"y":40,"w":320,"h":200},  "type":"Panel", "bg":"#1a1f2e", "borderRadius": 12, "border": {"width": 2, "color": "#3ddc84"} },
    { "name": "Title",    "rect": {"x":56,"y":56,"w":200,"h":28},   "text":"卡片标题", "fontSize":18, "color":"#e8ecf5", "bg":"#2a3040", "borderRadius": 6 },
    { "name": "TagChip",  "rect": {"x":56,"y":92,"w":48,"h":22},    "text":"NEW", "fontSize":12, "bg":"#3ddc84", "color":"#102015", "borderRadius": 10 },
    { "name": "Desc",     "rect": {"x":56,"y":124,"w":280,"h":20},  "text":"说明文本", "fontSize":13, "color":"#99aabb" },
    { "name": "BorderOnly","rect": {"x":40,"y":260,"w":320,"h":80}, "type":"Panel", "borderRadius": 8, "border": {"width": 1, "color": "#7a8aab"} },
    { "name": "HpBar",    "rect": {"x":56,"y":290,"w":280,"h":20},  "type":"ProgressBar", "value": 0.72, "bg": "#223022", "fill": "#3ddc84" }
  ]
}
```

> **首跑校准循环(spec §7 方法论)**:此 fixture 无上轮全绿树可反推。首次跑集成若 `Title/TagChip` dh>0(Label normal stylebox override 后 minimum_size 变化),调大对应 rect.h 至实测值并在 fixture 注释留痕(JSON 无注释,记录在集成测试的校准注释里);跑红→修绿的过程就是期望值来源,**不伪装有程序化真值**。

- [ ] **Step 3: 集成测试追加用例**(ui-import-integration.test.ts 末尾)

```ts
  it('css-card: 样式三件套 → .tscn StyleBoxFlat sub_resource + draw_center=false + 全绿', { timeout: 90000 }, async () => {
    const result = await handleTool('ui', {
      action: 'ui_import_prototype',
      project_path: dirCard,
      scene_path: 'res://main.tscn',
      geometry_path: 'proto/css-card.json',
    }, createCtx());
    expect(result!.isError).toBeFalsy();
    const parsed = JSON.parse(textOf(result)) as { data: { layout_verify: { diff: Array<{ ok: boolean; path: string; delta: unknown }> } } };
    const bad = parsed.data.layout_verify.diff.filter(d => !d.ok);
    expect(bad, `不绿 diff: ${JSON.stringify(bad)}`).toEqual([]);

    const sceneText = readFileSync(join(dirCard, 'main.tscn'), 'utf-8');
    // bg+radius+border → StyleBoxFlat sub_resource 落盘
    expect(sceneText).toContain('[sub_resource type="StyleBoxFlat"');
    expect(sceneText).toContain('theme_override_styleboxes/panel');
    // Label badge:Title/TagChip 走 normal 槽
    expect(sceneText).toContain('theme_override_styleboxes/normal');
    // border 无 bg → draw_center=false(CSS 透明底)
    expect(sceneText).toMatch(/draw_center = false/);
    // ProgressBar 双槽
    expect(sceneText).toContain('theme_override_styleboxes/background');
    expect(sceneText).toContain('theme_override_styleboxes/fill');
    // modulate 近似通道已删:全场景无翻译器产出的 modulate 行(self_modulate 透明壳除外)
    expect(sceneText).not.toMatch(/^\s*modulate = /m);
  });
```

配套:beforeAll 加 `dirCard = mkProject('ui-import-card-')` + 拷 fixture(css-card.json → `join(dirCard, 'proto', 'css-card.json')`,照 rts-hud 拷贝先例);文件顶部 `let dirCard: string;`。

**Label normal 槽 headless 实测**(spec §7/N-1,引擎事实落地证据)——同文件追加:

```ts
  it('Label normal stylebox 槽引擎实测:override 后 get_theme_stylebox 读回 StyleBoxFlat', { timeout: 60000 }, async () => {
    const { executeGdscriptTrusted } = await import('../../src/gdscript-executor.js');
    const out = await executeGdscriptTrusted({
      godotPath: process.env.GODOT_PATH!,
      projectPath: dirCard,
      code: `
extends SceneTree
func _initialize():
  var l := Label.new()
  var sb := StyleBoxFlat.new()
  sb.bg_color = Color(0.2, 0.3, 0.4, 1.0)
  l.add_theme_stylebox_override("normal", sb)
  var got := l.get_theme_stylebox("normal")
  _mcp_output("label_normal", JSON.stringify({
    "is_flat": got is StyleBoxFlat,
    "bg": [got.bg_color.r, got.bg_color.g, got.bg_color.b, got.bg_color.a]}))
  _mcp_done()
`,
      timeout: 30,
    });
    expect(out.stdout ?? out.output ?? '').toMatch(/"is_flat":true/);
  });
```

> executor 返回结构以文件内现有 `measureFromDisk` 辅助函数的消费方式为准——照它读输出的字段名调整(`stdout`/`output`/parse marker)。若 helper 已封装,直接复用。

**ProgressBar 三组合钳制记录**(spec §10.4,实测数据落测试注释):追加用例,三个临时 geometry(仅 bg / 仅 fill / bg+fill,h=16)各跑一次 import,记录 `layout_verify.diff` 中 HpBar 的 dh 实测值到测试内 `expect` 断言(首跑时先 `console.log` 观察再固化数值),并同步 `:129-132` 附近校准注释(规则 7 修正联动:HpBar 现带 bg+fill,「无 override 才预警」下不再产 will be clamped warning——若原注释提及需更新措辞)。

- [ ] **Step 4: 跑集成确认**

Run: `$env:GODOT_PATH="D:/godot/Godot_v4.7.1-stable_win64.exe"; npx vitest run test/integration/ui-import-integration.test.ts`(PowerShell;Git Bash 用 `GODOT_PATH=... npx vitest run ...`)
Expected: 原有用例全绿(RTS fixture 升级后 23 节点断言不变)+ 新用例绿;若 css-card 首跑红(Title/TagChip dh),按 Step 2 校准循环修 fixture

- [ ] **Step 5: Commit**

```bash
git add test/fixtures/prototype-geometry/rts-hud.json test/fixtures/prototype-geometry/css-card.json test/integration/ui-import-integration.test.ts
git commit -m "test(prototype): 集成验收 StyleBox 通道(card fixture+Label 槽实测+钳制三组合)"
```

---

### Task 5: 规则双副本同步 + evaluate 模板 + version bump

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\.claude\rules\godot-mcp-ui.md`(字段清单 :130 / 翻译规则 :133 / 引擎预警 :134 / evaluate 模板 :160-197)
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\.claude\rules\godot-mcp-engine-quirks.md`(:65 modulate 段 / :68 ProgressBar 段)
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\rule-templates.ts`(上述全部镜像段 :612/:613/:615/:616/:621/:679 + 模板本体 + :933-935)
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\package.json`(version 0.31.4 → 0.32.0)

**Interfaces:**
- Consumes: Task 2/3 已定案的行为(槽位映射/draw_center/规则 7 条件)。
- Produces: 双副本内容一致(`STRICT=1 check:rules-sync` 绿);evaluate 模板输出 `fill/borderRadius/border` + 颜色数组格式。

- [ ] **Step 1: 改 `.claude/rules/godot-mcp-ui.md` 四段**

(a) :130 字段清单行,「`bg`」后追加(保持整行格式):

```
/`fill`（ProgressBar fill 槽色，取 `[data-fill]` 子元素背景）/`borderRadius`（统一四角 number 或 `{tl,tr,br,bl}` 对象）/`border`（`{width,color}` 统一四边，CSS 四边不同时取 top）
```

(b) :133 翻译规则要点行中,把「bg→modulate 近似染色（warning 声明非 StyleBox，叠加子树与实际底色有偏差）」替换为:

```
bg/fill/borderRadius/border→StyleBoxFlat（`theme_override_styleboxes` 槽位映射：Panel→panel、ProgressBar→background+fill、Button/Label→normal；其余控件 warning+忽略；bg 缺省而 border/radius 存在→`draw_center=false` 保 CSS 透明底）
```

(c) :134 引擎下限预警段,「ProgressBar rect.h < 27（...）→ "will be clamped" warning」改为:

```
ProgressBar rect.h < 27 **且无任何 stylebox override**（Godot 4.7 默认主题 stylebox 最小高，实测 rect.h=16 落地 27px）→ "will be clamped" warning——有 override 时钳制由 background+fill 两槽 override 的最小尺寸决定，不可静态预知（bg-only/fill-only/bg+fill 三组合实测校准）
```

(d) :197 evaluate 要点行,「**颜色经 toHex 转 `#rrggbb`**（翻译器不认 CSS `rgb()` 原文）」替换为:

```
**颜色经 toRgba 转 `[r,g,b,a]` 0-1 数组**（保留 alpha，替代旧 toHex 的丢 alpha；翻译器三种颜色格式均认）
```

(e) 模板本体(160-190 行)两处改动——`toHex` 函数替换为 `toRgba`,`fg/bg` 消费点改数组判定,循环体尾部追加三件套采集:

```js
const toRgba = (c) => {                     // CSS 颜色 → [r,g,b,a] 0-1 数组(保留 alpha;替代丢 alpha 的 toHex)
  if (!c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)') return null;
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c);
  if (!m) return null;
  if (m[4] !== undefined && Number(m[4]) === 0) return null;   // alpha 0 = 透明
  return [Number(m[1])/255, Number(m[2])/255, Number(m[3])/255, m[4] !== undefined ? Number(m[4]) : 1];
};
```

消费点:

```js
    const fg = toRgba(cs.color);
    if (fg && !(fg[0]===0 && fg[1]===0 && fg[2]===0 && fg[3]===1)) node.color = fg;  // 跳过浏览器默认黑
    const bg = toRgba(cs.backgroundColor);                 // 背景色:非透明才填(透明壳契约由翻译器兜底)
    if (bg) node.bg = bg;
```

循环体尾部(`if (el.dataset.type)` 行之前)追加:

```js
    const px = (v) => parseFloat(v) || 0;                  // "8px" → 8
    const tl = px(cs.borderTopLeftRadius), tr = px(cs.borderTopRightRadius),
          br = px(cs.borderBottomRightRadius), bl = px(cs.borderBottomLeftRadius);
    if (tl || tr || br || bl) {
      node.borderRadius = (tl === tr && tr === br && br === bl) ? tl : { tl, tr, br, bl };
    }
    const bw = parseFloat(cs.borderTopWidth);              // CSS 四边不同时取 top(简单;border-color 同)
    if (Number.isFinite(bw) && bw > 0) {
      const bc = toRgba(cs.borderTopColor);
      if (bc) node.border = { width: bw, color: bc };
    }
    const fillEl = el.querySelector('[data-fill]');        // ProgressBar fill 色:原型约定内层标 data-fill
    if (fillEl) {
      const fc = toRgba(getComputedStyle(fillEl).backgroundColor);
      if (fc) node.fill = fc;
    }
```

- [ ] **Step 2: 改 `.claude/rules/godot-mcp-engine-quirks.md` 两段**

(a) :65 modulate 段,括号「（bg 近似染色除外——modulate 染色会叠加子树，翻译器 warning 声明是近似）」替换为「（bg 走 StyleBoxFlat 通道，翻译器不再产出 modulate 染色）」。

(b) :68 ProgressBar 段,「`ui_import_prototype` 翻译器对 rect.h < 27 发 "will be clamped" warning（具名常量 PROGRESS_BAR_MIN_HEIGHT=27）」替换为「`ui_import_prototype` 翻译器**仅对无任何 stylebox override 的** ProgressBar 对 rect.h < 27 发 "will be clamped" warning（具名常量 PROGRESS_BAR_MIN_HEIGHT=27；有 override 时钳制由 override stylebox 决定）」。

- [ ] **Step 3: 同步 `src/tools/rule-templates.ts` 全部镜像段**

`.claude/rules/godot-mcp-ui.md` 的 :130/:133/:134/:197/模板本体五处 → 对应 `:612/:615/:616/:679` + 模板本体(同文件内 UI 段的模板代码块);`.claude/rules/godot-mcp-engine-quirks.md` 两段 → `:933-935` 段(:65 镜像)与 ProgressBar 27px 段(:68 镜像,rule-templates 内位置 grep `PROGRESS_BAR_MIN_HEIGHT` 定位)。**逐字同步**(仅版本行差异由归一化豁免)。改完跑:

Run: `npm run build && STRICT=1 npm run check:rules-sync`
Expected: 绿(双侧一致;若报 drift,按 diff 修到一致)

- [ ] **Step 4: version bump + 门禁**

```bash
npm version minor --no-git-tag-version    # 0.31.4 → 0.32.0
```

Run: `npm run check:rules-sync`(version-bump 脚本核验)→ 绿。

- [ ] **Step 5: Commit**

```bash
git add .claude/rules/godot-mcp-ui.md .claude/rules/godot-mcp-engine-quirks.md src/tools/rule-templates.ts package.json
git commit -m "docs(rules): 双副本同步 StyleBox 通道规则+evaluate 模板三件套采集(toRgba)+0.32.0"
```

---

### Task 6: descHint / matrix / budget / CHANGELOG + 全量门禁

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\ui\index.ts`(:30 description 行、:163 geometry 参数描述)
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\core\module-loader.ts`(SLIM_CONFIG ui descHint,grep `ui_import_prototype` 定位)
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\CHANGELOG.md`(0.32.0 段)
- 生成: `docs/capability-matrix.{json,md}`(命令产出,不手改)

**Interfaces:**
- Consumes: 全部前序任务。
- Produces: 发布就绪(descHint 描述新字段;matrix 与代码同步;CHANGELOG BREAKING 声明)。

- [ ] **Step 1: descHint 更新**

(a) index.ts :30 description 行,「原型: ui_import_prototype(几何 JSON 一次调用翻译+构建+测量+校验+持久化)」改为「原型: ui_import_prototype(几何 JSON 一次调用翻译+构建+测量+校验+持久化;bg/fill/borderRadius/border→StyleBoxFlat)」。

(b) index.ts :163 `geometry` 参数 description,末尾追加「;样式字段:bg/fill(ProgressBar)/borderRadius(number 或 {tl,tr,br,bl})/border({width,color})→StyleBoxFlat 四控件槽位(Panel/ProgressBar/Button/Label)」。

(c) module-loader.ts SLIM_CONFIG 的 ui descHint 同步(与 (a) 同措辞)。

- [ ] **Step 2: CHANGELOG 0.32.0 段**

文件顶部(按现有版本段格式)追加:

```markdown
## [0.32.0] - 2026-08-17

### BREAKING
- `ui_import_prototype`:proto JSON `bg` 语义从 modulate 近似染色改为真正的 StyleBoxFlat `bg_color`(theme_override_styleboxes 槽位:Panel→panel、ProgressBar→background、Button/Label→normal);翻译器不再产出 modulate。

### Added
- proto JSON 新字段:`fill`(ProgressBar fill 槽色)、`borderRadius`(number 或 {tl,tr,br,bl})、`border`({width,color})。
- `UiNodeSpec.styleboxes`(ui_build_layout 手写树同样可用;slot 七值白名单校验)。
- evaluate 取数模板:三件套采集 + 颜色输出改 [r,g,b,a] 数组(保留 alpha)。

### Changed
- ProgressBar 27px 钳制预警仅对无任何 stylebox override 的节点生效(有 override 时钳制由 override 决定)。
- bg 缺省而 border/borderRadius 存在 → StyleBoxFlat `draw_center=false`(CSS 透明底语义)。
```

- [ ] **Step 3: matrix + budget + 全量门禁**

```bash
npm run build-matrix && npm run check:budget
npm run lint && npm run build && npm test
STRICT=1 npm run check:rules-sync
```

Expected: 全绿(matrix 重建后 `git diff docs/capability-matrix.json` 应只见 ui 工具描述变化;budget 不超限)。

- [ ] **Step 4: Commit**

```bash
git add src/tools/ui/index.ts src/core/module-loader.ts CHANGELOG.md docs/capability-matrix.json docs/capability-matrix.md
git commit -m "docs(ui): descHint/matrix/CHANGELOG 0.32.0(StyleBox 通道 BREAKING 声明)"
```

---

## 执行后交付物(AGENTS.md 强制,PR 收尾时)

1. `docs/reviews/2026-08-17-prototype-stylebox-pr1.md` 第三方审查文档(派 code-reviewer,独立验证全部声明)。
2. memory 登记:feature-decision-log(PR-1 commit 清单/槽位映射决策/被拒方案:ColorRect 扩白名单、per-side border、hover/pressed 翻译)+ engineering-lesson(若有)。
3. Obsidian 开发日志(按全局 AGENTS.md 触发条件)。

## Self-Review 记录

- **Spec 覆盖**:§3.1 字段→Task 2;§3.2 类型/构造块→Task 1/3;§3.3 白名单→Task 1;§3.4 映射表→Task 2(styleboxSlotFor)+ ColorRect 回退为降级 Panel(既有行为,无需代码,Task 2 负例覆盖 LineEdit);§3.5 四规则→Task 2;§3.6 模板→Task 5;§7 测试(BREAKING 改写/fixture/Label 实测/三组合)→Task 2/4;§8 双副本 9+ 处→Task 5;§9 minor→Task 5。§10 开放问题 3(Label 槽实测)→Task 4;开放问题 4(三组合)→Task 4。
- **占位符扫描**:ProgressBar 三组合用例首跑数值需实测固化——已明确「先 console.log 观察再固化」的校准循环,非 TBD;executor 输出字段名给了「以 measureFromDisk 消费方式为准」的定位方法。无其他占位符。
- **类型一致性**:`StyleBoxOverride`/`StyleBoxFlatSpec`/`STYLEBOX_SLOTS`(Task 1 定义)与 Task 2 import、Task 3 消费签名一致;`styleboxSlotFor` 返回 `StyleBoxSlot | undefined` 全文一致;`_sb_N` 命名与 nextId 语义在 Task 3 测试与实现一致。
