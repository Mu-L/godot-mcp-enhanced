# 原型翻译层 + 视觉验收 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 写 HTML 原型 → 浏览器取几何 JSON → `ui_import_prototype` 一次调用(翻译→build→measure→verify→persist)→ 不绿回 HTML 改;辅以 `screenshot(action=diff)` 像素验收补 flow/内容层盲区。

**Architecture:** 全部 Headless CLI 层。翻译器纯函数(零 Godot 依赖)产出 `UiNodeSpec` 目标树,复用 v0.30.3 闭环(锚点求解/measure/layout_verify/persist);像素 diff 复用 pngjs。**零新依赖**。

**Tech Stack:** TypeScript(ES2022/strict/ESM)+ zod v4(已在依赖)+ pngjs(已在依赖)+ Vitest/fast-check

**Spec:** `docs/superpowers/specs/2026-08-16-prototype-import-design.md`(**v2**,审查已消解 B-1/B-2/N-1~N-6,审查文档 `docs/reviews/2026-08-16-prototype-import-spec.md`)

## Global Constraints

- TypeScript `strict + noUncheckedIndexedAccess`,禁 `any`;ESM import 带 `.js`;2 空格缩进;MCP description 简体中文。
- 文件路径入参一律 `normalizeUserProjectPath`(剥 `res://`)→ `resolveWithinRoot(projectPath, …)` 白名单,配负向测试(`../` 逃逸/白名单外)。
- 分支:`git checkout -b feat/prototype-import`(自当前 master `4109757`)。
- 每任务收尾 `npm run lint` + 覆盖测试全绿才 commit(Conventional Commits)。
- 每任务完成必登 memory(工程教训/决策);全部完成后控制器做整分支终审。
- 关键参考(实施前 grep 实测,勿凭本计划行号):`src/tools/ui/index.ts`(case/TOOL_META satisfies/UI_PERSIST_ACTIONS/expect_tree 注入模式)、`src/tools/ui/ui-layout.ts`(genUiBuildLayoutScript 5 参签名)、`src/tools/qa/spec.ts`(zod v4 先例)、`src/tools/screenshot.ts`(action 模式/TOOL_META)、`src/tools/screenshot-detail.ts`(decodePng)。

---

### Task 1: 翻译器纯函数 `prototype-import.ts`

**Files:**
- Create: `src/tools/ui/prototype-import.ts`
- Test: `test/prototype-import.test.ts`(新建)

**Interfaces(Produces,Task 2/3 依赖):**
- `export interface GeometryNode { name; rect:{x,y,w,h}; type?; text?; fontSize?; color?; bg?; align?:'left'|'center'|'right'; value?; flow?:'row'|'column'; justify?; interactive?: boolean }`(spec §2.1 + 本计划澄清:补 `interactive?: boolean` 支撑规则 1 的 Button 推断)
- `export interface PrototypeGeometry { viewport:{w,h}; nodes: GeometryNode[] }`
- `export function parseGeometry(raw: unknown): PrototypeGeometry`(zod 校验,失败 throw `INVALID_PARAMS: <详情>`)
- `export function translateGeometry(geo: PrototypeGeometry): { tree: UiNodeSpec; warnings: string[]; coverage: { targets: number; total_nodes: number } }`(非法:节点>500、name 重复/非法字符清洗、**交叉重叠/等 rect → throw INVALID_PARAMS**)

- [ ] **Step 1: 失败测试** — 新建 `test/prototype-import.test.ts`,覆盖:
  1. `parseGeometry`:合法 JSON 通过;缺 viewport/nodes/rect、非数字坐标、节点>500、name 重复 → throw 含 `INVALID_PARAMS`;
  2. `buildTree`(经 translateGeometry 间接测):嵌套 rects 正确建树(父=最小包含者);**两 rect 交叉重叠 → throw;完全相等 → throw**;兄弟相接(共享边)合法;
  3. 规则断言(每条正例+负例):
     - 规则 1 推断:显式 type 优先;flow:'row'→HBoxContainer;'column'→VBoxContainer;value→ProgressBar;interactive+text→Button;text→Label;其余 Panel;
     - 规则 2 相对化:子 rect 为视口坐标减父原点(fast-check:随机合法两层嵌套 geometry → 翻译 → 每节点 abs(parent)+rel 与输入视口坐标一致 ≤1px);
     - 规则 3:所有 Label `properties.vertical_alignment === 1`;
     - 规则 4:无 text/bg/flow 节点 → `self_modulate:[1,1,1,0]`;**有 bg → modulate 染色 + warning 含"近似"**;有 bg 的不设 self_modulate;
     - 规则 5:flow 节点 → 生成 Holder Panel(原 name `_Holder` 后缀或 flow 节点本身成为壳?**定:flow 节点自身保留 name 与 rect 作壳 Panel(type Panel),其下包 `{type:'HBoxContainer',name:name+'_Flow',anchor_preset:'full_rect',layout:{direction,justify}}`**),子节点丢 rect、`flex.min_width/min_height` 取原 rect 尺寸;
     - 规则 6/7:fontSize → theme_override_font_sizes;fontSize 且 rect.h < fontSize*1.5 → warning 含"钳制";
     - 规则 8/9/10:color 三格式(`#rrggbb`/`[r,g,b]`0-255/`[r,g,b,a]`0-1)归一 0-1 数组 → font_color;bg → modulate;align → horizontal_alignment(0/1/2);
     - 规则 11:非白名单 type → Panel + warning;
     - 规则 12:name `非法 字符!` → 清洗为 `非法_字符_`(或按 `[^a-zA-Z0-9_]→_`);深度>10 → throw。
  4. `coverage`:targets = flattenTargets(tree).length(有 rect 节点数,flow 子节点不计),total = 输入节点数;含 flow 的输入 targets < total。
- [ ] **Step 2: 跑红** `npx vitest run test/prototype-import.test.ts` → FAIL(模块不存在)
- [ ] **Step 3: 实现** `src/tools/ui/prototype-import.ts`:
  - zod schema(参照 `src/tools/qa/spec.ts` 的 v4 用法);坐标 `z.number().finite()`、rect w/h `> 0`;
  - 建树:先 O(n²) 两两校验(disjoint 或包含,容差 1px;相等/交叉 → throw);按面积降序逐个挂到"包含它的最小面积已挂节点"下;
  - 类型推断与 12 规则按 spec §2.2(v2);全部纯函数,不 import Godot/executor;
  - 复用 `UiNodeSpec`(from `./types.js`)与 `flattenTargets`(from `./layout-diff.js`)算 coverage。
- [ ] **Step 4: 跑绿** → **Step 5: lint + commit** `feat(ui): 原型几何翻译器(建树+12 规则+覆盖率)`

---

### Task 2: `ui_import_prototype` 接线

**Files:**
- Modify: `src/tools/ui/types.ts`(ACTIONS)/`src/tools/ui/index.ts`(schema+case+TOOL_META)/`src/core/module-loader.ts`(SLIM_CONFIG descHint + removeProps 增 geometry/geometry_path)
- Test: `test/ui-import-prototype.test.ts`(新建,mock executor 参照 `test/ui-tools.test.js` 模式)

**Interfaces:**
- Consumes: Task 1 全部导出;`genUiBuildLayoutScript(scenePath, parentPath, tree, viewport?, persist?)`(grep 实测参数位次);`genUiMeasureScript`;`diffLayout/flattenTargets`;`executeGdscriptTrusted`。
- MCP 入参:`geometry`(object)|`geometry_path`(string,normalizeUserProjectPath→resolveWithinRoot,负向逃逸测试)/`tolerance`(默认 2)/`parent_path`(默认 root)/`scene_path`。**无 persist 参数(工具固定持久化,spec v2 B-1 契约)**。

- [ ] **Step 1: 失败测试**(mock executeGdscriptTrusted 两次调用分别返回 build 成功 outputs 与 measure outputs):
  - 正常:inline geometry → 返回 data 含 `tree/build_warnings/layout_verify/verify_coverage/measure`;第二次 executor 调用的脚本是 measure 脚本(断言含 `process_frame.connect`);
  - geometry_path:临时文件读入成功;`../` 逃逸/白名单外路径 → INVALID_PARAMS;`res://` 前缀被正确剥离(指向项目内合法文件成功);
  - parseGeometry 失败透传 INVALID_PARAMS;TOOL_META `ui_import_prototype:'write'`(satisfies 护卫自然强制);ACTIONS 数组含新 action;
  - UI_PERSIST_ACTIONS **不含** ui_import_prototype。
- [ ] **Step 2: 跑红** → **Step 3: 实现**(照 spec §2.3 内部链;返回组装参照既有 expect_tree 注入段的 content[0].text 解析模式,grep 实测)→ **Step 4: 跑绿 + lint** → **Step 5: commit** `feat(ui): ui_import_prototype——几何 JSON 一次调用翻译+构建+测量+校验+持久化`

---

### Task 3: RTS HUD fixture + 集成验收(真跑 Godot)

**Files:**
- Create: `test/fixtures/prototype-geometry/rts-hud.json`(下述 JSON 逐字使用——来源为上轮实战 chrome-devtools 实测 DOM 输出,非人肉估写)
- Test: `test/integration/ui-import-integration.test.ts`(新建,GODOT_PATH gated,复用 `test/integration/ui-layout-integration.test.ts` 的 runScript/fixture 模式)

- [ ] **Step 1: fixture JSON**(视口 1280x720;name 与 rect 逐字来自上轮实测):

```json
{ "viewport": { "w": 1280, "h": 720 }, "nodes": [
  { "name": "Bg", "rect": {"x":0,"y":0,"w":1280,"h":720}, "type":"Panel", "bg":"#2b3a2b" },
  { "name": "TopBar", "rect": {"x":0,"y":0,"w":1280,"h":56}, "type":"Panel", "bg":"#10141f" },
  { "name": "ResCrystal", "rect": {"x":24,"y":16,"w":110,"h":24}, "text":"水晶 1500", "fontSize":16, "color":"#e8ecf5" },
  { "name": "ResPower", "rect": {"x":160,"y":16,"w":90,"h":24}, "text":"电力 240", "fontSize":16 },
  { "name": "ResSupply", "rect": {"x":280,"y":16,"w":100,"h":24}, "text":"人口 8/10", "fontSize":16 },
  { "name": "GameTime", "rect": {"x":1160,"y":16,"w":96,"h":24}, "text":"12:34", "fontSize":16 },
  { "name": "Minimap", "rect": {"x":16,"y":568,"w":176,"h":136}, "type":"Panel", "bg":"#10141f" },
  { "name": "MinimapTag", "rect": {"x":46,"y":620,"w":116,"h":24}, "text":"雷达 MAP", "fontSize":14, "color":"#7a8aab" },
  { "name": "CmdPanel", "rect": {"x":640,"y":552,"w":288,"h":152}, "type":"Panel", "bg":"#10141f" },
  { "name": "BtnAttack", "rect": {"x":656,"y":568,"w":72,"h":36}, "type":"Button", "text":"攻击", "interactive": true },
  { "name": "BtnMove", "rect": {"x":736,"y":568,"w":72,"h":36}, "type":"Button", "text":"移动", "interactive": true },
  { "name": "BtnStop", "rect": {"x":816,"y":568,"w":72,"h":36}, "type":"Button", "text":"停止", "interactive": true },
  { "name": "BtnPatrol", "rect": {"x":656,"y":612,"w":72,"h":36}, "type":"Button", "text":"巡逻", "interactive": true },
  { "name": "BtnHold", "rect": {"x":736,"y":612,"w":72,"h":36}, "type":"Button", "text":"防守", "interactive": true },
  { "name": "BtnBuild", "rect": {"x":816,"y":612,"w":72,"h":36}, "type":"Button", "text":"建造", "interactive": true },
  { "name": "BtnRepair", "rect": {"x":656,"y":656,"w":72,"h":36}, "type":"Button", "text":"修理", "interactive": true },
  { "name": "BtnRally", "rect": {"x":736,"y":656,"w":72,"h":36}, "type":"Button", "text":"集结", "interactive": true },
  { "name": "BtnRetreat", "rect": {"x":816,"y":656,"w":72,"h":36}, "type":"Button", "text":"撤退", "interactive": true },
  { "name": "UnitPanel", "rect": {"x":976,"y":552,"w":288,"h":152}, "type":"Panel", "bg":"#10141f" },
  { "name": "UnitName", "rect": {"x":992,"y":568,"w":200,"h":28}, "text":"战斗步兵 ×5", "fontSize":20, "color":"#ffd76e", "align":"left" },
  { "name": "HpBar", "rect": {"x":992,"y":606,"w":240,"h":16}, "type":"ProgressBar", "value": 0.72 },
  { "name": "HpText", "rect": {"x":992,"y":628,"w":120,"h":20}, "text":"HP 72/100", "fontSize":13, "align":"left" },
  { "name": "StatText", "rect": {"x":992,"y":652,"w":240,"h":20}, "text":"护甲 3 · 攻击 12 · 射程 5", "fontSize":13, "align":"left", "color":"#99aabb" }
] }
```

  ⚠️ 已知风险自检:Label rect 高 20/24 与 fontSize 13/16 的行高钳制(上轮实测 16px 行高 23px)——ResCrystal 等 h=24 ≥16*1.5 ✓;HpText h=20 < 13*1.5=19.5 边缘、<16*1.5 若按 16 算——**fixture fontSize 全部 ≤13 的行高实测约 17-18px,16 的 23px>24?23<24 ✓**;若集成出现 dh 超差,按 warning 提示把对应 fontSize 降 1 档并在报告记录实测行高数值(这是校准,不是改断言凑绿)。

- [ ] **Step 2: 集成用例**(handler 级直调,ctx stub `findGodot`):
  1. 读 fixture 文件经 geometry_path → 一次调用 → 断言:`layout_verify` 全部 ok:true(spec 语义:rect 覆盖内)、`verify_coverage.targets === 23`、`persist saved:true`(通过重载 measure 独立验证 .tscn 含 TopBar/BtnAttack 等节点);
  2. mini-flow fixture(3 按钮 flow:'row'+justify:'space-between' 在 Holder 内)→ 断言 targets < total(覆盖率语义)、HBox 存在、重载 measure 按钮间距 = (容器宽-Σmin宽)/2 ±2px;
  3. 负向:geometry_path `../` 逃逸 → INVALID_PARAMS(集成层再验一次)。
- [ ] **Step 3: 跑绿**(GODOT_PATH 显式)→ **Step 4: lint + commit** `test(ui): RTS HUD fixture + ui_import_prototype 集成验收(一次调用全绿+覆盖率+flow)`

---

### Task 4: `screenshot(action=diff)` 像素对比

**Files:**
- Modify: `src/tools/screenshot-detail.ts`(decodePng 加 export,实名小写 g)/`src/tools/screenshot.ts`(enum+case+TOOL_META `diff:'read'`)
- Test: `test/screenshot-diff.test.ts`(新建)

**Interfaces:**
- Consumes: `decodePng`(导出后)。
- Produces: action `diff`,入参 `image_a/image_b/threshold(默认 0.12)/diff_path(可选)`;返回 `{width,height,diff_pixels,diff_ratio,bbox}`;差异图(红染)写到 diff_path 时返回其绝对路径。两图路径先 normalizeUserProjectPath 剥 `res://` 再白名单。

- [ ] **Step 1: 失败测试**(pngjs 合成图,零 Godot):
  - 同图 → diff_ratio===0、bbox null;
  - 100x100 图改 250 像素 → diff_pixels===250、bbox 覆盖改动区;threshold 边界(恰好等于阈值的扰动不计);
  - 尺寸不一致 → INVALID_PARAMS;路径逃逸 → INVALID_PARAMS;
  - 集成(gated):上轮历史图 `test/fixtures` 拷贝 `.superpowers/sdd/rts-demo/{web-prototype.png,godot-hud.png}`?**不拷 gitignore 目录**——把两张历史图复制进 `test/fixtures/visual/`(小图 12-24KB 可入库)→ 实测其 diff_ratio 并**记录数值**(校准用,断言 loose:< 0.6);同图自比 ===0。
- [ ] **Step 2: 跑红** → **Step 3: 实现**(逐像素欧氏距离/√3×255;diff 图 pngjs PNG.sync.write;O(n) 单 pass)→ **Step 4: 跑绿 + lint** → **Step 5: commit** `feat(screenshot): action=diff 像素级双图对比(零新依赖)`

---

### Task 5: 登记收尾(规则双副本/版本/CHANGELOG/matrix/budget)

**Files:**
- Modify: `.claude/rules/godot-mcp-ui.md` + `src/tools/rule-templates.ts`(UI 段:import 用法+**evaluate 取数脚本模板**——读 `[data-name]` 元素、getComputedStyle background-color 非透明才填 bg、产出 proto-geometry JSON 的完整 JS 模板)
- Modify: `.claude/rules/godot-mcp-engine-quirks.md` + `rule-templates.ts`(quirks 段 3 条:modulate 级联/Label 垂直对齐默认 TOP/最小行高钳制,spec §3)
- Modify: `src/tools/claudemd-builder.ts`(补一句"HTML 原型还原优先 ui_import_prototype")/`package.json`(minor → 0.31.0)/`CHANGELOG.md`/`src/tools/ui/index.ts` 与 `screenshot.ts` 相关注释按需
- 联动:ui-tools action 计数、build-matrix、check:budget、version-sync 7 文件、SLIM_CONFIG(若 Task 2 未竟全功此处补)

- [ ] **Step 1: 双副本规则**(两文件同步,归一化逐行 diff 核对一致)→ **Step 2: claudemd + `npm version minor` + CHANGELOG 0.31.0**(Added: ui_import_prototype/screenshot diff;Docs: 规则)→ **Step 3: `npm run build && npm run build-matrix && npm run diff-matrix && npm run check:budget && npm run lint && npm test` 全绿** → **Step 4: `grep -c "ui_import_prototype" src/tools/rule-templates.ts` ≥1 + commit** `docs(ui): 原型翻译层规则双副本+evaluate 模板+版本 0.31.0`

---

## Self-Review(已执行)

1. **Spec 覆盖**:§2.1/2.2→Task 1;§2.3→Task 2;验收 1/2→Task 3;§4+验收 3→Task 4;§3/§6→Task 5。B-1(无 persist 参数)/B-2(verify_coverage+flow 声明)已内嵌 Task 1/2/3 断言。
2. **占位符**:Task 3 fixture 为逐字完整 JSON;各测试步骤给了断言值;无 TBD。
3. **类型一致**:`GeometryNode/PrototypeGeometry/translateGeometry` 签名在 Task 1 定义、Task 2/3 按此消费;`genUiBuildLayoutScript` 参数位次以 grep 实测为准的提示已给(Task 2 Interfaces)。
