# 布局保真闭环(Layout Fidelity Loop)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 UI 布局调教从"盲调"变成"测量驱动的数值收敛"——AI 每轮拿到逐节点 Δx/Δy/Δw/Δh,按数字修正直到容差内。

**Architecture:** 全部落在 Headless CLI 层。①`ui_build_layout` 增强(rect 绝对几何 + 锚点求解 + persist);②新 action `ui_measure_layout`(full-class SceneTree 脚本等帧后输出整树 computed rect);③TS 侧纯函数做 diff/重叠/越界。收敛编排由 AI 在工具调用层完成,不新增运行时。

**Tech Stack:** TypeScript(ES2022/strict/ESM)+ GDScript(Godot 4.5–4.7)+ Vitest + fast-check

**Spec:** `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\docs\superpowers\specs\2026-08-16-ui-layout-fidelity-design.md`(v2,审查 PASS)

## Global Constraints

- TypeScript `strict + noUncheckedIndexedAccess`,**禁 `any`**(`@typescript-eslint/no-explicit-any: error`),ESM import 必须带 `.js` 扩展名,2 空格缩进。
- MCP 工具 `description` 字段用**简体中文**。
- GDScript 生成代码用 **Tab 缩进**(与 `src/tools/ui/ui-layout.ts` 现有一致)。
- 每个任务收尾必跑 `npm run lint` + 该任务的测试,全绿才 commit;commit 用 Conventional Commits(type 英文前缀,subject 中文)。
- 分支:`git checkout -b feat/ui-layout-fidelity`(从当前 `fix/todo-batch-20260816` HEAD 切出)。
- 安全:新参数(`rect`/`expect_tree`/`persist`)只做类型校验不落盘,`scene_path` 一律走 `resolveWithinRoot(projectPath, normalizeUserProjectPath(...))` 白名单(照抄现有 case 模式)。
- 参考文件(需要理解现有模式时读):
  - `src/tools/ui/ui-layout.ts`(生成器风格、`_margin_` 注入先例)
  - `src/tools/ui/index.ts`(handler case / TOOL_META / UI_PERSIST_ACTIONS)
  - `src/tools/scene/scene-commit.ts:207-208`(原子写先例)
  - `src/gdscript-executor.ts:1117-1122`(full-class SceneTree 走 injectHelpers,不自动 `_mcp_done`)

---

### Task 1: justify space-* 真实现(spacer 注入,P0 快赢)

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\ui\ui-layout.ts`
- Test: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\ui-layout.test.ts`(新建)
- Test: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\integration\ui-layout-integration.test.ts`(新建)

**Interfaces:**
- Consumes: 现有 `UiNodeSpec`/`FlexLayout`(`src/tools/ui/types.ts`)。
- Produces: `interleaveSpacers(justify: string, children: UiNodeSpec[]): SequenceItem[]`(Task 内私有,不导出);`genSpacerLines(name: string, ratio: number, isRow: boolean, indent: string, ownerVar: string, parentVar: string): string`(导出,Task 1 集成测试复用断言)。

- [ ] **Step 1: 建分支**

```bash
cd "D:\GitHub\godot-mcp-series\godot-mcp-enhanced" && git checkout -b feat/ui-layout-fidelity
```

- [ ] **Step 2: 写失败单测(生成快照断言)**

新建 `test/ui-layout.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { genUiBuildLayoutScript, genSpacerLines } from '../src/tools/ui/ui-layout.js';

const TREE = (justify: string) => ({
  type: 'HBoxContainer', name: 'Row',
  layout: { direction: 'row' as const, justify: justify as 'space-between', gap: 0 },
  children: [
    { type: 'Button', name: 'A', properties: { text: 'A' } },
    { type: 'Button', name: 'B', properties: { text: 'B' } },
    { type: 'Button', name: 'C', properties: { text: 'C' } },
  ],
});

describe('justify space-* spacer 注入', () => {
  it('space-between 注入 N-1 个等比 spacer 且不再写 alignment 近似', () => {
    const s = genUiBuildLayoutScript('res://scenes/t.tscn', 'root', TREE('space-between'));
    expect(s).toContain('_spacer_0');
    expect(s).toContain('_spacer_1');
    expect(s.match(/_spacer_\d/g)).toHaveLength(2);
    expect(s).toContain('node.size_flags_stretch_ratio = 1');
    expect(s).not.toMatch(/node\.alignment = 0/); // 旧近似(space-between→BEGIN)已移除
  });

  it('space-around 注入 2N 个 0.5 比例 spacer', () => {
    const s = genUiBuildLayoutScript('res://scenes/t.tscn', 'root', TREE('space-around'));
    expect(s.match(/_spacer_\d/g)).toHaveLength(6); // 2N = 6
    expect(s).toContain('node.size_flags_stretch_ratio = 0.5');
  });

  it('space-evenly 注入 N+1 个等比 spacer', () => {
    const s = genUiBuildLayoutScript('res://scenes/t.tscn', 'root', TREE('space-evenly'));
    expect(s.match(/_spacer_\d/g)).toHaveLength(4); // N+1 = 4
  });

  it('flex-start/center/flex-end 仍走 alignment,不注入 spacer', () => {
    for (const j of ['flex-start', 'center', 'flex-end']) {
      const s = genUiBuildLayoutScript('res://scenes/t.tscn', 'root', TREE(j));
      expect(s).not.toContain('_spacer_');
      expect(s).toMatch(/node\.alignment = \d/);
    }
  });

  it('spacer 节点带 SIZE_EXPAND 与 MOUSE_FILTER_IGNORE', () => {
    const s = genSpacerLines('_spacer_0', 0.5, true, '\t', 'root', '_saved_0');
    expect(s).toContain('node.size_flags_horizontal = Control.SIZE_EXPAND');
    expect(s).toContain('node.mouse_filter = Control.MOUSE_FILTER_IGNORE');
  });

  it('justify space-* 与子节点 flex.grow 并存时发 warning', () => {
    const tree = { ...TREE('space-between'), children: [
      { type: 'Button', name: 'A', flex: { grow: 1 } },
      { type: 'Button', name: 'B' },
    ] };
    const s = genUiBuildLayoutScript('res://scenes/t.tscn', 'root', tree);
    expect(s).toContain('grow');
    expect(s).toContain('_mcp_output("warnings"');
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
cd "D:\GitHub\godot-mcp-series\godot-mcp-enhanced" && npx vitest run test/ui-layout.test.ts
```
预期:FAIL(`genSpacerLines` 未导出、`_spacer_` 不存在、alignment 近似仍在)。

- [ ] **Step 4: 实现**

在 `src/tools/ui/ui-layout.ts` 中做四处修改:

**(a) 新增类型与两个函数**(放在 `applyAlignSelf` 之前):

```ts
// space-* justify 无法用 BoxContainer alignment 表达,改为注入 SIZE_EXPAND spacer 实现。
// CSS 语义:between = 元素间 N-1 个等距;evenly = N+1 个等距(含首尾);around = 2N 个半距。
// (spec §3.3,审查 B-2:around 必须是 2N 个 0.5,不能用 N+1 个 —— N≥2 时配比不等)
export type SequenceItem = { kind: 'spacer'; ratio: number } | { kind: 'child'; spec: UiNodeSpec };

export function interleaveSpacers(justify: string, children: UiNodeSpec[]): SequenceItem[] {
  const asChildren = (): SequenceItem[] => children.map(c => ({ kind: 'child' as const, spec: c }));
  if (children.length === 0) return [];
  if (justify === 'space-between') {
    const out: SequenceItem[] = [];
    children.forEach((c, i) => {
      if (i > 0) out.push({ kind: 'spacer', ratio: 1 });
      out.push({ kind: 'child', spec: c });
    });
    return out;
  }
  if (justify === 'space-evenly') {
    const out: SequenceItem[] = [];
    for (const c of children) {
      out.push({ kind: 'spacer', ratio: 1 });
      out.push({ kind: 'child', spec: c });
    }
    out.push({ kind: 'spacer', ratio: 1 });
    return out;
  }
  if (justify === 'space-around') {
    const out: SequenceItem[] = [];
    for (const c of children) {
      out.push({ kind: 'spacer', ratio: 0.5 });
      out.push({ kind: 'child', spec: c });
    }
    out.push({ kind: 'spacer', ratio: 0.5 });
    return out;
  }
  return asChildren();
}

export function genSpacerLines(name: string, ratio: number, isRow: boolean, indent: string, ownerVar: string, parentVar: string): string {
  const flag = isRow ? 'size_flags_horizontal' : 'size_flags_vertical';
  return `${indent}node = ClassDB.instantiate("Control")
${indent}node.name = "${gdEscape(name)}"
${indent}node.${flag} = Control.SIZE_EXPAND
${indent}node.size_flags_stretch_ratio = ${ratio}
${indent}node.mouse_filter = Control.MOUSE_FILTER_IGNORE
${indent}${parentVar}.add_child(node)
${indent}node.owner = ${ownerVar}`;
}
```

**(b) `genFlexContainerProps` 的 justifyMap 删除 space-* 三项**(`src/tools/ui/ui-layout.ts:268-279` 原区域):

```ts
  if (layout.justify) {
    if (isWrap) {
      warnings.push('layout.justify is ignored when wrap is "wrap" (FlowContainer has no alignment)');
    } else if (['space-between', 'space-around', 'space-evenly'].includes(layout.justify)) {
      warnings.push(`layout.justify "${layout.justify}" is implemented by injecting _spacer_N Control nodes (BoxContainer has no space-* alignment)`);
    } else {
      const justifyMap: Record<string, number> = { 'flex-start': 0, 'center': 1, 'flex-end': 2 };
      const alignment = justifyMap[layout.justify];
      if (alignment !== undefined) {
        lines += `\n${indent}node.alignment = ${alignment}`;
      }
    }
  }
```

**(c) `validateFlexLayout` 删除旧 "approximated" warning**(`:185-187`),换成:

```ts
  if (layout.justify !== undefined && ['space-between', 'space-around', 'space-evenly'].includes(layout.justify)) {
    warnings.push(`layout.justify "${layout.justify}" is implemented via injected spacer nodes`);
  }
```

**(d) `uiNodeToGdWithLayout` 的 children 循环改走序列**(`:457-472` 原区域,替换整个 for 循环):

```ts
  let children = spec.children ?? [];
  if (isReverse) children = [...children].reverse();

  const justifyNeedsSpacers = !isWrap && !isGrid && layout.justify !== undefined
    && ['space-between', 'space-around', 'space-evenly'].includes(layout.justify);
  if (justifyNeedsSpacers && children.some(c => c.flex?.grow !== undefined && c.flex.grow > 0)) {
    warnings.push('justify space-* combined with child flex.grow: spacers and grow children share the free space, distribution will not match CSS semantics');
  }
  const seq: SequenceItem[] = justifyNeedsSpacers ? interleaveSpacers(layout.justify!, children) : children.map(c => ({ kind: 'child' as const, spec: c }));

  let spacerIdx = 0;
  for (const item of seq) {
    if (item.kind === 'spacer') {
      lines += '\n' + genSpacerLines(`_spacer_${spacerIdx++}`, item.ratio, isRow, indent, ownerVar, savedVar);
      continue;
    }
    const child = item.spec;
    lines += '\n' + uiNodeToGd(child, savedVar, ownerVar, indent, warnings, nextId);

    if (layout.align && (!child.flex || !child.flex.align_self || child.flex.align_self === 'auto')) {
      lines += applyAlignSelf(layout.align, isRow, indent, warnings);
    }
    if (child.flex) {
      lines += genFlexChildLines(child.flex, isRow, indent, warnings);
    }
  }
```

注意:spacer 直接 `add_child` 到 `savedVar`(容器),不进 `uiNodeToGd`(它无 children/properties);循环中 spacer 的 `node` 赋值会覆盖后续 child 生成前的 `node` 变量——child 生成本身总是以 `node = ClassDB.instantiate(...)` 开头,无残留影响。

- [ ] **Step 5: 跑单测确认通过**

```bash
npx vitest run test/ui-layout.test.ts && npx vitest run test/ui-tools.test.js
```
预期:全 PASS(含旧 ui-tools 回归)。

- [ ] **Step 6: 写集成数值断言(真实布局)**

新建 `test/integration/ui-layout-integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeGdscriptTrusted } from '../../src/gdscript-executor.js';
import { genUiBuildLayoutScript } from '../../src/tools/ui/ui-layout.js';

const GODOT = process.env.GODOT_PATH;
const run = !!GODOT && process.platform === 'win32';

describe.skipIf(!run)('justify space-* 真实布局数值断言(GODOT_PATH)', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ui-justify-'));
    writeFileSync(join(dir, 'project.godot'),
      'config_version=5\n\n[display]\n\nwindow/size/viewport_width=1280\nwindow/size/viewport_height=720\n');
    // Control 根 300x100,锚点无关(直接 offsets)
    writeFileSync(join(dir, 'main.tscn'),
      '[gd_scene format=3]\n\n[node name="Main" type="Control"]\noffset_right = 300.0\noffset_bottom = 100.0\n');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  async function buildAndMeasure(justify: string): Promise<Array<{ x: number; w: number }>> {
    // build 脚本 + 等帧收集脚本合并:full-class extends SceneTree,process_frame.connect 等稳定
    const tree = {
      type: 'HBoxContainer', name: 'Row',
      layout: { direction: 'row', justify, gap: 0 },
      children: [
        { type: 'Button', name: 'A' }, { type: 'Button', name: 'B' }, { type: 'Button', name: 'C' },
      ],
    };
    const build = genUiBuildLayoutScript(join(dir, 'main.tscn'), 'root', tree);
    // 剥掉 build 脚本的同步 _mcp_done(最后两行),改为等帧后输出按钮几何
    const stripped = build.replace(/\t_mcp_output\("layout_built".*\n\t_mcp_done\(\)\n/, '');
    const collect = `
var _frames := 0
func _on_frame():
\t_frames += 1
\tif _frames >= 3:
\t\tprocess_frame.disconnect(_on_frame)
\t\tvar _btns := []
\t\tfor n in ["Row/A", "Row/B", "Row/C"]:
\t\t\tvar c := _mcp_scene_instance.get_node(n) as Control
\t\t\t_btns.append({"x": c.global_position.x, "w": c.size.x})
\t\t_mcp_output("btns", JSON.stringify(_btns))
\t\t_mcp_done()
func _defer():
\tprocess_frame.connect(_on_frame)
\t_mcp_done_disabled()
`;
    // 更直接:重写为独立 full-class 脚本,build 内联
    const script = `extends SceneTree

var _frames := 0
func _initialize():
\tvar r = load("${join(dir, 'main.tscn').replace(/\\/g, '/')}".replace("RES:", "res://"))
${stripped.split('\n').slice(4).join('\n')}
`;
    throw new Error('see Step 7 fix: 用统一 helper 替代本函数拼接');
  }

  it('placeholder', () => { expect(true).toBe(true); });
});
```

⚠️ **Step 6 的脚本拼接容易写错——改用下面的统一 helper 方案(Step 7 实现,Step 6 测试代码以下面为准):**

删除上面 `buildAndMeasure` 的拼接实现,改为:

```ts
async function runScript(dir: string, code: string) {
  const res = await executeGdscriptTrusted({
    godotPath: GODOT!, projectPath: dir, code, timeout: 30, loadAutoloads: false,
  });
  expect(res.compile_success, res.compile_error).toBe(true);
  expect(res.run_success, res.run_error).toBe(true);
  return res.outputs;
}

// 通用"build 后等 3 帧收集按钮 x/w"的 full-class 脚本
function buildThenCollect(dir: string, justify: string): string {
  const tree = {
    type: 'HBoxContainer', name: 'Row',
    layout: { direction: 'row', justify, gap: 0 },
    children: [
      { type: 'Button', name: 'A' }, { type: 'Button', name: 'B' }, { type: 'Button', name: 'C' },
    ],
  };
  const buildBlock = genUiBuildLayoutScript(join(dir, 'main.tscn'), 'root', tree)
    .replace(/\t_mcp_output\("layout_built"[\s\S]*$/, ''); // 截掉末尾输出,留 build 主体
  return `${buildBlock}
var _frames := 0

func _deferred_measure() -> void:
\tprocess_frame.connect(_on_frame)

func _on_frame() -> void:
\t_frames += 1
\tif _frames < 3:
\t\treturn
\tprocess_frame.disconnect(_on_frame)
\tvar _btns: Array = []
\tfor n in ["Row/A", "Row/B", "Row/C"]:
\t\tvar c := _mcp_scene_instance.get_node(n) as Control
\t\t_btns.append({"x": c.global_position.x, "w": c.size.x})
\t_mcp_output("btns", JSON.stringify(_btns))
\t_mcp_done()
`;
}
```

并在 `_initialize()` 末尾追加一行 `call_deferred("_deferred_measure")`——实现方式:对 `buildBlock` 做 `.replace(/\t_mcp_done\(\)\n$/, '\tcall_deferred("_deferred_measure")\n')`(build 脚本以 `\t_mcp_done()` 结尾,替换为延迟启动测量)。测试用例:

```ts
  it('space-between: 首尾贴边,相邻间距方差为 0', async () => {
    const outs = await runScript(dir, buildThenCollect(dir, 'space-between'));
    const btns = JSON.parse(String(outs.find(o => o.key === 'btns')!.value)) as Array<{ x: number; w: number }>;
    const xs = btns.map(b => b.x), ws = btns.map(b => b.w);
    const free = 300 - ws.reduce((a, b) => a + b, 0);
    const gaps = [xs[1]! - (xs[0]! + ws[0]!), xs[2]! - (xs[1]! + ws[1]!)];
    expect(xs[0]).toBeCloseTo(0, 0);                    // 首贴边
    expect(xs[2]! + ws[2]!).toBeCloseTo(300, 0);        // 尾贴边
    expect(Math.abs(gaps[0]! - gaps[1]!)).toBeLessThanOrEqual(1); // 间距相等
  });

  it('space-around: 边距 = 相邻间距之半', async () => {
    const outs = await runScript(dir, buildThenCollect(dir, 'space-around'));
    const btns = JSON.parse(String(outs.find(o => o.key === 'btns')!.value)) as Array<{ x: number; w: number }>;
    const xs = btns.map(b => b.x), ws = btns.map(b => b.w);
    const margin = xs[0]!;
    const gap = xs[1]! - (xs[0]! + ws[0]!);
    expect(Math.abs(margin * 2 - gap)).toBeLessThanOrEqual(1);
  });

  it('space-evenly: 全部相邻间距(含首尾)相等', async () => {
    const outs = await runScript(dir, buildThenCollect(dir, 'space-evenly'));
    const btns = JSON.parse(String(outs.find(o => o.key === 'btns')!.value)) as Array<{ x: number; w: number }>;
    const xs = btns.map(b => b.x), ws = btns.map(b => b.w);
    const g1 = xs[0]!;
    const g2 = xs[1]! - (xs[0]! + ws[0]!);
    const g3 = 300 - (xs[2]! + ws[2]!);
    const spread = Math.max(g1, g2, g3) - Math.min(g1, g2, g3);
    expect(spread).toBeLessThanOrEqual(1);
  });
```

- [ ] **Step 7: 跑集成测试**

```bash
GODOT_PATH="D:/godot/Godot_v4.7.1-stable_win64.exe" npx vitest run test/integration/ui-layout-integration.test.ts
```
预期:3 个用例 PASS(⚠️ headless 下 Button 尺寸依赖默认主题字体度量——若 CI/Linux 上尺寸异常,在本机 Windows 校准;这是 §5 标注过的风险,测试内只断言相对关系/间距,不断言按钮绝对宽,已规避)。

- [ ] **Step 8: lint + commit**

```bash
npm run lint && npx vitest run test/ui-layout.test.ts test/ui-tools.test.js
git add src/tools/ui/ui-layout.ts test/ui-layout.test.ts test/integration/ui-layout-integration.test.ts
git commit -m "fix(ui): space-between/around/evenly 改为 spacer 注入真实现(修语义丢失)"
```

---

### Task 2: 锚点求解器 + UiNodeSpec.rect(absolute 模式)

**Files:**
- Create: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\ui\anchor-solver.ts`
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\ui\types.ts`(UiNodeSpec 增 rect)
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\ui\ui-layout.ts`(uiNodeToGd 接入)
- Test: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\ui-anchor-solver.test.ts`(新建)

**Interfaces:**
- Produces(Task 3/4/5 依赖):
  - `export interface Rect { x: number; y: number; w: number; h: number }`
  - `export interface AnchorsOffsets { anchor_left: number; anchor_right: number; anchor_top: number; anchor_bottom: number; offset_left: number; offset_right: number; offset_top: number; offset_bottom: number }`
  - `export function solveAnchors(parent: { w: number; h: number }, child: Rect): AnchorsOffsets`(parent 尺寸非正数时 throw `INVALID_PARAMS`)
  - `UiNodeSpec.rect?: Rect`(相对父节点左上角)
  - `export const CONTAINER_CONTROL_TYPES: readonly string[]`(容器类型集合,Task 2 的 warning 用)

- [ ] **Step 1: 写失败测试(含 fast-check 属性测试)**

新建 `test/ui-anchor-solver.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { solveAnchors } from '../src/tools/ui/anchor-solver.js';

describe('solveAnchors', () => {
  it('全填充 rect → full_rect 型锚点(0,1,0,1)零偏移', () => {
    const r = solveAnchors({ w: 1280, h: 720 }, { x: 0, y: 0, w: 1280, h: 720 });
    expect(r.anchor_left).toBe(0); expect(r.anchor_right).toBe(1);
    expect(r.anchor_top).toBe(0); expect(r.anchor_bottom).toBe(1);
    expect(r.offset_left).toBe(0); expect(r.offset_right).toBe(0);
  });

  it('居中 rect → 0.5 比例锚点 + 整数偏移', () => {
    const r = solveAnchors({ w: 1000, h: 800 }, { x: 400, y: 350, w: 200, h: 100 });
    expect(r.anchor_left).toBe(0.4); expect(r.anchor_right).toBe(0.6);
    expect(Number.isInteger(r.offset_left)).toBe(true);
  });

  it('属性:任意合法 rect 反解后前向重放误差 ≤1px', () => {
    const rectArb = fc.integer({ min: 1, max: 2000 }).chain(pw =>
      fc.integer({ min: 1, max: 2000 }).chain(ph =>
        fc.integer({ min: 0, max: pw }).chain(x =>
          fc.integer({ min: 0, max: pw - x }).chain(w =>
            fc.integer({ min: 0, max: ph }).chain(y =>
              fc.integer({ min: 0, max: ph - y }).map(h => ({ pw, ph, x, y, w, h })))))));
    fc.assert(fc.property(rectArb, ({ pw, ph, x, y, w, h }) => {
      const r = solveAnchors({ w: pw, h: ph }, { x, y, w, h });
      const fx = r.anchor_left * pw + r.offset_left;
      const fw = (r.anchor_right * pw + r.offset_right) - fx;
      const fy = r.anchor_top * ph + r.offset_top;
      const fh = (r.anchor_bottom * ph + r.offset_bottom) - fy;
      expect(Math.abs(fx - x)).toBeLessThanOrEqual(1);
      expect(Math.abs(fw - w)).toBeLessThanOrEqual(1);
      expect(Math.abs(fy - y)).toBeLessThanOrEqual(1);
      expect(Math.abs(fh - h)).toBeLessThanOrEqual(1);
    }), { numRuns: 500 });
  });

  it('父尺寸非正数 → INVALID_PARAMS', () => {
    expect(() => solveAnchors({ w: 0, h: 100 }, { x: 0, y: 0, w: 10, h: 10 })).toThrow('INVALID_PARAMS');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run test/ui-anchor-solver.test.ts
```
预期:FAIL(模块不存在)。

- [ ] **Step 3: 实现 anchor-solver.ts**

新建 `src/tools/ui/anchor-solver.ts`:

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run test/ui-anchor-solver.test.ts
```
预期:PASS。

- [ ] **Step 5: types.ts 增 rect 字段并接入 uiNodeToGd**

`src/tools/ui/types.ts` 的 `UiNodeSpec`(`:89-97` 区域)改为:

```ts
export type UiNodeSpec = {
  type: string;
  name: string;
  properties?: Record<string, unknown>;
  anchor_preset?: string;
  rect?: { x: number; y: number; w: number; h: number };
  layout?: FlexLayout;
  flex?: FlexChild;
  children?: UiNodeSpec[];
};
```

`src/tools/ui/ui-layout.ts` 顶部 import 增加:

```ts
import { solveAnchors, CONTAINER_CONTROL_TYPES } from './anchor-solver.js';
```

`uiNodeToGd`(无 layout 分支)在 `anchorLine` 定义之后、`propLines` 之前插入 rect 处理,并把 `anchorLine` 与 rect 互斥(rect 优先):

```ts
  // rect(绝对几何)优先于 anchor_preset;父为 Container 时运行时跳过(B-3:容器会重排)
  let rectLines = '';
  if (spec.rect) {
    const gdRect = `Vector2(${spec.rect.w}, ${spec.rect.h})`;
    rectLines = `
${indent}if node.get_parent() != null and node.get_parent() is Container:
${indent}\tpass # parent is Container: rect skipped (would be re-arranged)
${indent}else:
${indent}\tnode.anchor_left = __AL__
${indent}\tnode.anchor_right = __AR__
${indent}\tnode.anchor_top = __AT__
${indent}\tnode.anchor_bottom = __AB__
${indent}\tnode.offset_left = __OL__
${indent}\tnode.offset_right = __OR__
${indent}\tnode.offset_top = __OT__
${indent}\tnode.offset_bottom = __OB__`
      .replace(/__AL__/, String(solveAnchorsRect('anchor_left')))
      .replace(/__AR__/, String(solveAnchorsRect('anchor_right')))
      .replace(/__AT__/, String(solveAnchorsRect('anchor_top')))
      .replace(/__AB__/, String(solveAnchorsRect('anchor_bottom')))
      .replace(/__OL__/, String(solveAnchorsRect('offset_left')))
      .replace(/__OR__/, String(solveAnchorsRect('offset_right')))
      .replace(/__OT__/, String(solveAnchorsRect('offset_top')))
      .replace(/__OB__/, String(solveAnchorsRect('offset_bottom')))
      .replace(/__W__/, gdRect);
  }
```

⚠️ **以上是表达思路;实际实现不要用占位替换**。真实代码(直接内插,`solveAnchors` 一次调用取全值;根节点父未知时用期望视口,由 `genUiBuildLayoutScript` 新参数 `viewport?: {w,h}` 提供,默认 1280x720):

```ts
function genRectLines(spec: UiNodeSpec, viewport: { w: number; h: number }, indent: string): string {
  const a = solveAnchors(viewport, spec.rect!);
  return `
${indent}if node.get_parent() != null and node.get_parent() is Container:
${indent}\tpass
${indent}else:
${indent}\tnode.anchor_left = ${a.anchor_left}
${indent}\tnode.anchor_right = ${a.anchor_right}
${indent}\tnode.anchor_top = ${a.anchor_top}
${indent}\tnode.anchor_bottom = ${a.anchor_bottom}
${indent}\tnode.offset_left = ${a.offset_left}
${indent}\tnode.offset_right = ${a.offset_right}
${indent}\tnode.offset_top = ${a.offset_top}
${indent}\tnode.offset_bottom = ${a.offset_bottom}`;
}
```

在 `uiNodeToGd` 的节点实例化行之后拼 `spec.rect ? genRectLines(spec, viewport, indent) : anchorLine`(viewport 经 `nextId` 闭包外的参数链传入:`genUiBuildLayoutScript` → `uiNodeToGd` → 递归;为避免改全部签名,用模块级 `let _viewport: {w,h}` + 在 `genUiBuildLayoutScript` 开头赋值的做法,**禁止**——并发不安全;正确做法:给 `uiNodeToGd`/`uiNodeToGdWithLayout` 加第 7 参 `viewport: { w: number; h: number }`,`genUiBuildLayoutScript` 解析 `args.viewport` 后逐层传入)。同时 TS 侧静态 warning(树内父是容器时):

```ts
  if (spec.rect && parentIsContainer) {
    warnings.push(`node "${spec.name}" has rect but parent is a Container — rect will be skipped at runtime (containers re-arrange children)`);
  }
```

`parentIsContainer` 由递归调用处计算:`spec.layout !== undefined || CONTAINER_CONTROL_TYPES.includes(spec.type)`。

**单测补**(加进 `test/ui-layout.test.ts`):

```ts
describe('ui_build_layout rect 支持', () => {
  it('带 rect 的节点生成显式 anchors+offsets 赋值', () => {
    const s = genUiBuildLayoutScript('res://scenes/t.tscn', 'root', {
      type: 'Panel', name: 'P',
      children: [{ type: 'Button', name: 'Btn', rect: { x: 40, y: 30, w: 120, h: 48 } }],
    });
    expect(s).toContain('node.anchor_left = 0');
    expect(s).toContain('node.offset_left = 40');
    expect(s).toContain('get_parent() is Container');
  });

  it('rect 节点父为容器时发 warning 且生成运行时跳过守卫', () => {
    const s = genUiBuildLayoutScript('res://scenes/t.tscn', 'root', {
      type: 'HBoxContainer', name: 'Row', layout: { direction: 'row' },
      children: [{ type: 'Button', name: 'Btn', rect: { x: 0, y: 0, w: 50, h: 50 } }],
    });
    expect(s).toContain('rect will be skipped');
    expect(s).toContain('get_parent() is Container');
  });

  it('rect 优先于 anchor_preset(同时提供时)', () => {
    const s = genUiBuildLayoutScript('res://scenes/t.tscn', 'root', {
      type: 'Panel', name: 'P',
      children: [{ type: 'Button', name: 'Btn', anchor_preset: 'center', rect: { x: 10, y: 10, w: 20, h: 20 } }],
    });
    expect(s).toContain('node.offset_left = 10');
    expect(s).not.toContain('set_anchors_preset');
  });
});
```

- [ ] **Step 6: 跑全部相关测试**

```bash
npx vitest run test/ui-anchor-solver.test.ts test/ui-layout.test.ts test/ui-tools.test.js
```
预期:全 PASS。

- [ ] **Step 7: lint + commit**

```bash
npm run lint
git add src/tools/ui/anchor-solver.ts src/tools/ui/types.ts src/tools/ui/ui-layout.ts test/ui-anchor-solver.test.ts test/ui-layout.test.ts
git commit -m "feat(ui): UiNodeSpec 支持 rect 绝对几何,锚点求解器反解 anchors+offsets"
```

---

### Task 3: ui_measure_layout(整树 computed rect 测量)

**Files:**
- Create: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\ui\ui-measure.ts`
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\ui\types.ts`(ACTIONS 追加)
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\ui\index.ts`(inputSchema + case + TOOL_META)
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\core\module-loader.ts:226`(SLIM_CONFIG descHint)
- Test: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\ui-measure.test.ts`(新建,生成快照)
- Test: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\integration\ui-layout-integration.test.ts`(追加数值断言)

**Interfaces:**
- Consumes: `executeGdscriptTrusted({godotPath, projectPath, code, timeout, loadAutoloads}) → Promise<ExecuteGdscriptResult>`(`{compile_success, compile_error, run_success, run_error, outputs: Array<{key, value}>}`)。
- Produces(Task 4/5 依赖):
  - `export function genUiMeasureScript(scenePath: string, nodePath: string | undefined, maxDepth: number): string`(full-class `extends SceneTree` 脚本字符串,含 `process_frame.connect` 等帧与 `_mcp_done` 输出)
  - MCP action `ui_measure_layout`,输出 key `measure`,value 为 JSON:`{"stable_after_frames": number, "nodes": MeasuredNode[]}`,`MeasuredNode = {path, type, rect: {x,y,w,h}, anchors: {left,right,top,bottom}, offsets: {left,right,top,bottom}, visible: boolean, text?: string}`(Task 4 的 `MeasuredNode` 类型与此字段完全一致)

- [ ] **Step 1: 写失败单测(生成快照)**

新建 `test/ui-measure.test.ts`:

```ts
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

  it('node_path 限定测量子树', () => {
    const s = genUiMeasureScript('res://scenes/main.tscn', 'HUD', 16);
    expect(s).toContain('get_node_or_null("HUD")');
  });

  it('maxDepth 截断深度', () => {
    const s = genUiMeasureScript('res://scenes/main.tscn', undefined, 7);
    expect(s).toContain('depth > 7');
  });

  it('节点数上限 2000 防爆', () => {
    const s = genUiMeasureScript('res://scenes/main.tscn', undefined, 16);
    expect(s).toContain('_count >= 2000');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run test/ui-measure.test.ts
```
预期:FAIL(模块不存在)。

- [ ] **Step 3: 实现 ui-measure.ts**

新建 `src/tools/ui/ui-measure.ts`:

```ts
// ui_measure_layout:headless 整树 computed rect 测量。
// 执行链路(spec B-1 选型):executor 链(executeGdscriptTrusted),full-class extends
// SceneTree 脚本——gdscript-executor 对此类脚本走 injectHelpers,不自动追加 _mcp_done,
// 因此脚本可先 process_frame 等布局稳定再输出(随机 marker 由 executor replaceAll 注入)。

import { gdEscape, valueToGd, SCENE_TREE_HEADER } from '../shared.js';

export function genUiMeasureScript(scenePath: string, nodePath: string | undefined, maxDepth: number): string {
  const sp = gdEscape(scenePath);
  const np = nodePath ? gdEscape(nodePath) : '';
  const depth = Math.max(1, Math.min(64, Math.floor(maxDepth)));
  return `${SCENE_TREE_HEADER}

var _frames := 0
var _stable_count := 0
var _last_snapshot := ""
var _target: Node = null
var _count := 0

func _initialize():
\tif not _mcp_load_scene("${sp}"):
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
\t_count += 1
\tfor ch in n.get_children():
\t\t_snap_walk(ch, depth + 1, parts)

func _emit() -> void:
\tvar nodes: Array = []
\t_count = 0
\t_walk(_target, 0, nodes)
\t_mcp_output("measure", JSON.stringify({"stable_after_frames": _frames, "nodes": nodes}))
\tquit(0)

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
\t\tnodes.append(entry)
\t\t_count += 1
\tfor ch in n.get_children():
\t\t_walk(ch, depth + 1, nodes)
`;
}
```

注意:`SCENE_TREE_HEADER` 已含 `_mcp_done()`(print marker + `quit(0)`),`_emit` 末尾的 `quit(0)` 与之语义一致(先 print 再退出);若审查发现 `SCENE_TREE_HEADER` 的 `_mcp_done` 已含 quit,可删掉 `_emit` 里的显式 `quit(0)`(以 grep 实际 header 为准,实施时确认 `src/core/shared/gdscript-templates.ts:138-141`)。

- [ ] **Step 4: 跑单测确认通过**

```bash
npx vitest run test/ui-measure.test.ts
```
预期:PASS。

- [ ] **Step 5: 注册 action(四处)**

**(a)** `src/tools/ui/types.ts` ACTIONS(`:8-19`)追加一行:

```ts
  'ui_measure_layout',
```

**(b)** `src/tools/ui/index.ts` inputSchema(`:152` parent_path 之前)增:

```ts
          max_depth: { type: 'number', description: 'ui_measure_layout: 最大遍历深度(默认 16,上限 64)' },
```

handler switch(`ui_build_layout` case 之后)增:

```ts
      case 'ui_measure_layout': {
        const scenePath = resolveWithinRoot(projectPath, normalizeUserProjectPath(args.scene_path as string));
        const nodePathRaw = args.node_path as string | undefined;
        const maxDepth = typeof args.max_depth === 'number' ? args.max_depth : 16;
        script = genUiMeasureScript(scenePath, nodePathRaw ? normalizeNodePath(nodePathRaw) : undefined, maxDepth);
        break;
      }
```

import 行(`:12` 区域)增:`import { genUiMeasureScript } from './ui-measure.js';`

TOOL_META actionRisks(`:451-455`)增 `ui_measure_layout: 'read',`。**注意**:`satisfies Record<typeof ACTIONS[number], RiskLevel>` 会在漏登记时报 TS 错——这正是护栏,不要绕过。

**(c)** `src/tools/ui/index.ts` UI_PERSIST_ACTIONS(`:211`)**不加** `ui_measure_layout`(只读,无运行时丢失问题)。但 measure 结果不落盘,无需提示。

**(d)** `src/core/module-loader.ts:226` SLIM_CONFIG 的 ui descHint 末尾追加:`; ui_measure_layout→node_path(可选,默认整场景)/max_depth`。

- [ ] **Step 6: 集成数值断言(VBox 顺序/间距)**

`test/integration/ui-layout-integration.test.ts` 追加(Task 1 已建 fixture helper,复用 `runScript`):

```ts
import { genUiMeasureScript } from '../../src/tools/ui/ui-measure.js';

  it('ui_measure_layout: VBox 三按钮 rect 顺序与 separation 数值正确', async () => {
    const build = genUiBuildLayoutScript(join(dir, 'main.tscn'), 'root', {
      type: 'VBoxContainer', name: 'Col',
      layout: { direction: 'column', gap: 10 },
      children: [
        { type: 'Button', name: 'B1' }, { type: 'Button', name: 'B2' }, { type: 'Button', name: 'B3' },
      ],
    });
    await runScript(dir, build);
    // measure 需要独立进程再跑(build 是运行时节点,退出即丢)→ 此处直接对已存 .tscn 的场景测;
    // 运行时构建 + 测量须同进程:用 measure 脚本前置 build 块(同 Task 1 buildThenCollect 模式)
    const combined = build.replace(/\t_mcp_output\("layout_built"[\s\S]*$/, '') + `
func _go() -> void:
\tprocess_frame.connect(_on_measure_frame)
call_deferred("_go")
`;
    const outs = await runScript(dir, combined.replace(/\t_mcp_done\(\)\n\s*$/, '\treturn\n') +
      genUiMeasureScript('', '', 16).split('\n').slice(2).join('\n'));
    const measure = JSON.parse(String(outs.find(o => o.key === 'measure')!.value));
    const btns = measure.nodes.filter((n: { path: string }) => /Col\/B\d/.test(n.path));
    expect(btns).toHaveLength(3);
    expect(btns[0].rect.y).toBeLessThan(btns[1].rect.y);
    expect(btns[1].rect.y).toBeLessThan(btns[2].rect.y);
    const gap1 = btns[1].rect.y - (btns[0].rect.y + btns[0].rect.h);
    const gap2 = btns[2].rect.y - (btns[1].rect.y + btns[1].rect.h);
    expect(Math.abs(gap1 - 10)).toBeLessThanOrEqual(1);
    expect(Math.abs(gap2 - 10)).toBeLessThanOrEqual(1);
  });

  it('ui_measure_layout: 场景不存在 → error 输出', async () => {
    const outs = await runScript(dir, genUiMeasureScript(join(dir, 'nope.tscn'), undefined, 16));
    expect(outs.some(o => o.key === 'error')).toBe(true);
  });
```

⚠️ combined 拼接逻辑实施时以"能跑通且不重复定义函数"为准做最小调整(去掉 build 尾部 `_mcp_done`、保留 SCENE_TREE_HEADER 只出现一次);若拼接冲突,改为把 measure 的三个函数(`_on_measure_frame`/`_snapshot`/`_emit` + 变量)直接内联进 build 脚本尾部(与 Task 1 的 `buildThenCollect` 同构,代码量约 40 行)。

- [ ] **Step 7: 跑集成**

```bash
GODOT_PATH="D:/godot/Godot_v4.7.1-stable_win64.exe" npx vitest run test/integration/ui-layout-integration.test.ts
```
预期:全 PASS。

- [ ] **Step 8: lint + 全量测试 + commit**

```bash
npm run lint && npm test
git add src/tools/ui/ui-measure.ts src/tools/ui/types.ts src/tools/ui/index.ts src/core/module-loader.ts test/ui-measure.test.ts test/integration/ui-layout-integration.test.ts
git commit -m "feat(ui): 新增 ui_measure_layout——headless 整树 computed rect 测量(等帧稳定后输出)"
```

---

### Task 4: layout-diff(expect_tree diff/重叠/越界)

**Files:**
- Create: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\ui\layout-diff.ts`
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\ui\index.ts`(expect_tree 参数 + diff 注入)
- Test: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\ui-layout-diff.test.ts`(新建)

**Interfaces:**
- Consumes: Task 3 的 `MeasuredNode`(字段:`path/type/rect{x,y,w,h}`);`UiNodeSpec.rect`(Task 2)。
- Produces:
  - `export interface MeasuredNode { path: string; type: string; rect: Rect; anchors?: Record<string, number>; offsets?: Record<string, number>; visible?: boolean; text?: string }`
  - `export function flattenTargets(tree: UiNodeSpec, prefix?: string): Array<{ path: string; rect: Rect }>`(收集带 rect 的节点,路径 = 名称链 `/` 连接,与 measure 的 `get_path_to` 输出一致)
  - `export function diffLayout(measured: MeasuredNode[], targets: Array<{ path: string; rect: Rect }>, tolerancePx?: number): DiffEntry[]`(`DiffEntry = { path, target: Rect, actual: Rect, delta: {dx,dy,dw,dh}, ok: boolean }`,默认容差 2)
  - `export function detectOverlaps(measured: MeasuredNode[]): Array<{ a: string; b: string; overlap: Rect }>`(仅同父兄弟比较:按 path 去最后一段分组)
  - `export function detectOutOfBounds(measured: MeasuredNode[]): Array<{ path: string; parent: string; overflow: Rect }>`(子 rect 超出父 rect 的溢出量;根节点跳过)

- [ ] **Step 1: 写失败测试(含负向:不误报)**

新建 `test/ui-layout-diff.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { flattenTargets, diffLayout, detectOverlaps, detectOutOfBounds } from '../src/tools/ui/layout-diff.js';
import type { MeasuredNode } from '../src/tools/ui/layout-diff.js';

const n = (path: string, x: number, y: number, w: number, h: number): MeasuredNode =>
  ({ path, type: 'Control', rect: { x, y, w, h } });

describe('flattenTargets', () => {
  it('递归收集带 rect 节点,路径为名称链', () => {
    const t = flattenTargets({
      type: 'Panel', name: 'P',
      children: [
        { type: 'Button', name: 'A', rect: { x: 0, y: 0, w: 10, h: 10 } },
        { type: 'VBoxContainer', name: 'Col', layout: { direction: 'column' },
          children: [{ type: 'Button', name: 'B', rect: { x: 5, y: 5, w: 8, h: 8 } }] },
      ],
    });
    expect(t).toEqual([
      { path: 'P/A', rect: { x: 0, y: 0, w: 10, h: 10 } },
      { path: 'P/Col/B', rect: { x: 5, y: 5, w: 8, h: 8 } },
    ]);
  });

  it('无 rect 的节点不产出条目', () => {
    expect(flattenTargets({ type: 'Label', name: 'L' })).toEqual([]);
  });
});

describe('diffLayout', () => {
  const targets = [{ path: 'A', rect: { x: 0, y: 24, w: 100, h: 48 } }];

  it('超容差 → ok:false 并给出 delta', () => {
    const d = diffLayout([n('A', 0, 40, 100, 48)], targets, 2);
    expect(d).toHaveLength(1);
    expect(d[0]!.ok).toBe(false);
    expect(d[0]!.delta.dy).toBe(16);
  });

  it('容差内 → ok:true(负向:不误报)', () => {
    const d = diffLayout([n('A', 0, 25, 100, 48)], targets, 2);
    expect(d[0]!.ok).toBe(true);
  });

  it('measure 缺失的目标节点 → delta 标记 NaN 不 ok', () => {
    const d = diffLayout([n('Z', 0, 0, 1, 1)], targets, 2);
    expect(d).toHaveLength(1);
    expect(d[0]!.ok).toBe(false);
    expect(Number.isNaN(d[0]!.delta.dx)).toBe(true);
  });
});

describe('detectOverlaps(仅同父兄弟)', () => {
  it('兄弟相交 → 报告;不同父不相交不报(负向)', () => {
    const ms = [
      n('P/A', 0, 0, 50, 50), n('P/B', 25, 0, 50, 50),      // 同父相交
      n('Q/A', 0, 0, 50, 50), n('R/B', 25, 0, 50, 50),      // 不同父,不比较
    ];
    const ov = detectOverlaps(ms);
    expect(ov).toHaveLength(1);
    expect(ov[0]!.a).toBe('P/A');
    expect(ov[0]!.b).toBe('P/B');
  });
});

describe('detectOutOfBounds', () => {
  it('子超出父 → 溢出量;子在父内 → 不报(负向)', () => {
    const ms = [
      n('P', 0, 0, 100, 100),
      n('P/In', 10, 10, 50, 50),          // 在内
      n('P/Out', 80, 80, 50, 50),         // 右下溢出 30,30
    ];
    const oob = detectOutOfBounds(ms);
    expect(oob).toHaveLength(1);
    expect(oob[0]!.path).toBe('P/Out');
    expect(oob[0]!.overflow.w).toBe(30);
    expect(oob[0]!.overflow.h).toBe(30);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run test/ui-layout-diff.test.ts
```
预期:FAIL(模块不存在)。

- [ ] **Step 3: 实现 layout-diff.ts**

新建 `src/tools/ui/layout-diff.ts`:

```ts
// 布局对比:measure 结果 vs 目标 spec(rect)的逐节点 diff + 重叠/越界检测。
// Pascal verify_scene 模式(spec §3.1/§4):结构化问题清单,数字驱动收敛。

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
    const dx = m.rect.x - t.rect.x, dy = m.rect.y - t.rect.y;
    const dw = m.rect.w - t.rect.w, dh = m.rect.h - t.rect.h;
    const ok = Math.abs(dx) <= tolerancePx && Math.abs(dy) <= tolerancePx
      && Math.abs(dw) <= tolerancePx && Math.abs(dh) <= tolerancePx;
    return { path: t.path, target: t.rect, actual: m.rect, delta: { dx, dy, dw, dh }, ok };
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
    if (!p) continue; // 根节点无父
    const parent = byPath.get(p);
    if (!parent) continue;
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
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run test/ui-layout-diff.test.ts
```
预期:PASS。

- [ ] **Step 5: ui_measure_layout 接 expect_tree**

`src/tools/ui/index.ts`:

inputSchema 增(Step Task 3 已加 max_depth 之后):

```ts
          expect_tree: { type: 'object', description: 'ui_measure_layout: 可选目标树(同 ui_build_layout tree,含 rect);提供时输出逐节点 diff/重叠/越界', additionalProperties: true },
```

`ui_measure_layout` case 改为:

```ts
      case 'ui_measure_layout': {
        const scenePath = resolveWithinRoot(projectPath, normalizeUserProjectPath(args.scene_path as string));
        const nodePathRaw = args.node_path as string | undefined;
        const maxDepth = typeof args.max_depth === 'number' ? args.max_depth : 16;
        const expectTree = args.expect_tree as UiNodeSpec | undefined;
        if (expectTree && (typeof expectTree !== 'object' || !expectTree.name)) {
          return opsErrorResult(ERROR_CODES.INVALID_PARAMS, 'expect_tree must be a tree object with name');
        }
        script = genUiMeasureScript(scenePath, nodePathRaw ? normalizeNodePath(nodePathRaw) : undefined, maxDepth);
        break;
      }
```

executor 调用后、`parseGdscriptResult` 处改:measure 的 diff 须在 parse 出 `data.measure` 后注入——在现有 `const r = parseGdscriptResult(result, [], errorMapper);` 之后追加:

```ts
    let r = parseGdscriptResult(result, [], errorMapper);
    if (action === 'ui_measure_layout' && (args.expect_tree as UiNodeSpec | undefined)) {
      const expectTree = args.expect_tree as UiNodeSpec;
      try {
        const parsed = JSON.parse((r.content?.[0] as { text?: string } | undefined)?.text ?? '{}') as {
          data?: { measure?: { nodes?: MeasuredNode[] } } };
        const measured = parsed.data?.measure?.nodes ?? [];
        const wrapped = {
          targets: flattenTargets(expectTree),
          diff: diffLayout(measured, flattenTargets(expectTree), 2),
          overlaps: detectOverlaps(measured),
          out_of_bounds: detectOutOfBounds(measured),
        };
        // 把 diff 并回返回文本(opsSuccess JSON 的 data 下)
        const merged = { ...parsed, data: { ...parsed.data, layout_verify: wrapped } };
        r = { ...r, content: [{ type: 'text', text: JSON.stringify(merged) }] };
      } catch {
        // measure 输出异常时保持原样返回,diff 缺失由 AI 视为未验证
      }
    }
    return UI_PERSIST_ACTIONS.has(action) ? appendRuntimePersistWarning(r, action) : r;
```

(原 `const r = ...; return ...` 两行整体替换为上段;import 增 `import { flattenTargets, diffLayout, detectOverlaps, detectOutOfBounds } from './layout-diff.js';` 与 `import type { MeasuredNode } from './layout-diff.js';`;`r.content` 的实际形状以 `parseGdscriptResult` 返回的 `textResult(...)` 为准——`content[0].text` 为 JSON 字符串,实施时 grep `textResult` 确认字段名。)

- [ ] **Step 6: 跑全部单测 + lint + commit**

```bash
npx vitest run test/ui-layout-diff.test.ts test/ui-measure.test.ts test/ui-tools.test.js && npm run lint
git add src/tools/ui/layout-diff.ts src/tools/ui/index.ts test/ui-layout-diff.test.ts
git commit -m "feat(ui): ui_measure_layout 支持 expect_tree——逐节点 diff/重叠/越界问题清单"
```

---

### Task 5: persist 原子写持久化

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\ui\ui-layout.ts`(`genUiBuildLayoutScript` 加 persist 参数)
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\ui\index.ts`(persist 参数 + 跳过运行时丢失 warning)
- Test: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\ui-layout.test.ts`(追加)
- Test: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\test\integration\ui-layout-integration.test.ts`(追加)

**Interfaces:**
- Consumes: `scene-commit.ts:207-208` 的原子写 GD 模式(pack → `.tmp.ext` → `ResourceSaver.save` → `rename_absolute`,失败清理)。
- Produces: `genUiBuildLayoutScript(scenePath: string, parentPath: string, tree: UiNodeSpec, persist?: boolean): string`(第 4 参默认 false);MCP 参数 `persist?: boolean`。

- [ ] **Step 1: 写失败单测**

`test/ui-layout.test.ts` 追加:

```ts
describe('ui_build_layout persist', () => {
  const tree = { type: 'VBoxContainer', name: 'Col', layout: { direction: 'column' as const }, children: [] };

  it('persist=true 生成 pack→tmp→rename 原子写块', () => {
    const s = genUiBuildLayoutScript('res://scenes/main.tscn', 'root', tree, true);
    expect(s).toContain('PackedScene.new()');
    expect(s).toContain('ResourceSaver.save(packed, _tmp)');
    expect(s).toContain('DirAccess.rename_absolute(_tmp, _full)');
    expect(s).toContain('DirAccess.remove_absolute(_tmp)');
    expect(s).toContain('_mcp_output("persist"');
  });

  it('默认不持久化(无 ResourceSaver)', () => {
    const s = genUiBuildLayoutScript('res://scenes/main.tscn', 'root', tree);
    expect(s).not.toContain('ResourceSaver');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run test/ui-layout.test.ts
```
预期:persist 两条 FAIL(第 4 参不存在)。

- [ ] **Step 3: 实现**

`genUiBuildLayoutScript` 签名与末尾(`src/tools/ui/ui-layout.ts:490-528` 区域)改为:

```ts
export function genUiBuildLayoutScript(
  scenePath: string,
  parentPath: string,
  tree: UiNodeSpec,
  persist: boolean = false,
): string {
```

在 `${buildBlock}${warningLines}` 与 `_mcp_output("layout_built"...)` 之间插入 persist 块:

```ts
  const persistBlock = persist
    ? `\t# --- persist(原子写:pack → tmp → rename,同 scene-commit F-2 模式) ---
\tvar packed = PackedScene.new()
\tpacked.pack(_mcp_scene_instance)
\tvar _full := "${gdEscape(scenePath)}"
\tvar _ext := _full.get_extension()
\tvar _tmp := _full + ".tmp." + _ext
\tif FileAccess.file_exists(_tmp):
\t\tDirAccess.remove_absolute(_tmp)
\tvar err := ResourceSaver.save(packed, _tmp)
\tif err != OK:
\t\tDirAccess.remove_absolute(_tmp)
\telse:
\t\tvar _ren := DirAccess.rename_absolute(_tmp, _full)
\t\tif _ren != OK:
\t\t\tDirAccess.remove_absolute(_tmp)
\t\t\terr = _ren
\t_mcp_output("persist", {"saved": err == OK})
`
    : '';
```

返回模板中 `${buildBlock}${warningLines}` 后接 `${persistBlock}` 再接 `_mcp_output("layout_built"...)`。

`src/tools/ui/index.ts` 的 `ui_build_layout` case:

```ts
        const persist = args.persist === true;
        try {
          script = genUiBuildLayoutScript(scenePath, parentPath, tree, persist);
```

inputSchema 增:`persist: { type: 'boolean', description: 'ui_build_layout: 持久化到 .tscn(原子写;默认 false 运行时)' },`

返回处(Task 4 已改过的段落)末行改为:

```ts
    if (UI_PERSIST_ACTIONS.has(action) && !(action === 'ui_build_layout' && args.persist === true)) {
      return appendRuntimePersistWarning(r, action);
    }
    return r;
```

- [ ] **Step 4: 跑单测确认通过**

```bash
npx vitest run test/ui-layout.test.ts test/ui-tools.test.js
```
预期:PASS。

- [ ] **Step 5: 集成测试(persist 后重载 measure 一致)**

`test/integration/ui-layout-integration.test.ts` 追加:

```ts
  it('persist=true:节点写入 .tscn,重载 measure 结果一致', async () => {
    const build = genUiBuildLayoutScript(join(dir, 'main.tscn'), 'root', {
      type: 'VBoxContainer', name: 'Saved', layout: { direction: 'column', gap: 8 },
      children: [{ type: 'Button', name: 'OK' }, { type: 'Button', name: 'Cancel' }],
    }, true);
    const outs = await runScript(dir, build);
    expect(outs.some(o => o.key === 'persist')).toBe(true);
    const saved = JSON.parse(String(outs.find(o => o.key === 'persist')!.value));
    expect(saved.saved).toBe(true);
    // 重载独立 measure
    const measure = genUiMeasureScript(join(dir, 'main.tscn'), undefined, 16);
    const outs2 = await runScript(dir, measure);
    const m = JSON.parse(String(outs2.find(o => o.key === 'measure')!.value));
    const paths = (m.nodes as Array<{ path: string }>).map(x => x.path);
    expect(paths).toContain('Saved');
    expect(paths).toContain('Saved/OK');
    expect(paths).toContain('Saved/Cancel');
    const gap = (m.nodes as Array<{ rect: { y: number; h: number }; path: string }>)
      .find(x => x.path === 'Saved/Cancel')!.rect.y
      - ((m.nodes as Array<{ rect: { y: number; h: number } }).find(x => x.path === 'Saved/OK')!.rect.y
        + (m.nodes as Array<{ rect: { y: number; h: number } }).find(x => x.path === 'Saved/OK')!.rect.h);
    expect(Math.abs(gap - 8)).toBeLessThanOrEqual(1);
  });
```

- [ ] **Step 6: 跑集成 + lint + commit**

```bash
GODOT_PATH="D:/godot/Godot_v4.7.1-stable_win64.exe" npx vitest run test/integration/ui-layout-integration.test.ts && npm run lint
git add src/tools/ui/ui-layout.ts src/tools/ui/index.ts test/ui-layout.test.ts test/integration/ui-layout-integration.test.ts
git commit -m "feat(ui): ui_build_layout 支持 persist 原子写持久化到 .tscn"
```

---

### Task 6: 登记收尾(规则双副本/版本/matrix/budget/CHANGELOG)

**Files:**
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\.claude\rules\godot-mcp-ui.md`
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\src\tools\rule-templates.ts`(UI 段,`:380` 附近)
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\CHANGELOG.md`
- Modify: `D:\GitHub\godot-mcp-series\godot-mcp-enhanced\package.json`(version bump)

**Interfaces:**
- Consumes: Task 1-5 的最终行为。
- Produces: 无代码接口;AGENTS.md 仓库级约束的合规收尾。

- [ ] **Step 1: 更新 `.claude/rules/godot-mcp-ui.md`**

工具清单表(`:16-29` 区域)加一行:

```markdown
| `ui_measure_layout` | headless 整树 computed rect 测量(等布局稳定后输出,可带 expect_tree diff) |
```

「layout 字段」表后追加小节:

```markdown
### rect 绝对几何(spec v0.31)

无 `layout` 字段的节点支持 `rect: {x, y, w, h}`(相对**父节点**左上角),由锚点求解器反解为 anchors+offsets:

- **父必须非 Container**:HBoxContainer 等容器父会强制重排子节点,rect 会被运行时跳过并给出 warning(需要容器内定位请重构为非容器父或兄弟节点)。
- `rect` 优先于 `anchor_preset`;显式写四值 anchors+offsets,不用 set_anchors_preset(引擎陷阱:preset 不重置 offsets)。

### justify space-* 行为(v0.31)

`space-between/around/evenly` 通过注入 `_spacer_N` Control 节点实现(SIZE_EXPAND + stretch_ratio),**不再是近似映射**;注入节点计入 warnings。与子节点 `flex.grow` 并存时分配语义与 CSS 不同,会有 warning。

### 布局收敛闭环

`ui_build_layout(tree 含 rect)` → `ui_measure_layout(expect_tree=同 tree)` → 按 diff 的 Δ 数字修 tree → 循环至全绿 → `ui_build_layout(persist=true)` 原子写 .tscn。
```

- [ ] **Step 2: 同步 `src/tools/rule-templates.ts` UI 段**

grep `godot-mcp-ui` 定位 `DETAILED_RULE_TEMPLATES` 的 UI 模板段(`:380` 附近),把 Step 1 的同等内容(工具行 + 三个小节)同步进模板字符串——**逐段核对两份一致**(独立副本约束,AGENTS.md「独立副本同步约束」)。

- [ ] **Step 3: 版本 bump + CHANGELOG**

```bash
npm version patch --no-git-tag-version
```

`CHANGELOG.md` 顶部新版本段(版本号以 `package.json` bump 后为准):

```markdown
## [0.30.1] - 2026-08-16

### Added
- `ui_measure_layout`:headless 整树 computed rect 测量,支持 expect_tree 逐节点 diff/重叠/越界清单
- `ui_build_layout` rect 绝对几何 + 锚点求解(anchors+offsets 反解)
- `ui_build_layout` persist 原子写持久化

### Fixed
- justify `space-between/space-around/space-evenly` 由近似映射改为 spacer 注入真实现(原映射语义丢失)
```

- [ ] **Step 4: matrix + budget + 全量门禁**

```bash
npm run build && npm run build-matrix && npm run diff-matrix && npm run check:budget && npm run check:rules-version 2>/dev/null; npm run lint && npm test
```
预期:全绿(diff-matrix 只显示 ui 工具描述变化;check:budget 不超预算)。

- [ ] **Step 5: commit + 验证核查**

```bash
grep -c "ui_measure_layout" src/tools/rule-templates.ts   # 预期 ≥1(双副本同步核查,AGENTS.md 强制)
git add .claude/rules/godot-mcp-ui.md src/tools/rule-templates.ts CHANGELOG.md package.json docs/capability-matrix.json docs/capability-matrix.md
git commit -m "docs(ui): 规则双副本同步布局保真能力 + 版本 bump + matrix 重建"
```

- [ ] **Step 6: 审查与 memory(AGENTS.md 强制流程)**

- 派 code-reviewer 子代理对整个 feature 分支做第三方审查,报告落 `docs/reviews/2026-08-16-ui-layout-fidelity-implementation.md`。
- 登 memory:`feature-decision-log`(commit 清单/设计决策/deferred 项)+ 工程教训。

---

## Self-Review(已执行)

1. **Spec 覆盖**:§3.3→Task 1;§3.2→Task 2;§3.1→Task 3;§3.1 expect_tree/§4→Task 4;§3.4→Task 5;§7 改动面清单→Task 6(Step 1-4 覆盖 rule-templates/bump/matrix/budget;TOOL_META/ACTIONS/SLIM_CONFIG 已在 Task 3 注册)。验收标准 1(闭环 |Δ|≤2px)= Task 4 diff 容差默认 2 + 集成断言;验收 2 = Task 1 Step 6 数值断言;验收 3 = Task 5 Step 5。
2. **占位符扫描**:Task 2 Step 5 与 Task 3 Step 6 各有一处标注"实施时以实际 header/拼接为准"的⚠️——这是对既有代码形状的运行时确认指引(附了 grep 定位),非"稍后再写"占位;其余步骤均含完整代码。
3. **类型一致性**:`Rect`/`AnchorsOffsets`/`MeasuredNode`/`DiffEntry` 在 Task 2/3/4 间签名一致;`genUiMeasureScript(scenePath, nodePath|undefined, maxDepth)` 与 Task 3/5 调用一致;`genUiBuildLayoutScript` 第 4 参 `persist` 在 Task 5 定义、Task 1-4 调用不传(默认 false,兼容)。
