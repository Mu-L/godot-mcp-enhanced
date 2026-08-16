# 原型翻译层 + 视觉验收(Prototype Import & Visual Diff)设计文档

- 日期:2026-08-16
- 状态:**v2(已按第三方审查修订)**;审查报告:`docs/reviews/2026-08-16-prototype-import-spec.md`
- 修订:v2 消解 B-1(persist 必须 true,否则拒绝)/B-2(flow 子树 verify 盲区显式声明+覆盖率输出)/N-1~N-6
- 来源:`D:\workspace\Obsidian\godot-mcp-enhanced\开发日志\2026-08-16 下一步方向调研-原型翻译层.md`(用户拍板"直接开始 AB")
- 目标版本:v0.31.0
- 前置:v0.30.3 布局保真闭环(已合并本地 master,`ui_measure_layout`/rect 锚点求解/`layout_verify`/persist 均已上线)

## 1. 问题与目标

布局保真闭环解决了"给定目标 rect 的收敛",但目标 rect 仍靠 AI/人读图手抄。用户真实工作流(本次实战验证):**AI 写 HTML 原型 → 浏览器渲染 → 人工看效果 → Godot 还原**。本 feature 把"还原"这一步自动化:

**AI 写 HTML 原型 → 浏览器 MCP 一条 evaluate 提取几何 JSON → `ui_import_prototype` 一次调用完成翻译→build→measure→verify → 不绿回 HTML 改(原型是唯一真源) → 绿后像素级 `screenshot diff` 双图验收。**

**验收标准**:
1. 用上轮 RTS HUD 实战固化的 DOM 真值 JSON 作为 fixture(fixture 构建:从上轮全绿的嵌套树**程序化 flatten 反推**扁平 JSON,双向核对,不人肉转录,v2 N-2),`ui_import_prototype` **一次调用**返回 layout_verify 覆盖内全绿(≤2px)且 .tscn 已持久化——**"全绿"语义 = rect 目标覆盖内**(flow 子树不在内,见规则 5 声明);
2. 翻译规则对三个已知坑各自生效:文本默认垂直居中、透明壳用 self_modulate、flow 节点自动加 Holder 壳+spacer;
3. `screenshot(action=diff)` 对"modulate 级联透明坏图"与"正确图"给出可区分的 diffRatio(阈值用历史截图实测校准后写定,暂定坏图 >30% / 好图 <8%,v2 N-2 移入开放问题校准);两路径任一在白名单外 → 拒绝。

**明确排除**:Figma REST/MCP 接入(额度约束,后续同格式生产者)、VLM 视觉断言工具化、server 内嵌浏览器(依赖政策:运行时仅 4 依赖不变)。

## 2. A 主线:`ui_import_prototype`

### 2.1 proto-geometry JSON(中间格式)

```json
{
  "viewport": { "w": 1280, "h": 720 },
  "nodes": [
    {
      "name": "TopBar",                                  // 必填,唯一(=Godot 节点名)
      "rect": { "x": 0, "y": 0, "w": 1280, "h": 56 },    // 必填,视口绝对坐标
      "type": "Panel",          // 可选显式类型(CONTROL_TYPES 白名单);缺省由推断
      "text": "标题",           // 可选
      "fontSize": 16,           // 可选 px
      "color": "#e8ecf5",       // 可选文本色(#hex 或 [r,g,b] 0-255 或 [r,g,b,a] 0-1)
      "bg": "#10141f",          // 可选背景色(modulate 近似染色,非 StyleBox)
      "align": "left|center|right",  // 可选水平对齐,默认 center
      "value": 0.72,            // 可选(ProgressBar)
      "flow": "row|column",     // 可选容器语义:子节点由容器排布(丢 rect)
      "justify": "space-between"      // 可选,配合 flow
    }
  ]
}
```

- **扁平列表**;树由翻译器按 rect 包含关系推导(面积升序逐一找最小包含者;容差 1px;O(n²),n≤500 超限报错)。**非法输入直接拒绝(v2 N-1)**:两节点 rect 交叉重叠(互不包含)或完全相等 → `INVALID_PARAMS` 报错(而非静默落平级让 AI 误判翻译错);等 rect 时报错而非排序取父子。
- AI 侧取数脚本模板(evaluate 一条,读 `[data-name]` 元素产出本格式)写进 `godot-mcp-ui.md` 规则双副本,AI 照抄即用;**模板读 `getComputedStyle` 的 background-color,非透明才填 `bg` 字段**(v2 N-3,降低"该有背景的面板被当透明壳"的误判)。

### 2.2 翻译规则表 v1(12 条,首批来源=实战三坑+引擎知识)

| # | 规则 | 实现 |
|---|------|------|
| 1 | 类型推断 | 显式 type > flow→HBox/VBoxContainer > value→ProgressBar > text+interactive→Button > text→Label > Panel |
| 2 | 视口→相对父 | 逐层减父原点,生成 UiNodeSpec.rect(进既有锚点求解链) |
| 3 | Label 垂直居中 | 全部 Label `vertical_alignment:1`(CSS line-height 惯用法等价物) |
| 4 | 透明壳 | **契约:bg 缺省 = 按透明壳处理(责任归 JSON 生产者)**;无 text 无 bg 无 flow 的纯布局节点 → `self_modulate:[1,1,1,0]`(禁 modulate,级联陷阱) |
| 5 | flow 容器 | flow 节点自动包 Holder Panel 壳(rect 定位)+ HBox/VBox full_rect;justify space-* 走既有 spacer 注入;子节点丢 rect 留 min_size(若子 rect 尺寸可用作 min_width/min_height)。**⚠️ v2 B-2 声明:flow 子节点无 rect → 不进 flattenTargets → 整个 flow 子树不受几何 verify 覆盖(spacer/min_size/justify 映射错时 verify 仍绿);唯一补偿防线是 §4 screenshot diff。工具返回携带 `verify_coverage: {targets: n, total_nodes: m}` 让 AI 可见覆盖率** |
| 6 | 字号 | fontSize → `theme_override_font_sizes/font_size` |
| 7 | 行高预警 | rect.h < fontSize*1.5 → warning"可能被字体最小行高钳制"。**同族扩展(2026-08-16 Task 3 集成验收裁定):ProgressBar 且 rect.h < 27(Godot 4.7 默认主题 stylebox 最小高,实测来源 HpBar h=16 落地 27px)→ warning "ProgressBar height below Godot 4.7 default theme minimum (~27px): will be clamped"——与字体行高同性质(引擎下限预警,只警不修)** |
| 8 | 文本色 | color → `theme_override_colors/font_color`([r,g,b,a] 0-1) |
| 9 | 背景色 | bg → `modulate` 近似(输出 warning 声明是近似染色) |
| 10 | 对齐 | align → `horizontal_alignment`(left=0/center=1/right=2) |
| 11 | 白名单过滤 | 非白名单 type → Panel 降级 + warning |
| 12 | 深度/命名 | 嵌套深度 cap 10(对齐 ui_build_layout);name 非法字符清洗([a-zA-Z0-9_]) |

### 2.3 工具接线(ui 工具族新 action `ui_import_prototype`)

- 入参:`project_path`/`scene_path`/`parent_path`(默认 root)/`geometry`(inline JSON **或** `geometry_path` 文件路径——先 `normalizeUserProjectPath` 剥 `res://` 再过 `resolveWithinRoot` 白名单,v2 N-6;负向测试防逃逸)/`viewport`(可选,默认取 geometry.viewport)/`tolerance`(默认 2)。
- **persist 契约(v2 B-1):本工具没有 persist 参数——它必须持久化**。链路前提:measure 是第二次 Godot spawn,从磁盘 load 场景;不持久化则 verify 全部 `actual:null`。工具固定 `persist=true` 执行(不暴露开关),也不加进 `UI_PERSIST_ACTIONS`(无"退出即丢"可提示)。
- 一次调用内部链:校验(zod)→ 翻译(纯函数 `translateGeometry`)→ `genUiBuildLayoutScript(tree, viewport, persist=true)` 执行 → `genUiMeasureScript` 执行 → `diffLayout`(expect_tree=翻译树)→ 返回 `{ tree, build_warnings, measure: {stable_after_frames, stalled, viewport}, verify_coverage, layout_verify }`。AI 拿到全绿即完成;不绿回 HTML 改(原型是唯一真源,不在 Godot 侧调)。
- 新文件:`src/tools/ui/prototype-import.ts`(zod schema + 建树 + 规则表 + 翻译主函数,纯函数零 Godot 依赖,便于 fast-check);接线在 `ui/index.ts` case。

## 3. B-快赢:engine-quirks 规则双副本 3 条

`.claude/rules/godot-mcp-engine-quirks.md` + `src/tools/rule-templates.ts` 同步追加(UI 段或 Control 段):

1. **modulate 级联**:`modulate` 乘性影响整个子树;仅染自身用 `self_modulate`;透明布局壳必须 self_modulate(alpha=0 的 modulate 会让整个子树消失);
2. **Label 垂直对齐默认 TOP**:CSS `line-height=height` 的居中惯用法在 Godot 需显式 `vertical_alignment=1`;
3. **Control 尺寸被最小行高钳制**:Label/Button 的 rect 高度小于字体行高时被 minimum_size 顶开(verify 的 dh 会暴露),文本控件 rect.h 需 ≥ fontSize*1.5 或显式调小字号。

## 4. B-配套:`screenshot(action=diff)`

- 挂 `src/tools/screenshot.ts` action enum 增 `diff`;入参 `image_a`/`image_b`(PNG 路径,**白名单校验**;先 normalizeUserProjectPath 剥 `res://`)、`threshold`(RGB 欧氏距离/√3×255,默认 0.12)、`diff_path`(可选差异图输出,白名单内)。
- 实现:导出并复用 `src/tools/screenshot-detail.ts` 的 `decodePng`(v2 N-6:实名小写 g,当前未导出需加 export);尺寸不一致 → 报错(不静默缩放;**用法契约:capture 的 viewport 参数须与原型 viewport 一致**,文档注明);逐像素 RGB 距离>threshold 计差,差异像素染红输出差异图;返回 `{width,height,diff_pixels,diff_ratio,bbox}`。
- **零新依赖**(pngjs 在位,不引 pixelmatch);字体抗锯齿底噪在文档注明(建议用法:对比率设区间而非精确值)。

## 5. 测试策略

- **翻译器纯函数单测**:扁平建树(含兄弟不相交/容差边界/**交叉重叠与等 rect 拒绝**)、12 条规则各自正例+负例(不误报)、颜色三格式归一、快照锁定 UiNodeSpec 产出;fast-check:随机合法 geometry → 翻译 → flattenTargets 的 rect 相对父换算与输入视口坐标闭环一致(逐节点 abs(parent)+rel==input,≤1px)。
- **集成(GODOT_PATH)**:RTS HUD fixture JSON(`test/fixtures/prototype-geometry/rts-hud.json`,由上轮全绿嵌套树程序化 flatten 反推+双向核对生成,v2 N-2)→ `ui_import_prototype` 一次调用 → 断言 layout_verify 覆盖内全绿 + .tscn 含节点 + 重载 measure 一致;
- **负向**:geometry_path 路径逃逸(`../`)、非白名单路径、`res://` 前缀、JSON 非法、节点 >500、name 重复/非法字符、**交叉重叠/等 rect、(无 persist 参数可测,契约性说明)**、scene_path 白名单外;
- **screenshot diff 单测**:同图 diffRatio=0;构造差异 PNG(改若干像素)diff_pixels 精确计数;尺寸不一致报错;路径逃逸拒绝;集成:modulate 坏图 vs 好图(上轮两张历史截图可作 fixture)diffRatio 显著分离。

## 6. 改动面清单(实施时逐项核销)

| 登记点 | 内容 |
|--------|------|
| `src/tools/ui/types.ts` | ACTIONS 追加 `ui_import_prototype` |
| `src/tools/ui/index.ts` | inputSchema(geometry/geometry_path/tolerance)+ case + TOOL_META actionRisks(`write`) |
| `src/core/module-loader.ts` | SLIM_CONFIG:descHint 追加 + **`geometry`/`geometry_path` 进 removeProps**(同 `tree`,v2 N-4) |
| `src/tools/screenshot.ts` | action enum + case + **TOOL_META actionRisks 增 `diff: 'read'`**(v2 N-5) |
| `src/tools/screenshot-detail.ts` | `decodePng` 加 export |
| 规则双副本 | `godot-mcp-ui.md`(import 用法+evaluate 模板,含 computed background-color)+ `godot-mcp-engine-quirks.md`(3 条)+ `rule-templates.ts` 两段同步 + `npm version minor`(0.30.3→0.31.0)+ CHANGELOG |
| claudemd-builder | 分发单文件规则补一句"原型还原优先 ui_import_prototype"(v2 N-5 显式拍板:加) |
| matrix/budget | `npm run build-matrix` + `check:budget` |
| 门禁 | lint + build + test 全绿 |

## 7. 开放问题

1. flow 节点子节点 rect 尺寸→min_width/min_height 的映射是否总是合理(HUG 文本场景)——首版做+warning,实测校准;
2. diff 的 threshold 默认 0.12 与抗锯齿底噪的实测校准——用历史截图校准后写死默认值;
3. `ui_import_prototype` 一次调用内 build+measure 两次 Godot spawn 的耗时(~2×3s)是否需要合成单进程——首版两次 spawn(简单),慢再优化。
