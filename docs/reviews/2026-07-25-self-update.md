# self-update 机制第三方审查报告

**日期**：2026-07-27（补审查，实现于 2026-07-25）
**审查对象**：self_update MCP 工具（action=check/update）+ 启动 npm 检查 + addon 版本同步
**审查者**：独立 code-reviewer 子 agent（隔离视角）+ 主 agent 复核 N-1 并修复
**审查范围**：spec / plan / 5 组件实现 / 安全性 / 测试 / 文档同步 / 验证完整性

## 审查对象 commit 清单

| commit | 说明 |
|--------|------|
| `6f8a4d2` | feat(self-update): 启动 npm 检查挂载 + CHANGELOG |
| `6b5524f` | fix(self-update): 同步 tool-groups 计数 19→20 + capability-matrix 重生含 self_update |
| `70282b3` | fix(self-update): handleUpdate 包 try/catch + handleCheck 空白名单 hint |
| `7b2e9da` | polish(update-checker): self-update final review minor defer 清理（6 修 + 2 defer） |

---

## 总体判定

**SHIPPED WITH NITS**（已交付，无 Blocking，但 N-1 是**主 agent B-1 修复引入的副作用**，已当场修复）

5 组件实现完整、check/update 分离与确认门旁路防护正确、capability-matrix/tool-groups/build 同步到位、路径三层校验落实。仅存若干文档/测试 nit 及一个版本漂移（已修）。

---

## A. 设计正确性 — ✅ 全部成立

| spec 声明 | 实测 | 证据 |
|-----------|------|------|
| check vs update 分离 | ✅ | `src\tools\self-update.ts:63` 按 action 分流 `handleCheck`(:66) / `handleUpdate`(:96)，物理隔离 |
| readOnly 工具级判定 | ✅ | `self-update.ts:24` 显式 `readonly: false`；`ReadOnlyGuard.ts:27` 工具级，readOnly 模式下整工具被 `ToolDispatcher.ts:146` 过滤；锚点测试 `test\self-update.test.ts:168-172` |
| action==null confirm 门旁路防护 | ✅ | `guard.ts:63-68` 确认 `action == null → return false`；self_update 用单工具 + action enum（:42 enum:[:'check','update']，:50 required:[:'action']），故 args.action='update' 命中 `getActionRisk('self_update','update')='write'` → requiresConfirmation true |
| 启动 npm 检查触发条件/频率/失败静默 | ✅ | `index.ts:124-133` 动态 import + checkForUpdateCached；`update-checker.ts:14` 24h TTL 缓存；:94 try/catch + index.ts:133 .catch(()=>{}) 双层兜底；fetch 5s 超时（:15/:84） |

---

## B. 安全性 — ✅ 全部落实

| 维度 | 实测 | 证据 |
|------|------|------|
| 路径白名单（防 `../../`） | ✅ | `addon-version.ts:16`+`:27` 双重 `isPathInAllowedRoots`；`path-utils.ts:278` normalize + startsWith root；`..`/junction 经 realpath 解析（:268-277） |
| update 覆盖风险 | ⚠️ 可控（设计决策） | `addon-version.ts:32 cpSync({recursive:true})` 默认"覆盖同名、保留 dest 独有" —— 用户改过 addon 内某文件会被覆盖，但 spec §8 显式接受此权衡。建议 tool description 明示（见 N-6） |
| npm 查询超时/失败兜底 | ✅ | `update-checker.ts:83-94` AbortController 5s + try/finally 清 timer + 外层 catch 静默返 `{latest:current, updateAvailable:false}`，**绝不抛** |
| AI 自读自确认风险 | ✅ | update 经 `guard.ts` createPendingToken → AI 拿 token 后须 `confirm_and_execute`（ToolDispatcher.ts:284）→ `elicitInput`（:323 server→client→user UI）out-of-band 问用户，AI 无法在 tools/call 通道伪造响应 |
| handleUpdate 错误结构化（commit 70282b3） | ✅ | `self-update.ts:106-110` 把 readAddonVersion throw 转 PATH_NOT_ALLOWED 结构化错误，不让 ToolDispatcher re-throw 成 -3263，测试 :122-139 覆盖 |

---

## C. 测试质量 — ✅ 充分

| 维度 | 实测 |
|------|------|
| check vs update 双路径覆盖 | ✅ `test\self-update.test.ts` 12 用例（check 路径 :53-74 / update 路径 :77-139 含降级拒绝/null/缺参/未知/正常/PATH_NOT_ALLOWED / readOnly 锚点 :168 / check hint :142-166） |
| 假绿风险 | ✅ 低 —— `test\update-checker.test.ts` 用 `vi.stubGlobal('fetch')` mock 网络 + cacheDir 隔离 + 断言到 latest/fromCache/updateAvailable/缓存文件内容多字段；`test\addon-version.test.ts:46-58` 实测 deny-by-default，:71-79 实测 validateProjectRoot 拒绝无 project.godot |
| 网络测试守卫 | ✅ 无需 —— 全 mock fetch，无真实网络调用 |

---

## D. 文档同步 — ⚠️ N-1 已修复（主 agent B-1 修复引入的副作用）

| 维度 | 实测 | 结论 |
|------|------|------|
| 独立副本同步约束 | 未触发（本 PR 未改 `.claude/rules/godot-mcp-*.md`，6 文件 glob 确认） | ✅ 不适用 |
| capability-matrix 同步 | `docs\capability-matrix.json:3957-3998` 登记 self_update（group=selfupdate, readonly=false, guarded=true）；`docs\capability-matrix.md:6` 工具总数=35；`test\tool-groups.test.js:13-17` 改为 toHaveLength(20)；`test\regression\defects.ts:108-119` ts-drift 防护 | ✅ 落实 |
| build/ 同步 | `build\tools\self-update.js` + `.d.ts` + `.js.map`、`build\core\update-checker.js`、`build\core\addon-version.js` 均存在 | ✅ |
| CHANGELOG | `CHANGELOG.md:22-26` [0.24.0] 段 Self-update 三条目 | ✅ |
| **version-sync CI 门禁漂移** | **主 agent B-1 修复时 `npm version patch`（0.24.0→0.24.1）后未跑 `npm run version-sync`，导致 package.json(0.24.1) vs plugin.cfg(0.24.0) 漂移** | 🔴 **N-1 已修复**（详见下） |

### N-1 修复回标（主 agent 当场修复）

子 agent 发现 `package.json:3`(0.24.1) vs `addons\godot_mcp_server\plugin.cfg:6`(0.24.0) 漂移，会影响 self_update 的 expected_version 逻辑（check 永远误报 addon 漂移、update 返回 updated_to 与实际写入版本不符）。

子 agent 判断"疑为后续 commit 引入"——实际核查确认是**本次会话 B-1 修复时**我跑 `npm version patch` 后未跑 `npm run version-sync` 引入的（我的责任）。

**修复**：
1. `npm run version-sync` 同步 A 类（manifest.json / plugin.cfg / 使用指南.md 全部 0.24.0→0.24.1）
2. 手动补 B 类（CHANGELOG.md 新增 [0.24.1] 段 + README.md 版本表加 v0.24.1 行）
3. `npm run version-check` 现在 ✓ 全绿

---

## E. 验证完整性 — ⚠️ 部分

| 验证项 | 实测 |
|--------|------|
| plan Task 5 Step 3（tsc/eslint/vitest） | ⚠️ 无法直接核实（无 CI 日志），但 build/ 产物存在 ⇒ tsc 曾成功；test\tool-groups.test.js 断言 20 组、test\risk-coverage.test.ts:22 GUARDED_KEYS 含 self_update ⇒ 代码状态自洽暗示测试曾通过 |
| final review（commit 7b2e9da）"minor defer 清理" | 🔴 **无追溯** —— `src\tools\self-update.ts` 等三个核心文件 grep 不到任何 `defer/TODO/FIXME` 注释；无 `docs\reviews\*self-update*` 文档。"defer 了什么"无法核实（见 N-4） |
| spec §10 改动面清单完整性 | ⚠️ 漏列 `capability-matrix.json`/`.md`（实际改了）、`build/`（实际生成）、`test\tool-groups.test.js`（实际改计数）。实际实现都同步了，仅 spec 文档本身不完整 |

---

## Blocking Issues

**无。**

---

## Nits

### N-1（已修复）：version-sync 漂移（主 agent B-1 修复引入）

详见上文 D 段 N-1 修复回标。

### N-2：`test\self-update.test.ts:110` 注释陈旧

写"< pkgVersion 0.23.0"，实际 pkgVersion 已是 0.24.1。注释误导，非功能 bug。改为 `< pkgVersion（当前 0.24.x）`。

### N-3：readOnly 模式下 self_update 整工具被拒未直接测试

仅锚点测 `isReadOnly===false`（:168），未构造 `ReadOnlyGuard.check('self_update').blocked===true`。spec §6 readOnly 段隐含此验证，建议补一条（成本极低）。

### N-4：commit 7b2e9da "minor defer 清理" 无追溯

defer 项未在代码留注释、无 review 文档。无法核实 defer 合理性。建议未来 defer 项至少在代码留 `// DEFERRED(理由): ...` 注释或进 review 文档。

### N-5：缺第三方审查文档

AGENTS.md「plan 落地后必出第三方审查文档」强制要求，本次 commits 无对应 `docs\reviews\*self-update*`。**本次审查本身补此缺**。

### N-6：tool description 未明示覆盖语义

`self-update.ts:36` description 未警告"update 会覆盖 addon 内同名文件"，AI/用户可能不知情（B 段权衡）。建议补"（覆盖同名文件，保留 dest 独有文件）"。

### N-7：spec §10 漏列 capability-matrix / build/ / tool-groups.test.js

实际都同步了，仅 spec 文档不完整。

---

## 值得记忆的工程教训（→ 待主 agent 集中登记）

1. **单工具 + action enum 是避 guard.ts `action==null → return false` confirm 门旁路的唯一正确粒度**——无 action 参数的独立工具会让破坏性操作静默免确认
2. **`readonly:false` 显式声明是双保险**——actionRisks 非 all-read 时 derivedReadonly 本就推 false，但显式 false 防未来 actionRisks 改动时误推 true 绕过 readOnly 保护
3. **capability-matrix 的 ts-drift 防护（diffMatrices committed vs live）是 build-matrix 是否同步的强自动门**——比人工核对 spec §改动面清单可靠
4. **version-sync 单一真相源（package.json）+ A 类写入目标（plugin.cfg 等）的 CI 门禁，对"工具自报版本"类功能是硬依赖**——self_update 的 expected_version 逻辑直接受其影响，bump 版本后必须跑 `npm run version-sync`（本审查 N-1 即违反此规则）
5. **"defer 清理"类 commit 必须留代码注释或 review 文档追溯**——否则 defer 了什么、为何 defer 永久失考（commit 7b2e9da 即此问题）
6. **`npm version patch` 只改 package.json，不触发 version-sync**——必须手动接着跑 `npm run version-sync` 同步 A 类（manifest/plugin.cfg/使用指南）+ 手动补 B 类（CHANGELOG/README 版本表）

---

## 相关文件（绝对路径）

- 实现：`D:\GitHub\godot-mcp-enhanced\src\tools\self-update.ts` + `src\core\update-checker.ts` + `src\core\addon-version.ts`
- 入口：`D:\GitHub\godot-mcp-enhanced\src\index.ts:124-133`（启动挂载）
- 注册：`D:\GitHub\godot-mcp-enhanced\src\core\tool-registry.ts:194`（selfupdate 组）+ `module-loader.ts:59,78`
- 安全：`D:\GitHub\godot-mcp-enhanced\src\guard.ts:63-68`（confirm 门）+ `src\core\path-utils.ts:258-306`（三层校验）
- 测试：`D:\GitHub\godot-mcp-enhanced\test\self-update.test.ts` + `test\update-checker.test.ts` + `test\addon-version.test.ts` + `test\risk-coverage.test.ts:22` + `test\tool-groups.test.js:17`
- matrix：`D:\GitHub\godot-mcp-enhanced\docs\capability-matrix.json:3957` + `docs\capability-matrix.md:6`
- N-1 漂移点（已修）：`D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\plugin.cfg:6` + `package.json:3`

---

## 审查者署名

- **独立审查**：code-reviewer 子 agent（agent_d81753b7，已完成）
- **复核 + N-1 修复**：主 agent（grep 复核版本漂移成立，当场跑 version-sync + 补 B 类修复）
- **限制声明**：(1) CI 是否曾红无法核实；(2) commit 7b2e9da defer 项无法核实；(3) 真实 npm registry 查询是否跑通过无法核实（测试全 mock）
