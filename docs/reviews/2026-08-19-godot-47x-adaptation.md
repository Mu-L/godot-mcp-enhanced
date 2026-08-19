# 第三方审查：Godot 4.7.1/4.7.2 适配批

- **日期**：2026-08-19
- **审查者**：code-reviewer 子 agent（隔离视角，全部声明 grep/read 实测 + WebFetch 独立核实外部事实；未跑 npm test——测试绿灯由实现者自跑并贴证据）
- **实现者**：ZCode 主会话（同日调查报告批准后执行）
- **分支**：`research/godot-47x-adaptation`（worktree `.claude/worktrees/research-godot-47x`，基于 master@0e894a2）
- **总体判定**：**SHIPPED WITH NITS**（Nit 1/2 已当场处置，见文末）

## 审查范围

19 个改动文件：cpp scaffold 分轨（`src/tools/cpp.ts`、`cpp-templates.ts`）、`project.ts` 默认版本、`gdscript-lint.ts` target、`code-templates.ts` 元数据 + T010 修复、CI 两 workflow、9 个测试文件、`docs/capability-matrix.{json,md}`、`CHANGELOG.md`。

## 审查者核实结论（要点）

### 设计正确性 — 通过

- cpp 分轨边界（4.5/4.6 之间）与 godot-cpp 官方事实完全吻合：branches/tags 页独立 fetch 证实无 `godot-4.6-stable`/`godot-4.7-stable` ref；master README 的 `api_version` 用法与生成 SConstruct 逐字一致，且属官方"强烈推荐"写法。
- `godotCppCloneCommand()` 单一来源属实（`cpp-templates.ts:54-59` 定义，README 模板 `:216` 与 `cpp.ts:96` 共用，全仓无重复字面量）。

### 九条实现者声明 — 8 真 1 部分（漏升 T011，已修）

关键核实证据：
- CI 4.7.2 URL 与 release asset（74.3MB，2026-08-18 发布）逐字一致；4.6.3 条目未误动；worktree 全 `*.yml` 无 4.7.1 残留。
- defects 计数三方自洽：`key: '` 全文件 143 = FIXED 断言 135 + OPEN 断言 8；OPEN 剩余 8 条 baseline 逐一核实。
- `.claude/rules/` 全目录 grep 对 cpp/版本枚举**零引用** → 无双副本同步义务、无版本 bump 触发。
- capability-matrix.json 的 cpp schema 与 `cpp.ts` 逐字一致。
- 两个"有意未动"判定合理：`?? '4.2'`（用户模板占位，非验证声明）、`last_reviewed` 保留（未逐条复审 25 条规则，不伪造复审日期）。

### 测试质量 — 通过（接线零验证判别）

- 删分轨逻辑/回退旧 `-b` 形式/删 4.7 枚举/改默认值 → cpp.test.ts 对应断言分别变红，回归锚真实防复发。
- T010 负向正则锚定裸 `IDLE:` 形态，回退即红。

## Nits 与处置

| # | 内容 | 处置 |
|---|------|------|
| 1 | 【必改】T011 `verifiedGodotVersion` 漏升（`lastVerified: "2026-05-31"` 是第三个日期 pattern，replace_all 05-18/05-23 未覆盖），与注释/CHANGELOG 两处"全量升 4.7"矛盾 | ✅ 已修：T011 补升（`code-templates.ts:294-295` → "4.7"/"2026-08-19"；T011 在 4.7.2 独立编译 PASS 集内有实证）。修后 `grep -c 'verifiedGodotVersion: "4.7"'` = 11（T001–T011 全量），CHANGELOG "TEMPLATES(11) 全量升"声明恢复为真 |
| 2 | godot-cpp master(v10) 当前 Beta，README 生成物宜提示 | ✅ 已修：cloneStep 文案补 "— currently beta"（`cpp-templates.ts:206`） |
| 3 | `src/cli/init.ts:43` 硬编码 `"4.2"`（CLI init 子命令独立模板路径），与全仓默认 4.7 口径脱节；另有 `code-templates.ts` 用户模板 `lastVerified=加载当天` 的预存在语义缺陷 | ⏸ 不属本批范围，登记后续小批 |

## 实现者最终验证证据

- `npm run lint` + `npm run build`：绿（eslint 零输出；tsc 零错误）
- `npm test`：**5860 passed / 0 failed / 35 skipped（exit=0）**（过程 3 轮，中途 flaky 失败均经干净 master 主 checkout A/B 对照实锤为环境既有/竞态，非本批引入）
- `GODOT_PATH=4.7.2 npm run check:gdscript`：**errors=0 warnings=0**
- 模板逐个 4.7.2 `--check-only`：**13/14 独立编译过**；T003（类级 var+语句+func 混合粘贴片段）/A002（模式骨架，仅定义首状态处理）经 4.6.3 对照行为逐字一致定性为 by-design 非版本问题
- `npm run build-matrix`：43 tools (v0.32.6) 重建；`npm run check:budget`：通过（3 个既有 WARN 非 本批引入）

## 工程教训（进 memory）

1. **"全量升 X"类声明必须与逐条实现做计数核对**——T011 漏升被"全量"措辞掩盖在两处；`grep -c` 对照声明计数即可暴露。"全量/全部/所有"是审查时最该怀疑的量词。
2. **外部依赖的 ref 契约会静默失效**——godot-cpp v10 停发 stable ref 使生成指引必然失败；生成"可执行指引"的工具应对指引目标做存在性验证。
3. **验证声明字段与占位默认字段升级策略应区分**——`verifiedGodotVersion`/`last_reviewed` 只随真实验证动；`?? '4.2'` 占位不随批次口号动。
