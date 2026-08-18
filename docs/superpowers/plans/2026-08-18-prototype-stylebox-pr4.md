# 原型翻译层 PR-4(单 spawn 合成)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ui_import_prototype` 内部链由两次 Godot spawn(首版实测 ~6s)合成单 spawn 完成 build→persist→reload→measure,reload 用 `ResourceLoader.load(path, "", ResourceLoader.CACHE_MODE_IGNORE)` 绕过 ResourceCache,并以「篡改磁盘后 reload 测出差异」断言防 reload 假绿(spec §6 验收标准 4)。

**Architecture:** 新建独立脚本模板 `src/tools/ui/ui-import-single.ts`(二轮审阅 N-2 拍板:不扩 ui-measure、不动共享 `_mcp_load_scene`),组装方式沿 `test/integration/ui-layout-integration.test.ts` 的 buildThenMeasure 已验证先例:`genUiBuildLayoutScript(persist=true)` 尾部 `layout_built+_mcp_done` 替换为 `call_deferred("_measure_go")`,拼接 `genUiMeasureScript` 输出截取的测量核心(剥离其 `_initialize`),追加自带 CACHE_MODE_IGNORE reload 分支的 `_measure_go`。handler 侧一次 executor 调用;顺手清 PR-3 终审 M-1/M-2/M-7 三处规则双副本措辞(一次 patch bump 摊销)。

**Tech Stack:** TypeScript(ES2022/strict/ESM,import 带 .js)+ GDScript(full-class `extends SceneTree`,executor 链 `executeGdscriptTrusted`)+ Vitest。

## Global Constraints(每个 task 隐含遵守)

- **分支**:`feat/prototype-stylebox-pr4`,从 master `750dc8c`(v0.32.3,PR-3 merge 后)开;SDD 惯例照 PR-1/2/3(每 task 独立 commit + code-reviewer 审查)。
- **spec §6 形态拍板**:①不扩展 `genUiMeasureScript`(build 同步生命周期与 measure 异步稳定生命周期不混);②共享 `_mcp_load_scene`(`src/core/shared/gdscript-templates.ts`)**零改动**——合成脚本自带 reload 分支;③capture **不并入**(`ui_pixel_verify` 保持独立调用,窗口模式 driver 参数不同)。
- **B-1 契约保持**:persist 固定先于 measure(B-1 原契约:measure 读磁盘场景,不持久化则 verify 全部 actual:null);reload 阶段错误信息内嵌「build 已持久化,可重跑 ui_measure_layout」恢复语义。
- **验收断言含「篡改磁盘后 reload 测出差异」**(spec §6,防 reload 假绿)+ 耗时对比记录(spec §7)。
- **禁止编辑**:`build/`、`docs/capability-matrix.*`(产物;本批无工具清单变更,预期 no drift)、`.godot/`;`src/screenshot.ts`/`src/scripts/screenshot_capture.gd` 不涉及(挂账独立任务,勿顺手)。
- **GDScript 验证**:改 `.gd` 模板字符串(TS 内嵌)后走真跑 Godot 的集成测试(Task 3);本批不改 `addons/**/*.gd`,不需 `check:gdscript`。
- **完成门禁**(Task 4 全跑):`npm run lint` + `npm run build` + `npm test` + `npm run build-matrix && npm run diff-matrix`(预期 no drift)+ `npm run check:budget` + `STRICT=1 npm run check:rules-sync`(需先 build;本批动双副本必跑)+ `npm run version-check`(0.32.4)。
- **挂账不碰**:screenshot_capture.gd `_detect_blank_image` 步进退化(独立任务);PR-2 T3c(sp/np gdEscape 残留 ui-measure.ts——注意:Task 1 改 ui-measure.ts 时**不得顺手修**,那是独立小修批);spec §10.5 决策输入(flow FILL h=39 vs 40 根因/flow 容差阈值)继续留 spec,本批不处置。
- 集成测试 Windows-only skip 先例(`test/integration/ui-import-integration.test.ts:30` `const run = !!GODOT && process.platform === 'win32'`);工作目录一律 `D:\GitHub\godot-mcp-series\godot-mcp-enhanced`。

---

### Task 1: 单 spawn 合成脚本模板(genStyleExpectInit 提取 + ui-import-single.ts)

**Files:**
- Modify: `src/tools/ui/ui-measure.ts`(styleInit 生成逻辑提取为导出函数,纯 refactor)
- Create: `src/tools/ui/ui-import-single.ts`(新模板,本批核心)
- Test: `test/ui-import-single.test.ts`(新建)

**Interfaces:**
- Consumes: `genUiBuildLayoutScript(scenePath, parentPath, tree, viewport, persist)`(src/tools/ui/ui-layout.ts:697)、`genUiMeasureScript(scenePath, nodePath, maxDepth, styleExpect?)`(src/tools/ui/ui-measure.ts:25)、`gdEscape`(src/tools/shared.ts)、`UiNodeSpec`(src/tools/ui/types.ts:120)
- Produces: `genUiImportSingleScript(scenePath: string, parentPath: string, tree: UiNodeSpec, viewport: { w: number; h: number }, styleExpect?: ReadonlyArray<{ path: string; slots: readonly string[] }>): string`(Task 2 handler 消费);`genStyleExpectInit(styleExpect?): string`(从 genUiMeasureScript 内部逻辑提取,两处共用)

- [ ] **Step 1: 写失败测试(test/ui-import-single.test.ts 全新文件)**

```typescript
// test/ui-import-single.test.ts
// PR-4 Task 1 TDD:ui_import_prototype 单 spawn 合成脚本模板(spec §6)结构契约。
// 三段组装:①genUiBuildLayoutScript(persist=true) 尾部 layout_built+_mcp_done 替换为
// call_deferred("_measure_go");②genUiMeasureScript 输出自 'var _frames := 0' 截取并
// 剥离 _initialize(其 _mcp_load_scene 是裸 load,同进程二载命中 ResourceCache 旧实例
// ——spec B-1,reload 分支由 _measure_go 自带);③追加 _measure_go(引用全部前向声明,
// 规避 GDScript 前向引用风险——buildThenMeasure 先例实证的结构)。
import { describe, it, expect } from 'vitest';
import { genUiImportSingleScript } from '../src/tools/ui/ui-import-single.js';
import type { UiNodeSpec } from '../src/tools/ui/types.js';

const TREE: UiNodeSpec = {
  type: 'Panel', name: '_PrototypeRoot', rect: { x: 0, y: 0, w: 800, h: 600 },
  children: [
    { type: 'Label', name: 'Title', rect: { x: 10, y: 20, w: 200, h: 24 } },
  ],
};

describe('genUiImportSingleScript 组装结构契约', () => {
  const script = genUiImportSingleScript('res://scene.tscn', '/root', TREE, { w: 800, h: 600 });

  it('build 尾部替换:含 call_deferred("_measure_go"),不含 layout_built 输出', () => {
    expect(script).toContain('call_deferred("_measure_go")');
    expect(script).not.toContain('"layout_built"');
  });

  it('reload 分支带 CACHE_MODE_IGNORE(spec B-1 核心契约)', () => {
    expect(script).toContain('ResourceLoader.load');
    expect(script).toContain('ResourceLoader.CACHE_MODE_IGNORE');
  });

  it('persist 块与 measure 核心均在(单进程合成完整链)', () => {
    expect(script).toContain('ResourceSaver.save');           // build 侧原子写
    expect(script).toContain('process_frame.connect');        // measure 侧稳定等待
    expect(script).toContain('_on_measure_frame');
    expect(script).toContain('_all_slots');                    // PR-2 style 读回核心
  });

  it('函数零重复定义(SCENE_TREE_HEADER 只一份,measure _initialize 已剥离)', () => {
    expect(script.match(/func _initialize\(\):/g)).toHaveLength(1);
    expect(script.match(/func _mcp_load_scene\(/g)).toHaveLength(1);
    expect(script.match(/func _measure_go\(\)/g)).toHaveLength(1);
    expect(script.match(/func _on_measure_frame\(/g)).toHaveLength(1);
  });

  it('reload 错误信息内嵌恢复语义(persist 先于 measure,spec §6)', () => {
    expect(script).toContain('Scene reload failed (post-persist)');
    expect(script).toContain('已持久化,可重跑 ui_measure_layout');
  });

  it('np 定位段按 parentPath 注入(_mcp_get_scene_node,与 measure _initialize 同款)', () => {
    expect(script).toContain('_mcp_get_scene_node("/root")');
    const nonRoot = genUiImportSingleScript('res://scene.tscn', '/Main/HUD', TREE, { w: 800, h: 600 });
    expect(nonRoot).toContain('_mcp_get_scene_node("/Main/HUD")');
  });
});

describe('genUiImportSingleScript styleExpect 注入', () => {
  it('期望清单非空 → _measure_go 内嵌 JSON.parse_string + path 键', () => {
    const s = genUiImportSingleScript('res://scene.tscn', '/root', TREE, { w: 800, h: 600 },
      [{ path: '_PrototypeRoot', slots: ['panel'] }]);
    expect(s).toContain('JSON.parse_string');
    expect(s).toContain('_PrototypeRoot');
    // 注入位置在 _measure_go(非 build 段):parse 行出现在 _measure_go 之后
    expect(s.indexOf('JSON.parse_string')).toBeGreaterThan(s.indexOf('func _measure_go'));
  });

  it('期望清单空 → 不注入 JSON.parse_string(_style_expect 保持空字典)', () => {
    const s = genUiImportSingleScript('res://scene.tscn', '/root', TREE, { w: 800, h: 600 }, undefined);
    expect(s).not.toContain('JSON.parse_string');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/ui-import-single.test.ts`
Expected: FAIL(模块 `../src/tools/ui/ui-import-single.js` 不存在,import 报错)

- [ ] **Step 3: ui-measure.ts 提取 genStyleExpectInit(纯 refactor)**

在 `src/tools/ui/ui-measure.ts` 中,把 `genUiMeasureScript` 内的 styleInit 三元表达式(当前 `const styleInit = styleExpect && styleExpect.length > 0 ? ... : '';`,含 escapeForGdLiteral 那两行模板串)替换为 `const styleInit = genStyleExpectInit(styleExpect);`,并在 `genUiMeasureScript` 函数**上方**新增导出函数(注释块中原「I-1(2026-08-18 Task3 审查修复)」的转义语义说明随迁):

```typescript
/** PR-4 抽取:styleExpect 期望清单 parse 注入行(genUiMeasureScript._initialize 与
 * ui-import-single._measure_go 共用一份构造与转义,防双份漂移)。
 * 转义语义(I-1):escapeForGdLiteral 供 GD 侧 JSON.parse_string 消费;gdEscape 为 %
 * 格式化场景设计会把 name 中 % 双写,此处禁用。空清单返回 ''(_style_expect 保持 {})。 */
export function genStyleExpectInit(
  styleExpect?: ReadonlyArray<{ path: string; slots: readonly string[] }>,
): string {
  if (!styleExpect || styleExpect.length === 0) return '';
  return `\tvar _se_parsed = JSON.parse_string("${escapeForGdLiteral(JSON.stringify(Object.fromEntries(styleExpect.map(e => [e.path, [...e.slots]]))))}")\n\t_style_expect = _se_parsed if typeof(_se_parsed) == TYPE_DICTIONARY else _style_expect\n`;
}
```

注意:模板字符串内容与原 styleInit 逐字一致(仅搬运,不改语义);原注释中「声明位置必须在 `var _frames := 0` 之后:ui-layout-integration 的 buildThenMeasure 以 'var _frames := 0' 为截取锚点」段保留在原处,并在末尾补一句 `// PR-4:ui-import-single.ts 同以该锚点截取(见其组装注释)`。

- [ ] **Step 4: 新建 src/tools/ui/ui-import-single.ts(完整文件)**

```typescript
// ui_import_prototype 单 spawn 合成脚本模板(spec §6,PR-4)——build→persist→reload→
// measure 一次 Godot 进程完成(原两次 spawn 首版实测 ~6s,耗时留档
// test/integration/ui-import-integration.test.ts)。
// 形态拍板(spec §6 二轮审阅 N-2):独立模板文件,不扩 ui-measure——build 走 _initialize
// 同步语义、measure 走 process_frame 异步稳定语义,两种生命周期不混进 genUiMeasureScript;
// 共享 _mcp_load_scene(gdscript-templates.ts)零改动——本模板 reload 分支自带
// CACHE_MODE_IGNORE,不影响全部既有调用方。
// 组装三段(沿 test/integration/ui-layout-integration.test.ts buildThenMeasure 真跑验证
// 先例):①genUiBuildLayoutScript(persist=true) 尾部 layout_built+_mcp_done 替换为
// call_deferred("_measure_go");②genUiMeasureScript 输出自 'var _frames := 0' 截取并
// 剥离其 _initialize(裸 load 同进程二载命中 ResourceCache 旧实例——spec B-1,reload
// 分支由 _measure_go 自带);③追加 _measure_go:styleInit → reload → np 定位 → connect,
// 引用全部前向声明(规避 GDScript 前向引用风险)。
// reload 错误信息内嵌「build 已持久化,可重跑」恢复语义(persist 先于 measure 的既有
// 顺序;原两阶段流程的 TS 侧 hint-append 随第二次 spawn 删除,阶段语义由模板自持)。
import { gdEscape } from '../shared.js';
import { genUiBuildLayoutScript } from './ui-layout.js';
import { genUiMeasureScript, genStyleExpectInit } from './ui-measure.js';
import type { UiNodeSpec } from './types.js';

export function genUiImportSingleScript(
  scenePath: string,
  parentPath: string,
  tree: UiNodeSpec,
  viewport: { w: number; h: number },
  styleExpect?: ReadonlyArray<{ path: string; slots: readonly string[] }>,
): string {
  const sp = gdEscape(scenePath);
  const np = gdEscape(parentPath);
  // np 定位段:与 genUiMeasureScript _initialize 同款(_mcp_get_scene_node 支持场景根名
  // 前缀剥离,parentPath="/root" 时 _target=场景根;非 root 挂载时定位挂载父——measure
  // path 与 flattenTargets 树根名起算的对齐前提)。
  const npLookup = `\tif "${np}" != "":
\t\tvar _n = _mcp_get_scene_node("${np}")
\t\tif _n == null:
\t\t\t_mcp_output("error", "Node not found (post-persist): ${np} —— build 已持久化,可重跑 ui_measure_layout")
\t\t\t_mcp_done()
\t\t\treturn
\t\t_target = _n
`;
  const measureGo = `func _measure_go() -> void:
${genStyleExpectInit(styleExpect)}\t# --- reload(spec §6 B-1:绕过 ResourceCache 读新落盘场景;裸 load 同进程
\t# 二载命中缓存返回旧实例(无新子树)→ verify 全红,故必须 CACHE_MODE_IGNORE)---
\tif _mcp_scene_instance != null:
\t\tif _mcp_scene_instance.get_parent() != null:
\t\t\t_mcp_scene_instance.get_parent().remove_child(_mcp_scene_instance)
\t\t_mcp_scene_instance.queue_free()
\t\t_mcp_scene_instance = null
\tvar _rl = ResourceLoader.load("${sp}", "", ResourceLoader.CACHE_MODE_IGNORE)
\tif _rl == null or not (_rl is PackedScene):
\t\t_mcp_output("error", "Scene reload failed (post-persist): ${sp} —— build 已持久化,可重跑 ui_measure_layout")
\t\t_mcp_done()
\t\treturn
\t_mcp_scene_instance = _rl.instantiate()
\troot.add_child(_mcp_scene_instance)
\t_target = _mcp_scene_instance
${npLookup}\tprocess_frame.connect(_on_measure_frame)
`;

  // ① build 段尾替换。锚点守卫:genUiBuildLayoutScript 结构变更导致替换未命中时,静默
  // 产出「build 完 _mcp_done 不测量」的假脚本——fail fast 在生成期。
  const buildBlock = genUiBuildLayoutScript(scenePath, parentPath, tree, viewport, true)
    .replace(/\t_mcp_output\("layout_built"[\s\S]*?\t_mcp_done\(\)\n$/, '\tcall_deferred("_measure_go")\n');
  if (!buildBlock.endsWith('\tcall_deferred("_measure_go")\n')) {
    throw new Error('ui-import-single: build 尾部锚点(layout_built+_mcp_done)替换未命中——genUiBuildLayoutScript 结构变更需同步本模板');
  }

  // ② measure 核心截取。锚点守卫同上:indexOf -1 会让 slice 静默产出损坏脚本。
  const measureFull = genUiMeasureScript(scenePath, parentPath, 16, styleExpect);
  const anchorIdx = measureFull.indexOf('var _frames := 0');
  if (anchorIdx < 0) {
    throw new Error('ui-import-single: ui-measure 截取锚点 "var _frames := 0" 缺失——genUiMeasureScript 结构变更需同步本模板');
  }
  const measureCore = measureFull
    .slice(anchorIdx)
    .replace(/\nfunc _initialize\(\):[\s\S]*?(?=\nfunc _on_measure_frame)/, '\n');
  if (measureCore.includes('func _initialize')) {
    throw new Error('ui-import-single: measure _initialize 剥离未命中(锚点 regex 失配)——genUiMeasureScript 结构变更需同步本模板');
  }

  return `${buildBlock}${measureCore}${measureGo}`;
}
```

- [ ] **Step 5: 跑模板单测 + ui-measure 既有单测(纯 refactor 保护)**

Run: `npx vitest run test/ui-import-single.test.ts test/ui-measure.test.ts`
Expected: 全 PASS(新 9 用例绿;ui-measure 既有用例零回归)

- [ ] **Step 6: 全量回归(快速门禁)**

Run: `npm run lint && npm run build && npx vitest run test/ui-import-prototype.test.ts`
Expected: lint 0 / build 0 / 既有 handler 单测全绿(此时尚未切 handler,行为不变)

- [ ] **Step 7: Commit**

```bash
git add src/tools/ui/ui-measure.ts src/tools/ui/ui-import-single.ts test/ui-import-single.test.ts
git commit -m "feat(ui): PR-4 单 spawn 合成脚本模板 ui-import-single(CACHE_MODE_IGNORE reload 分支+锚点守卫)"
```

---

### Task 2: handler 切单 spawn + 单测 mock 契约改写

**Files:**
- Modify: `src/tools/ui/index.ts`(handleUiImportPrototype 内部链,约 :622-723)
- Test: `test/ui-import-prototype.test.ts`(mock 两段→一段,断言改写)

**Interfaces:**
- Consumes: `genUiImportSingleScript`(Task 1 产出,签名见上)
- Produces: handler 行为契约不变(返回 `{tree, build_warnings, measure, verify_coverage, layout_verify, style_verify, flow_verify, persist}`);executor 调用次数 2→1,单次调用 script 含 CACHE_MODE_IGNORE

- [ ] **Step 1: 改写单测 mock 与断言(先红)**

`test/ui-import-prototype.test.ts`:

1) `mockTwoPhase` 函数改为单段(mock 顺序:warnings 可无→persist→measure 合并一次返回),并同步改 `mockTwoPhaseStyles`。原:

```typescript
/** 两段 mock:第一次 build,第二次 measure。返回 executor 调用参数记录。 */
function mockTwoPhase(dOffset = 0) {
  execMock.mockReset();
  execMock.mockResolvedValueOnce(mockSuccessResult({ outputs: buildOutputs() }));
  execMock.mockResolvedValueOnce(mockSuccessResult({ outputs: measureOutputs(dOffset) }));
}
```

改为:

```typescript
/** 单段 mock(PR-4):一次 executor 调用合并返回 build(persist)+measure 输出。 */
function mockSinglePhase(dOffset = 0) {
  execMock.mockReset();
  execMock.mockResolvedValueOnce(mockSuccessResult({ outputs: [...buildOutputs(), ...measureOutputs(dOffset)] }));
}
```

`mockTwoPhaseStyles(dropStyles = false)` 同理改为 `mockSinglePhaseStyles`:

```typescript
function mockSinglePhaseStyles(dropStyles = false) {
  execMock.mockReset();
  execMock.mockResolvedValueOnce(mockSuccessResult({ outputs: [...buildOutputs(), ...styleMeasureOutputs(dropStyles)] }));
}
```

(`buildOutputs`/`measureOutputs`/`styleMeasureOutputs` 本体不动——输出键名契约不变。)

2) 全文件调用点替换:`mockTwoPhase(` → `mockSinglePhase(`、`mockTwoPhaseStyles(` → `mockSinglePhaseStyles(`(grep 核对零残留:`grep -n "mockTwoPhase" test/ui-import-prototype.test.ts` 应无命中)。

3) 用例「返回 data 含 tree/…,executor 恰两次」改断言(标题与断言同步):

```typescript
  it('返回 data 含 tree/build_warnings/measure/verify_coverage/layout_verify,executor 恰一次(单 spawn)', async () => {
    // ...(前半 data 断言全部保持不变)...
    // 单 spawn(PR-4):一次调用合成 build(含 persist 原子写)+reload+measure
    expect(execMock).toHaveBeenCalledTimes(1);
    const code = execMock.mock.calls[0]![0] as { code: string };
    expect(code.code).toContain('ResourceSaver.save');
    expect(code.code).toContain('_PrototypeRoot');
    expect(code.code).toContain('process_frame.connect');
    expect(code.code).toContain('ResourceLoader.CACHE_MODE_IGNORE');
    expect(code.code).toContain('call_deferred("_measure_go")');
  });
```

4) 「固定持久化」用例:`execMock.mock.calls[0]` 改为唯一调用(变量名 `firstCode` 可保留,取 `[0]`)。

5) 「measure 阶段失败」用例(原断言 TS 侧拼接提示)整用例替换为错误透传用例——恢复语义已移入模板(Task 1 断言 + Task 3 集成端到端覆盖):

```typescript
  it('错误透传:executor error 输出(Parent not found)→ isError 且 message 原样返回', async () => {
    execMock.mockReset();
    execMock.mockResolvedValueOnce(mockSuccessResult({ outputs: [
      { key: 'error', value: 'Parent not found: /root' },
    ] }));
    const result = await handleTool('ui', {
      action: 'ui_import_prototype', project_path: '/fake/p', scene_path: 'res://scene.tscn',
      geometry: GEO,
    }, createCtx());
    expect(result!.isError).toBe(true);
    const parsed = JSON.parse(textOf(result));
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('Parent not found: /root');
  });
```

6) PR-2 段两处 second 断言改单调用:「measure 脚本生成参数含期望清单」用例的

```typescript
    expect(execMock).toHaveBeenCalledTimes(2);
    const secondCode = execMock.mock.calls[1]![0] as { code: string };
    expect(secondCode.code).toContain('JSON.parse_string');
    expect(secondCode.code).toContain('Holder_Flow');
```

改为:

```typescript
    expect(execMock).toHaveBeenCalledTimes(1);
    const code = execMock.mock.calls[0]![0] as { code: string };
    expect(code.code).toContain('JSON.parse_string');
    expect(code.code).toContain('Holder_Flow');
```

「无 stylebox 无 flow」用例:mock 体的两次 `mockResolvedValueOnce` 合并为一次(`[...buildOutputs(), ...measure 输出]`),断言 `execMock.mock.calls[1]` → `execMock.mock.calls[0]`。

7) 文件头注释第 3 行「mock executeGdscriptTrusted 两段返回(先 build 后 measure,spec 开放问题 3 首版两次 spawn 方案)」改为「mock executeGdscriptTrusted 单段返回(PR-4 单 spawn 合成,spec §6:build+persist+reload(CACHE_MODE_IGNORE)+measure 一次调用)」。

- [ ] **Step 2: 跑单测确认失败**

Run: `npx vitest run test/ui-import-prototype.test.ts`
Expected: FAIL(被 mocks 的 handler 仍调两次 executor,断言 `toHaveBeenCalledTimes(1)` 红)

- [ ] **Step 3: handler 切单 spawn**

`src/tools/ui/index.ts`:

1) 顶部 import 段(:16 附近)加:

```typescript
import { genUiImportSingleScript } from './ui-import-single.js';
```

2) `handleUiImportPrototype` 的 JSDoc(:572-577)中「build(**固定 persist=true**,B-1 契约:measure 是第二次 Godot spawn 从磁盘 load 场景,不持久化则 verify 全部 actual:null;因此也不入 UI_PERSIST_ACTIONS,无"退出即丢"可提示)→ measure → diffLayout(目标=翻译树)→ 组装 {tree, build_warnings, measure, verify_coverage, layout_verify}。两次 spawn 是首版简单方案(spec 开放问题 3)。」改为「build(**固定 persist=true**)+persist→reload(CACHE_MODE_IGNORE)→measure **单 spawn 合成**(PR-4,spec §6;原两次 spawn 首版实测 ~6s)。B-1 契约保持:measure(reload)读磁盘场景,不持久化则 verify 全部 actual:null;因此也不入 UI_PERSIST_ACTIONS,无"退出即丢"可提示)→ diffLayout(目标=翻译树)→ 组装 {tree, build_warnings, measure, verify_coverage, layout_verify}。」

3) 替换核心段。原(自「// ① build(固定 persist=true)」至 measure 错误 hint 块结束,即 :622-672 一整段):

```typescript
  // ① build(固定 persist=true):挂 parentPath 下,合成根 _PrototypeRoot rect=viewport。
  const buildScript = genUiBuildLayoutScript(scenePath, parentPath, translated.tree, viewport, true);
  const buildResult = await executeGdscriptTrusted({
    godotPath: godot, projectPath, code: buildScript, timeout: 30, loadAutoloads,
  });
  const buildParsed = parseGdscriptResult(buildResult, [], uiErrorMapper);
  if (buildParsed.isError) return buildParsed;

  const buildOut = JSON.parse((buildParsed.content?.[0] as { text?: string } | undefined)?.text ?? '{}') as {
    data?: { persist?: { saved?: boolean }; warnings?: unknown[] };
  };
```

改为:

```typescript
  // ① 单 spawn 合成(PR-4,spec §6):build→persist→reload(CACHE_MODE_IGNORE)→measure
  // 一次 Godot 进程完成。固定 persist=true 保持 B-1 契约——measure(reload)读的是磁盘
  // 场景,不持久化则 verify 全部 actual:null。reload 阶段错误信息由模板内嵌
  // 「build 已持久化,可重跑 ui_measure_layout」恢复语义(persist 先于 measure),TS 侧
  // 不再二次拼接(原两阶段流程的 hint-append 逻辑随第二次 spawn 一起删除)。
  const styleTargets = flattenStyleTargets(translated.tree);
  const singleScript = genUiImportSingleScript(scenePath, parentPath, translated.tree, viewport, styleExpectList(styleTargets));
  const singleResult = await executeGdscriptTrusted({
    godotPath: godot, projectPath, code: singleScript, timeout: 30, loadAutoloads,
  });
  const parsed = parseGdscriptResult(singleResult, [], uiErrorMapper);
  if (parsed.isError) return parsed;

  let out: {
    data?: {
      persist?: { saved?: boolean };
      warnings?: unknown[];
      measure?: { nodes?: MeasuredNode[]; viewport?: { w: number; h: number }; stable_after_frames?: number; stalled?: boolean };
    };
    warnings?: string[];
  };
  try {
    out = JSON.parse((parsed.content?.[0] as { text?: string } | undefined)?.text ?? '{}');
  } catch {
    return parsed;
  }
```

4) buildWarnings 组装段:`buildOut.data?.warnings ?? []` → `out.data?.warnings ?? []`;`buildOut.data?.persist?.saved !== true` → `out.data?.persist?.saved !== true`(其余不动)。

5) **整段删除**原「② measure(第二次 spawn)」块(自 `// ② measure(第二次 spawn):nodePath=挂载父节点` 注释起,含 `const styleTargets = flattenStyleTargets(...)`、`const measureScript = genUiMeasureScript(...)`、第二个 `executeGdscriptTrusted` 调用、`measureParsed` 错误处理与 hint-append,至该 if 块闭合;styleTargets 已在 ① 前移计算)。

6) ③ 组装段:`measureOut` 全部改 `out`,try/catch 的 catch 返回值 `return measureParsed` → `return parsed`;段首注释改「③ 组装返回(单 spawn:measure 与 build 输出同批;输出异常保持原样,diff 缺失由 AI 视为未验证)」;末行 `opsSuccess({...}, measureOut.warnings ?? [])` → `opsSuccess({...}, out.warnings ?? [])`。

7) 清 import:`genUiBuildLayoutScript`/`genUiMeasureScript` **保留**(ui_build_layout :435 / ui_measure_layout :461 仍用);`flattenStyleTargets`/`styleExpectList` 已在 :17(保留)。

- [ ] **Step 4: 跑单测确认全绿**

Run: `npx vitest run test/ui-import-prototype.test.ts test/ui-import-single.test.ts`
Expected: 全 PASS

- [ ] **Step 5: 快速门禁**

Run: `npm run lint && npm run build && npx vitest run test/ui-tools.test.js test/prototype-import.test.ts`
Expected: 全绿(相邻工具零回归)

- [ ] **Step 6: Commit**

```bash
git add src/tools/ui/index.ts test/ui-import-prototype.test.ts
git commit -m "refactor(ui): ui_import_prototype 内部链切单 spawn——executor 2 次调用合 1,恢复语义内嵌模板"
```

---

### Task 3: 集成验收——耗时记录 + 篡改磁盘断言(真跑 Godot)

**Files:**
- Modify: `test/integration/ui-import-integration.test.ts`(耗时措辞/回归绊线 + 新增 PR-4 describe 块)

**Interfaces:**
- Consumes: `genUiImportSingleScript`(executor 层直调,沿文件内 `measureFromDisk` 先例,不经 handler)、`mkProject` helper、`executeGdscriptTrusted`
- Produces: spec §6 验收证据(篡改磁盘后 reload 测出差异 + reload 失败恢复语义 + 单 spawn 耗时数据,CHANGELOG Task 4 引用)

**前提**:环境变量 `GODOT_PATH` 指向 Godot ≥4.6(本机惯例 `D:/godot/Godot_v4.7.1-stable_win64.exe`);Windows 平台。

- [ ] **Step 1: 更新耗时记录措辞 + 回归绊线**

1) 文件头注释区(:30-31 附近)`// 集成耗时记录(spec 开放问题 3:两次 spawn 首版方案实测数据,供单 spawn 优化决策)`改为`// 集成耗时记录:两次 spawn 首版实测 ~6s(历史基线,spec §6 决策依据);PR-4 起单 spawn 合成,importElapsedMs 为单 spawn 耗时`。

2) 用例 1(RTS)中 `importElapsedMs = Date.now() - t0;` 之后追加:

```typescript
    // PR-4 耗时回归绊线:单 spawn 合成后应显著低于两次 spawn 基线(~6s);上限 10s
    // (>3x 余量,CI 2 核 runner 安全)。数值留档进 CHANGELOG 0.32.4 段。
    expect(importElapsedMs).toBeLessThan(10_000);
```

3) afterAll 的 log(:83)文案:`RTS 一次调用(handler 内 build+measure 两次 spawn)实测耗时` → `RTS 一次调用(PR-4 单 spawn 合成:build+persist+reload+measure)实测耗时(两次 spawn 历史基线 ~6s)`。

- [ ] **Step 2: 新增 PR-4 describe 块(篡改磁盘断言)**

在文件末尾(最后一个 describe 之后)新增;import 区补 `import { genUiImportSingleScript } from '../../src/tools/ui/ui-import-single.js';` 与 `import type { UiNodeSpec } from '../../src/tools/ui/types.js';`:

```typescript
// ─── PR-4:reload CACHE_MODE_IGNORE 断言(spec §6 验收:篡改磁盘,防 reload 假绿)───
// 注入方式沿 buildThenMeasure 先例:call_deferred("_measure_go") 替换为 _tamper_go
// (写盘篡改后调真 _measure_go)——被测 reload+measure 逻辑零改动。若 reload 回退为裸
// load,同进程二载命中 ResourceCache 里 build 前 load 的原场景(1280x720 无子树),
// 篡改内容(100x50)测不到 → 断言红;只有真读磁盘才绿。
describe.skipIf(!run)('PR-4 单 spawn 合成与篡改磁盘断言(真跑 Godot)', () => {
  const TREE: UiNodeSpec = { type: 'Panel', name: 'P', rect: { x: 10, y: 10, w: 200, h: 100 }, children: [] };

  function withTamperHook(script: string, sceneAbs: string, tamperedTscn: string): string {
    // GD 字符串字面量:JSON.stringify 产出的转义(\" 与 \n)恰为 GDScript 同款转义;
    // 路径统一正斜杠(Windows Godot 兼容,且免反斜杠转义问题)
    const gd = `func _tamper_go() -> void:
\tvar _f := FileAccess.open("${sceneAbs.replace(/\\/g, '/')}", FileAccess.WRITE)
\t_f.store_string(${JSON.stringify(tamperedTscn)})
\t_f.close()
\t_measure_go()
`;
    const hooked = script.replace('call_deferred("_measure_go")', 'call_deferred("_tamper_go")');
    expect(hooked).not.toBe(script); // 锚点命中护栏:注入失败即测试红
    return hooked + gd;
  }

  it('单 spawn 合成:build→persist→reload→measure 一次进程完成,P 节点 rect 正确', { timeout: 90000 }, async () => {
    const d = mkProject('ui-import-single-');
    try {
      const res = await executeGdscriptTrusted({
        godotPath: GODOT!, projectPath: d,
        code: genUiImportSingleScript(join(d, 'main.tscn'), 'root', TREE, { w: 1280, h: 720 }, undefined),
        timeout: 30, loadAutoloads: false,
      });
      expect(res.compile_success, res.compile_error).toBe(true);
      expect(res.run_success, res.run_error).toBe(true);
      expect(res.outputs.some(o => o.key === 'error')).toBe(false);
      const persist = res.outputs.find(o => o.key === 'persist');
      expect(persist).toBeTruthy();
      expect(JSON.parse(String(persist!.value)).saved).toBe(true);
      const measure = JSON.parse(String(res.outputs.find(o => o.key === 'measure')!.value)) as {
        nodes: Array<{ path: string; rect: { x: number; y: number; w: number; h: number } }>;
      };
      const p = measure.nodes.find(n => n.path === 'P');
      expect(p).toBeTruthy();
      expect(Math.abs(p!.rect.x - 10)).toBeLessThanOrEqual(1);
      expect(Math.abs(p!.rect.w - 200)).toBeLessThanOrEqual(1);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it('篡改磁盘(换 Hacked 100x50 场景)→ reload 测出篡改内容,证明绕过 ResourceCache', { timeout: 90000 }, async () => {
    const d = mkProject('ui-import-tamper-');
    try {
      const script = genUiImportSingleScript(join(d, 'main.tscn'), 'root', TREE, { w: 1280, h: 720 }, undefined);
      const res = await executeGdscriptTrusted({
        godotPath: GODOT!, projectPath: d,
        code: withTamperHook(script, join(d, 'main.tscn'),
          '[gd_scene format=3]\n\n[node name="Hacked" type="Control"]\noffset_right = 100.0\noffset_bottom = 50.0\n'),
        timeout: 30, loadAutoloads: false,
      });
      expect(res.compile_success, res.compile_error).toBe(true);
      expect(res.run_success, res.run_error).toBe(true);
      expect(res.outputs.some(o => o.key === 'error')).toBe(false);
      const measure = JSON.parse(String(res.outputs.find(o => o.key === 'measure')!.value)) as {
        nodes: Array<{ path: string; rect: { w: number; h: number } }>;
      };
      const rootEntry = measure.nodes.find(n => n.path === '.');
      expect(rootEntry).toBeTruthy();
      expect(Math.abs(rootEntry!.rect.w - 100)).toBeLessThanOrEqual(1);
      expect(Math.abs(rootEntry!.rect.h - 50)).toBeLessThanOrEqual(1);
      expect(measure.nodes.some(n => n.path.includes('P'))).toBe(false);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it('篡改磁盘(垃圾内容)→ reload 失败错误内嵌恢复语义「build 已持久化,可重跑」', { timeout: 90000 }, async () => {
    const d = mkProject('ui-import-tamper-err-');
    try {
      const script = genUiImportSingleScript(join(d, 'main.tscn'), 'root', TREE, { w: 1280, h: 720 }, undefined);
      const res = await executeGdscriptTrusted({
        godotPath: GODOT!, projectPath: d,
        code: withTamperHook(script, join(d, 'main.tscn'), 'this is not a scene file'),
        timeout: 30, loadAutoloads: false,
      });
      expect(res.compile_success, res.compile_error).toBe(true);
      expect(res.run_success, res.run_error).toBe(true);
      const errEntry = res.outputs.find(o => o.key === 'error');
      expect(errEntry).toBeTruthy();
      expect(String(errEntry!.value)).toContain('Scene reload failed (post-persist)');
      expect(String(errEntry!.value)).toContain('已持久化');
      expect(String(errEntry!.value)).toContain('ui_measure_layout');
      // 测量中止:无 measure 输出(build 已持久化在磁盘,可重跑 ui_measure_layout 补测量)
      expect(res.outputs.some(o => o.key === 'measure')).toBe(false);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
```

**实现注记(执行者按实测裁决,不改验收语义)**:第三例若引擎对垃圾文本硬崩(`run_success=false` 而非 null 返回),把篡改内容换成合法但非场景资源(如 `'[gd_resource type="Resource" format=3]\n\n[resource]\n'`)——走模板 `not (_rl is PackedScene)` 分支,同一错误输出同一断言;若发生此裁决,在 commit message 注明。

- [ ] **Step 3: 真跑集成(核心验收)**

Run: `$env:GODOT_PATH="D:/godot/Godot_v4.7.1-stable_win64.exe"; npx vitest run test/integration/ui-import-integration.test.ts`(Git Bash:`GODOT_PATH="D:/godot/Godot_v4.7.1-stable_win64.exe" npx vitest run test/integration/ui-import-integration.test.ts`)
Expected: 全 PASS——重点:①新增 3 用例绿;②**既有用例(RTS 23 节点/css-card/flow/三组合)零改断言全绿**(reload 测的是同一落盘场景,测得值应与两次 spawn 一致;若任何既有断言变红,是真实行为差异,**停下取证根因**,不得为绿改断言);③耗时 log 单 spawn 数值 <10s(记录具体 ms,Task 4 CHANGELOG 引用)

- [ ] **Step 4: 快速门禁**

Run: `npm run lint && npm run build`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add test/integration/ui-import-integration.test.ts
git commit -m "test(ui): PR-4 集成验收——篡改磁盘断言(reload 真读磁盘)+单 spawn 耗时绊线"
```

---

### Task 4: 双副本 M-1/M-2/M-7 + version 0.32.4 + CHANGELOG/README + 全门禁

**Files:**
- Modify: `.claude/rules/godot-mcp-ui.md`(:143 ui_pixel_verify 段,3 处措辞)
- Modify: `src/tools/rule-templates.ts`(:625 镜像段,同样 3 处;注意该文件反引号为 `\`` 转义形态)
- Modify: `CHANGELOG.md`(新增 [0.32.4] 段)、`README.md`(版本表 :641 上方插行)
- Modify: `package.json` 等 8 文件版本号(`npm version patch --no-git-tag-version` + `npm run version-sync`)

**Interfaces:**
- Consumes: Task 3 实测耗时数值(CHANGELOG 引用)
- Produces: v0.32.4 发版就绪状态(全门禁绿)

- [ ] **Step 1: 双副本 3 处措辞(两文件逐字同步;以下 old/new 均为已 grep 核实的原文)**

`.claude/rules/godot-mcp-ui.md`(:143):

| # | old(grep -F 已核实命中) | new |
|---|---|---|
| M-1 | ``内缩 `min(borderRadius+border.width, 短边/2−2)` `` | ``内缩 `max(0, min(borderRadius+border.width, 短边/2−2))` (短边<4 时回落 0,防负内缩)`` |
| M-2 | `半透明 bg（alpha<1，合成后采样色≠bg_color）` | `半透明 bg（alpha<0.999，即非完全不透明；合成后采样色≠bg_color）` |
| M-7 | `带 text 节点跳过中心点（居中排版必踩文字，仅采四角）。` | `带 text 节点跳过中心点（居中排版必踩文字，仅采四角）。未映射控件（如 LineEdit 带 bg）的 bg 被翻译层忽略、渲染无该色——采样仍收集且预期红，与 build_warnings 样式丢失警告互为印证（诚实暴露，不静默跳过）。` |

`src/tools/rule-templates.ts`(:625):同样 3 处,唯一差异是反引号转义——M-1 的 old 为 ``内缩 \`min(borderRadius+border.width, 短边/2−2)\` ``(源文件内为反斜杠+反引号),new 为 ``内缩 \`max(0, min(borderRadius+border.width, 短边/2−2))\` (短边<4 时回落 0,防负内缩)``;M-2/M-7 无反引号,两文件 old/new 逐字相同。

改完核对:`grep -c "max(0, min" .claude/rules/godot-mcp-ui.md src/tools/rule-templates.ts` → 两文件各 1;`grep -c "alpha<1，" 两文件` → 0。

- [ ] **Step 2: 版本 bump 0.32.4(双副本变更强制 bump)**

Run: `npm version patch --no-git-tag-version && npm run version-sync && npm run build`
Expected: package.json→0.32.4,version-sync 同步 manifest.json 等文件;build 供 rules-sync 校验 build 产物。

- [ ] **Step 3: CHANGELOG [0.32.4] 段(插在 `## [0.32.3]` 之前;耗时数值用 Task 3 实测替换 `<实测>` 占位)**

```markdown
## [0.32.4] - 2026-08-18

### Changed — 原型翻译层单 spawn 合成（ui_import_prototype 内部链，PR-4）

- **单进程优化**：`ui_import_prototype` 内部链 build→persist→reload→measure 由两次 Godot spawn（首版实测 ~6s）合成单 spawn（新独立脚本模板 `src/tools/ui/ui-import-single.ts`；二轮审阅 N-2 拍板：不扩 ui-measure、不动共享 `_mcp_load_scene`）；reload 用 `ResourceLoader.load(path, "", ResourceLoader.CACHE_MODE_IGNORE)` 绕过 ResourceCache——同进程裸 load 二载命中缓存旧实例 → verify 全红（spec §6 B-1）；「篡改磁盘后 reload 测出差异」断言（换 Hacked 场景/垃圾内容两例集成用例）证明 reload 真读磁盘；reload 失败错误内嵌「build 已持久化，可重跑 ui_measure_layout」恢复语义（persist 先于 measure 既有顺序保持）；实测耗时 <实测>（RTS 23 节点一次调用，两次 spawn 基线 ~6s）。capture 不并入（`ui_pixel_verify` 保持独立调用）。
- **规则双副本措辞精确化（PR-3 终审 M-1/M-2/M-7）**：内缩公式补 `max(0,·)` 下限（短边<4 回落 0，防负内缩）；`alpha<1` → `alpha<0.999`（对齐代码窄界）；未映射控件采样预期红进规则文档（与 build_warnings 样式丢失警告互为印证）。
```

- [ ] **Step 4: README 版本表插行(:641 `| **v0.32.3** |` 行之前)**

```markdown
| **v0.32.4** | 2026-08-18 | **原型翻译层单 spawn 合成(PR-4)**:ui_import_prototype 内部链 build→persist→reload→measure 由两次 Godot spawn(~6s)合成单 spawn——reload 用 `ResourceLoader.load(path, "", CACHE_MODE_IGNORE)` 绕过 ResourceCache(同进程裸 load 二载命中缓存旧实例,spec §6 B-1),篡改磁盘断言证明 reload 真读磁盘;失败错误内嵌「build 已持久化,可重跑」恢复语义;规则双副本 3 处措辞精确化(PR-3 终审 M-1/M-2/M-7)。43 工具/241 action。 |
```

- [ ] **Step 5: 全门禁(逐项真跑贴输出)**

```bash
npm run lint
npm run build
npm test
npm run build-matrix
npm run diff-matrix        # 无工具清单/描述变更,预期 no drift
npm run check:budget
STRICT=1 npm run check:rules-sync
npm run version-check      # 0.32.4
```

Expected: 全绿(test 全量含集成真跑;rules-sync 9 文件一致)。

- [ ] **Step 6: Commit**

```bash
git add .claude/rules/godot-mcp-ui.md src/tools/rule-templates.ts CHANGELOG.md README.md package.json
git commit -m "docs(ui): PR-4 收尾——双副本 M-1/M-2/M-7 措辞精确化+0.32.4 版本段(CHANGELOG/README)"
```

(注:`npm version`/`version-sync` 触及的其余版本文件一并 `git add`,以 `git status` 实际清单为准。)

---

## Self-Review 记录(plan 作者自查)

1. **Spec 覆盖**:§6 全部条款 → Task 1(新独立模板/不动 ui-measure/不动 _mcp_load_scene/CACHE_MODE_IGNORE reload 分支/原子写复用)、Task 2(单次 executor/恢复语义)、Task 3(篡改磁盘断言+耗时对比记录)、Task 2-3(capture 不并入,ui_pixel_verify 零改动)、Task 4(版本策略 patch+双副本);§7「PR-4:篡改磁盘断言+耗时对比记录」→ Task 3;§8 改动面表「单 spawn」行 → Task 1-2。§10.5 决策输入按交接行**继续留 spec**,不设 task(正确)。
2. **占位符扫描**:唯一占位 `<实测>` 在 Task 4 Step 3 CHANGELOG 耗时数值——该值只存在于 Task 3 真跑之后,plan 已显式标注「用 Task 3 实测替换」,非偷工;其余步骤全部含完整代码/命令/期望输出。
3. **类型一致性**:`genUiImportSingleScript` 五参签名在 Task 1(定义)/Task 2(handler 调用)/Task 3(集成直调)三处一致;`genStyleExpectInit` 返回 `\t` 缩进行串,与 _measure_go 函数体缩进层级一致(Task 1 Step 4 已核);mock 契约(buildOutputs/measureOutputs 键名 persist/measure/warnings)与 handler 解析键一致。
4. **已知风险**:①GDScript 前向引用——_measure_go 追加在文件尾、全部引用前向声明(buildThenMeasure 先例实证);②垃圾 .tscn 可能致引擎硬崩——Task 3 注记给出合法错误类型资源 fallback 裁决;③既有集成断言若因 reload 路径变红——Task 3 Step 3 明令停下取证、禁止改断言保绿。
