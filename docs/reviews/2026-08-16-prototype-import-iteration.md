# 2026-08-16 原型翻译层小修批(prototype-import-iteration)第三方审查报告

> **审查者**:code-reviewer 独立子代理(隔离视角,不预设实现者声明为真)
> **审查对象**:分支 `feat/prototype-import-iteration`,commit `a9e78f7`(fix(ui) 遗留①②) + `e6c06ab`(chore(ci) 遗留③⑤)
> **审查方式**:静态 Read/Grep 实测 file:line 证据;审查环境无 Bash/Write,动态命令(lint/build/test/STRICT)由 coordinator 侧执行并回填(见「修复后记」验证段)
> **背景**:本批处理 `docs/reviews/2026-08-16-prototype-import-implementation.md`「遗留」节 ①②③⑤ 四项

## 总体判定:SHIPPED WITH NITS(修复后无 Blocking、无 Important 遗留)

四项遗留修复(①Panel 灰底 warning / ②尾斜杠归一化 / ③drift 清零+STRICT / ⑤budget 90KB)设计正确、测试接线真实、同步方向仲裁正确、仓库级同步链完整。审查产出 1 Important Nit(N-1)+5 普通 Nit,全部已在审查后修复(见文末「修复后记」)。

## 逐维度结论

### 1. 设计正确性 — 通过(1 条缝隙见 N-5,已修)

- **遗留① else-if 链落点正确**。`src/tools/ui/prototype-import.ts:278-294`:三分支顺序为 bg→modulate(:278)＞ 推断透明壳(:281,条件 `flow !== undefined || (type===undefined && text===undefined && value===undefined)`)＞ 显式 Panel 灰底 warning(:289)。到达 :289 的充要条件 = 无 bg、无 flow、`type==='Panel'`。**显式 Panel+有 text**:warning 语义仍成立(Godot Panel 不渲染 text,灰底翻转同样存在)。**显式 Panel+有 bg**::278 优先命中,不触发——正确。
- **遗留② 归一化正确,畸形输入非问题**。`src/tools/ui/index.ts:618` `parentPath.replace(/\/+$/, '') === '/root'`;`normalizeNodePath`(`src/tools/shared/value-serializer.ts:89-95`)只做 trim+前导 `/` 补齐。'//root' 等畸形仍弹 warning——保守方向无害(该路径本会在 GD build 阶段失败)。全仓无旧式 `!== '/root'` 判定残留。
- **⑤ totalSum 80→90KB**。`scripts/check-token-budget.mjs:14-23` 注释含校准依据;消费方全覆盖(脚本本体+`test/scripts/check-token-budget.test.ts:46-49`);docs 命中仅为历史快照(活计划文档残留见 N-3)。

### 2. 同步方向仲裁正确性 — 方向正确(示例级内容缺陷见 N-1,已修)

- **bridge 路径宣称权威性验证通过**:`.claude/rules/godot-mcp-bridge.md` "必须以 /root/ 开头" ↔ GD 侧 `src/scripts/mcp_bridge.gd:973-975`(`_cmd_get_node_properties`)与 `:1509-1511`(`_cmd_wait_for_node`)均 `get_node_or_null(path)`,autoload 内相对路径按 autoload 节点解析必失败 ↔ TS 侧 `src/tools/game-bridge.ts:718-724`(`validateBridgePath`)双重强制。**同步方向正确**。
- **recording 字段验证通过**:`mcp_bridge.gd:2396-2404` `_recorded_events.append` 产出 `time_offset`+`position` ↔ rules ↔ `rule-templates.ts` 三方逐字段一致。**同步方向正确**。
- **core/editor 双向合并**:DETAILED_RULE_TEMPLATES 9 键 ↔ `.claude/rules/` 9 文件对齐;抽查双侧一致(S4-editor 段/"43 工具 238 action"/bridge 绝对路径规则)。

### 3. 测试质量 — 通过(接线真实)

- 遗留①:`test/prototype-import.test.ts` 断言 `self_modulate`/`modulate` 均 undefined + warnings 含 'gray panel stylebox'——删掉修复分支断言必红;负例(显式 Panel+bg 不触发)真实防误触发。
- 遗留②:`test/ui-import-prototype.test.ts` 覆盖 'root/'/'/root/' 两变体——回退为全等则 '/root/' 变体必红。
- ⑤ 阈值断言:直接 import `THRESHOLDS` 精确断言 90*1024+校准依据注释——是跟随而非掩盖。

### 4. 仓库级约束独立核查 — 通过

- advisory 过时表述:AGENTS.md 两处已更新为 STRICT 新表述,全仓(含 CLAUDE.md)无"不校验内容一致性"残留;reviews/plans 的 advisory 命中均为历史快照。
- version bump 同步链完整:package.json/manifest.json/server.json/Dockerfile/plugin.cfg/capability-matrix.json 全部 0.31.3。
- ci.yml STRICT 真接线:`.github/workflows/ci.yml:65-66` `STRICT=1 npm run check:rules-sync` 无 `continue-on-error`。
- mjs 脚本结构与 `check-tool-groups.mjs` 同构,符合项目惯例。

### 5. 验证完整性

审查者静态交叉印证:build 产物存在、THRESHOLDS 两侧一致、版本链 6 处一致、9 键 9 文件对齐。动态命令由 coordinator 侧执行(见后记)。

## Blocking Issues

无。

## Nits(审查产出 → 修复处置)

| # | 问题 | 处置 |
|---|------|------|
| N-1(Important) | bridge 规则双侧 monitor/watch/find_nodes 示例 `node_path="root/Player"` 相对形态与 `game-bridge.ts:723` validateBridgePath 强校验冲突,照抄必得 INVALID_PATH,被机械同步固化进分发模板;`game-bridge.ts:558` schema 描述同病 | ✅ 已修:rules 侧(bridge.md 5 处+ui.md 1 处)+模板侧(rule-templates.ts 8 处)示例统一改 `/root/` 绝对形态(GD `_node_info` 用 `str(node.get_path())` 产绝对形态,返回值示例同修);schema 描述同步;build-matrix 重建 |
| N-2 | CHANGELOG/README 版本登记断档(审查时点 [Unreleased] 在 :158 未被审查者定位;README 版本表停 0.31.2) | ✅ CHANGELOG [Unreleased] 已含本批两段(Fixed+Changed);README 版本表按项目惯例发版时随 [0.31.3] 移动时再加(同 0.31.2 模式) |
| N-3 | `docs/plans/p0-specs/P0-6-tool-compression.md:10` 活 spec 残留 80KB 旧基线 | ✅ 已修:更新为 90KB 校准口径+2026-08-16 实测 86412B |
| N-4 | 归一化正则不锚定行首,理论可抹正文叙述性版本引用 | ✅ 已修:正则锚定 `> 适用于 godot-mcp-enhanced ` 前缀;已知限制(版本行互抹掩盖"最低适用版本"语义变更)注释声明 |
| N-5 | 非白名单 type 降级 Panel 无灰底翻转提示(降级 warning 已有但无灰底语义) | ✅ 已修:else-if 条件扩为 `nd.type !== undefined && type === 'Panel'`(覆盖显式 Panel+降级 Panel),+测试用例(type:'Foo' 降级→两条 warning 并存) |
| N-6 | AGENTS.md 变更日志表未登记本批机制变化 | ✅ 已修:加 2026-08-16 行(advisory→STRICT 升级+drift 清零) |

## 修复后记(2026-08-16,coordinator 侧)

- N-1~N-6 全部处置(上表);N-1 修复波及 `game-bridge.ts` schema description → `npm run build-matrix` 重建(43 tools v0.31.3)。
- 修复后门禁实测:`npm run lint` 0 警告 / `npm run build` 0 错误 / `STRICT=1 npm run check:rules-sync` 9 模板双向对账一致 / `npx vitest run test/prototype-import.test.ts test/ui-import-prototype.test.ts test/game-bridge.test.ts test/scripts/check-token-budget.test.ts` 119 passed(含 N-5 新增用例)。全量 `npm test` 于 Nit 修复前实测 5529 passed/0 failed(commit e6c06ab 时点),Nit 修复未触碰运行时逻辑(仅 else-if 条件扩展+文档/脚本/schema 描述),局部回归已覆盖。

## 值得进 memory 的工程教训

1. **机械一致性校验只保"两副本相同",不保"内容正确"**——bridge 双侧曾逐字一致地错了(monitor/watch 示例 `root/Player` 与 `validateBridgePath` 强校验冲突)。drift 清零批次必须额外做"内容 vs 代码事实"仲裁(示例参数形态 vs 校验器/schema 描述),否则一致性会把坏内容放大分发到目标项目。
2. **阈值校准类改动要 grep 活文档残留**:历史快照(reviews/已结 plan)不用动,但 `docs/plans/p0-specs/` 待办 spec 中的基线引用会过时。区分"历史快照"与"活计划"是同步边界。
