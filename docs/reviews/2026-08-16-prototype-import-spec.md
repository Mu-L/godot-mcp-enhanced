# 第三方审查:原型翻译层 spec(2026-08-16)

- 审查对象:`docs/superpowers/specs/2026-08-16-prototype-import-design.md`(v1)
- 审查者:code-reviewer 子代理(独立,声明逐项 grep/read 实测)
- 判定:**BLOCKING ISSUES**(2 B + 6 N)→ **已修订为 v2,处置对照见文末**

## 审查报告要点(原文归档)

### A. 代码声明核实
- ① `decodePng` 存在但未导出(`src/tools/screenshot-detail.ts:24`),实名小写 g(spec 误写 decodePNG);② `UI_PERSIST_ACTIONS`(`src/tools/ui/index.ts:222`)语义漏洞见 B-1;③ zod 属实(`package.json:75`,先例 `src/tools/qa/spec.ts:8`);④ `resolveWithinRoot` 先例充分(`src/tools/data-import.ts:341`/`src/tools/screenshot.ts:185`),**data-import.ts:369 教训:`res://` 前缀须先 `normalizeUserProjectPath` 剥离,spec 未提**;⑤ 截图尺寸疑点排除(capture 尺寸由 viewport 参数决定 `src/screenshot.ts:176`,非 blocker);441=√3×255 自洽。

### Blocking Issues
- **B-1 persist=false 链路不闭环**:measure 第二次 spawn 从磁盘 load(`gdscript-templates.ts:102`),persist=false 时运行时树已丢 → verify 全 `actual:null`(`layout-diff.ts:46-48`);且不加 UI_PERSIST_ACTIONS 则连提示都没有。
- **B-2 flow 子树是 layout_verify 盲区**:`flattenTargets` 只收集有 rect 节点(`layout-diff.ts:33`),规则 5 让 flow 子节点丢 rect → 整个子树零验证,"全绿"被稀释;Holder 绿 ≠ 容器内排布对,唯一补偿是 screenshot diff。

### Nits
N-1 交叉重叠/等 rect 未定义行为(会平级落地触发 overlaps 误报,AI 无法区分输入错与翻译错);N-2 fixture 不存在需人肉转录、30%/8% 阈值无依据;N-3 规则 4 责任契约(bg 缺省=透明壳)未写清,evaluate 模板应读 computed background-color;N-4 geometry/geometry_path 应进 SLIM_CONFIG removeProps(同 tree,`module-loader.ts:221-225`);N-5 漏 screenshot TOOL_META `diff:'read'`(`screenshot.ts:376-385`)与 claudemd-builder 决策;N-6 decodePng 导出+实名、capture viewport 一致性文档、geometry_path 剥 res://。

### 工程教训(已登 memory)
1. 默认参数掩盖链路前提:跨进程链路里后续步骤读磁盘,persist 类参数"默认 true"实为"必须 true"——spec 审查应追问每个可选参数在默认值之外的行为。
2. "全绿"的覆盖率盲区:验证器静默跳过无 rect 节点——凡以"verify 全绿"为验收的 spec 必须核对 targets 收集器的过滤条件,绿色可能是筛选出来的绿色。

## v2 处置对照

| Issue | 处置 | spec v2 落位 |
|-------|------|--------------|
| B-1 | **取消 persist 参数,固定持久化**(工具契约就是 import+verify+persist);不加 UI_PERSIST_ACTIONS | §2.3 persist 契约段 |
| B-2 | flow 子树盲区显式声明 + 返回 `verify_coverage{targets,total_nodes}` + screenshot diff 为补偿防线 | §2.2 规则 5、验收 1 |
| N-1 | 交叉重叠/等 rect → INVALID_PARAMS 拒绝 | §2.1 |
| N-2 | fixture 程序化 flatten 反推+双向核对;阈值移开放问题校准 | 验收 1/§7 |
| N-3 | bg 缺省=透明壳契约 + 模板读 computed background-color | §2.2 规则 4、§2.1 |
| N-4 | geometry/geometry_path 进 SLIM_CONFIG removeProps | §6 |
| N-5 | screenshot TOOL_META diff:'read' + claudemd-builder 拍板加 | §6 |
| N-6 | decodePng 导出(实名)、normalizeUserProjectPath 剥 res://、viewport 一致性文档 | §4、§2.3、§6 |
