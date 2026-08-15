# 第二波（批 H–K）全分支终审报告

**日期**：2026-08-15
**审查对象**：分支 `fix/review-findings-batch-20260814`，范围 `eb27b6e..da14fa8`（14 commits：批 H 测试补强 ×4 / 批 I GD 杂项 ×6 / 批 J 文档 ×1 / 批 K 收尾+门禁 ×3，2026-08-14 六批次审查 findings 第二波修复）
**审查者**：独立 whole-branch reviewer（隔离视角，不预设各批 task review 结论为真，全部声明 git/grep/npm/真 Godot 实测复核）
**审查定位**：三个逐批审查覆盖不到的维度——①跨批次交互一致性 ②仓库级约束独立核查 ③**发版就绪评估（本审重点产出）**。每批实现细节以各自 task review 为准（`.superpowers/sdd/batch20260814/task-{H,I,J,K}-report.md`）。

---

## 总体判定

**SHIPPED / 发版 READY**（Blocking 0 / Nit 2 / 移交 3 项全部 triage 为登记待办不 block）

三个跨批次交互面（批 H×批 I 同文件 websocket_server.gd、批 I×批 J schema-产物同步、批 K×批 G GodotServer.ts 段边界）实测全部干净；仓库级硬约束（rules 独立副本零触及、capability-matrix/tool-docs/源码三方一致、CHANGELOG 登记完整、build/scripts 同步）全过；批 K 报告的 11 项发版门禁**逐条亲跑 11/11 复现一致，零虚报**；批 I watchdog 落地后批 H debug e2e 无重跑证据的缺口已由本审亲跑补上（3/3 passed）。第一波终审留的 3 项"必须进批 K"全部闭环。实现者移交的 3 项经代码级核查全部为**存量问题非本分支回归**，登记待办后即可发版。

---

## 0. 执行门禁（全部亲跑，2026-08-15，HEAD=da14fa8）

| 门禁 | 命令 | 实测输出 | 与批 K 报告对照 |
|------|------|---------|----------------|
| Lint | `npm run lint` | exit 0（eslint src/ 零输出） | 一致 |
| Build | `npm run build` | exit 0（tsc + .gd 拷贝完成） | 一致 |
| 全量测试 | `npm test` | **356 files / 5303 tests passed / 33 skipped / 0 failed**（109.27s） | 一致（§5-3） |
| GDScript 完整编译 | `npm run check:gdscript`（GODOT_PATH=4.6.3） | **errors=0 warnings=0** | 一致（§5-4） |
| token 预算 | `npm run check:budget` | `2 warning(s), 0 error — 通过`（engine 1240B / game 1117B 既有） | 一致（§5-5） |
| 工具归组 | `npm run check:tool-groups` | `✓ 全部 41 个注册工具已归组(39 grouped + 6 always-allowed)` | 一致（§5-6） |
| 契约 | `npm run check:contract` | `✓ 全部合规（0 error, 5 warning）` | 一致（§5-7） |
| 协议版本 | `npm run check:protocol-versions` | `✓ SDK 协议版本快照一致（SDK 5 个 / 快照 5 个）` | 一致（§5-8） |
| 版本一致性 | `npm run version-check` | `✓ 版本元数据一致 (0.28.3)` | 一致（§5-9） |
| verify_delivery | MCP 工具 `verify_delivery(scope=full, real-project)` | **3/3 dimensions passed**（scene_tree ✓ / script_health ✓ / performance ✓ orphan 11 / 24.7MB / visual_proof 无断言跳过） | 一致（§5.1，批 K 为 orphan 11 / 21.6MB——内存数值波动正常，判定一致） |
| e2e L2 | `GODOT_MCP_E2E_L2=1 npx vitest run test/e2e-full-tool-verification.test.ts`（清 .godot 后） | **75 passed / 6 skipped / 0 failed**（116.88s） | 一致（§5.2） |
| e2e debug（批 K 未列，本审补验） | `E2E_EDITOR=1 npx vitest run test/e2e-debug-tools.test.ts` | **3/3 passed**（11.2s，A2 互斥 stderr 实录：`step OK stepped:true` + `-32000 "Another debug request is already in flight"`） | —（见 §1.1 补验） |

> e2e L2 首轮本审曾出 2 failed（`edit_script: search_and_replace` 等）——时间线核实为本审**自身操作错误**：与后台 `npm test`（14:07:16–14:09:05）并发重叠 30 秒，Godot 进程/项目目录竞争所致。串行复跑即 75 passed 全绿。此插曲恰好从侧面印证批 K 移交项 2"环境不净时 e2e 竞态"的定性（见 §4.2）。

---

## 维度一：跨批次交互一致性 — ✅ 通过（3 个交互面实测全部干净）

### 1.1 批 H（reply 兼容 ffd6172）× 批 I（watchdog + 握手超时 cf8be32）——同文件 `addons/godot_mcp_server/websocket_server.gd` ✅

两批各 1 commit 触及此文件。hunk 边界（`git show <c> | grep '^@@'` 实测）：批 H 单 hunk `@@ -423,7 +423,12`（reply 构造行）；批 I 十 hunks（常量区 27-55 / `_process` 261-317 握手超时段 / `_handle_message` 415-482 watchdog 段 / 新函数区 482-522 / `_exit_tree` 585）——批 H 的 reply 行被批 I 后落 hunk（`@@ -392,6 +426,9`）覆盖进上下文区，无物理冲突。

**语义交互链四级推演 + 亲跑证实**：

1. **error 分流先于 reply 兼容行**：批 I watchdog 超时返回 `{"error": {"code": -32008, ...}}`（websocket_server.gd:533 附近），流经 reply 构造时 `if response.has("error")` 优先命中（:475），**不会**触及批 H 的 `response.get("result", response.get("data"))` 行（:478）——error 形状与 result/data 兼容逻辑正交，无冲突。
2. **互斥锁释放顺序**：`_debug_in_flight = false`（:458）位于 watchdog await 恢复之后、§10 peer 守卫之前——watchdog 超时路径同样到达释放行（注释自证 + 批 I probe 证据），互斥锁不再依赖 120s stale 自愈。
3. **握手超时（I-5）清理路径完备**：`_connecting_since` 五处生命周期全闭环（accept 记时 :281 / OPEN 清 :292 / CONNECTING 分支惰性记时 :303-304 / 移除路径清 :317 / `_exit_tree` 清 :588）；对 CLOSED 前从未记时的 peer erase 是 no-op，无害。
4. **运行时闭环（本审补验）**：批 I 的 watchdog 包装（`handle_debug_async` 直连 → `_await_with_watchdog`）改了批 H e2e 所测的 debug 分支，但批 H/K 报告均无 e2e-debug-tools 重跑证据（批 I 只重跑了 e2e-testing-undo-manager，批 K 门禁只跑 e2e-full L2）。本审 `E2E_EDITOR=1` 亲跑补上：**3/3 passed**，A2 互斥语义在 watchdog 包装下完好——此缺口闭合。

### 1.2 批 I（max_depth schema 同步 e538134）× 批 J（产物重生成 9bc9aa5）——三方一致 ✅

批 I 的 `e538134` 只跑了 `build-matrix` 漏 `gen:tool-docs`（与第一波批 C/G 同款漏项），批 J 重生成时顺带补上并在报告"附带重生成的前批遗漏 drift"段如实披露（`docs/tools/project.md:33` 不在 wave1 预告清单内的额外发现）。本审抽查三方逐字一致：

| 方 | 位置 | 内容 |
|----|------|------|
| 源 | `src/tools/project.ts:57` | `最大搜索深度（默认 3，钳制上限 10）` |
| tool-docs | `docs/tools/project.md:33` | 同 |
| matrix | `docs/capability-matrix.json` project.max_depth.description | 同 |

### 1.3 批 K（subscribe 段 73b3e59）× 批 G（close 段 2fe4eeb）——同文件 `src/GodotServer.ts` 段边界 ✅

hunk 实测：批 G 五 hunks（568-679，close() 清理链）；批 K 四 hunks（98/114-120/261-277/**679**）。批 K 最后一 hunk（`@@ -679,6 +705,8`）落在批 G 补的 `registerBridgePushHandler(null)` / `dynamicSchema.setFetcher(null)` 之后、`log('Server shut down')` 之前——close 链尾部追加 `this.resourceSubscriptions.clear()`，`Set.clear()` 不抛错不会中断批 G 的容错清理链，两批各管一层语义（G 管 handler 闭包注入点残留，K 管订阅状态残留），共存干净。批 K 在 `registerBridgePushHandler` 回调体内加订阅过滤（:297 `if (!this.resourceSubscriptions.has('bridge://events')) return;` 先于 `notification()`），与批 G 的注册点生命周期管理分层不交叠。

---

## 维度二：仓库级约束独立核查 — ✅ 全过

> 按 AGENTS.md「plan 落地后必出第三方审查文档」要求独立 grep 仓库级约束，不只对照各批报告清单。

### 2.1 `.claude/rules/` 与 `src/tools/rule-templates.ts` 独立副本 — ✅ 零触及

`git diff eb27b6e..da14fa8 --stat -- .claude/rules src/tools/rule-templates.ts` → **空**。第二波无规则文件改动，不触发同步 + version bump 义务。

### 2.2 capability-matrix / tool-docs / 源码三方一致（抽查 blender/game/project/audit）— ✅

- **blender**：`src/tools/blender.ts:37-39` 源描述（沙箱威胁面披露）= `docs/tools/blender.md:3` = matrix description，**逐字一致**（批 J 三件套同步到位）。
- **game**：`docs/tools/game.md:41` `MCPOVERRIDE_<basename> autoload` 与源 `src/tools/game-bridge.ts:547` 一致；`:43` `wall_budget_ms 1000-50000` 与源 `:554` 一致（wave1 预告的两处 drift 均已被批 J 补齐）。
- **audit**：`docs/tools/audit.md:8` 安全级别 `danger-api` ✓（wave1 Nit-1 预告项已修）；`docs/tools/godot_advanced_tool.md:5` proxyable 清单已无 `audit` ✓。
- **project**：见 §1.2。

### 2.3 CHANGELOG 登记 vs 实际 commits — ✅（5 条抽查 + 8 个 SHA 引用核实全吻合）

`git show da14fa8 --stat` 确认 CHANGELOG 为批 K-3 独立 commit。抽查五条关键条目全部登记且描述与实际 commit 吻合：

| 抽查项 | CHANGELOG 位置 | 引用 SHA 核实 |
|--------|--------------|--------------|
| P0 重连链死 | :15 | `c42c06c` = fix(server) 重连修复 ✓ |
| autoload 键迁移 | :9-11 **置顶 Breaking/迁移需知段**（wave1 Nit-2 要求的迁移说明完整：坏键机制/自动迁移/双键清理/读侧兼容四点） | — |
| audit 可见性 | :30 | `4cdc0ef` ✓ |
| scene.commit 假成功 | :29 | `e590b64`/`7d40fc0` ✓ |
| 属性 no-op 假成功 | :25 | `7de9ed0`/`0bf53a0`/`71fb911` ✓ |

另核实 `cf8be32`/`2fe4eeb`/`889a712`/`8e6d598`/`f7d518b`/`c402158`/`ffd6172` 七个引用 SHA 主题全部吻合（`git log --format=%s -1` 逐一比对）。批 K 自身三产物（K-1 push 订阅者过滤 :37 / K-4 :M :35 / K-2 行为锁定 :56）也已登记。**数字裁决复核**：CHANGELOG 写 write_script 沙箱"3 旁路入口"而非 brief 的"4"——`git show 7d967eb` commit message 即"堵 write_script 沙箱**三**旁路入口"，改动 4 文件（3 调用点 + 1 源导出），以 3 为准的裁决正确。

### 2.4 `src/scripts/*.gd` → `build/scripts/` 同步 — ✅

`diff -rq build/scripts/ src/scripts/` → 无差异（6 文件一一对应：godot_operations/inspect_node/mcp_bridge/query_scene_tree/safe_values/screenshot_capture）。

### 2.5 CI 接线 — ✅

批 H 声称的 editor-e2e.yml debug step 接线属实（`.github/workflows/editor-e2e.yml:107` xvfb-run 跑 e2e-debug-tools，13 行新增在 ffd6172 --stat 确认）。

### 2.6 第一波三项"必须进批 K"闭环核验 — ✅ 全部闭环

| wave1 要求 | 闭环证据（本审实测） |
|-----------|---------------------|
| K-前-1：gen:tool-docs 补 drift | 批 J 重生成 4+1 文件；本审 §2.2 抽查产物一致 ✓ |
| K-前-2：CHANGELOG 点名 autoload 迁移 | 批 K 置顶 Breaking 段含完整迁移说明 ✓ |
| K-前-3：e2e L2 真跑进发版门禁 | 批 K 两轮干净环境 75 passed + 本审一轮独立复现 ✓ |

---

## 维度三：发版就绪评估（重点产出）

### 3.1 批 K 门禁输出逐条可信度核验 — 11/11 亲跑复现，零虚报

§0 表即核验结果：lint / build / npm test(356-5303) / check:gdscript(0-0) / check:budget(2w-0e) / check:tool-groups(41) / check:contract(0e-5w) / check:protocol-versions / version-check(0.28.3) / verify_delivery(3/3) / e2e L2(75-6-0) 全部与批 K 报告逐字一致。唯一方法学差异：批 K 的 verify_delivery 经一次性 node 脚本（已删，方法在报告披露：import `build/tools/delivery.js` handleTool）；本审改用 MCP 工具通道独立复现，结果一致——方法可复现性成立，采信。

### 3.2 移交 3 项 triage — 全部登记待办，不 block 发版

| # | 移交项 | 本审代码级核查 | Triage |
|---|--------|--------------|--------|
| 1 | `validation.ts` relOf 前缀失配（正斜杠 project_path → script_health 全量误报 "returned null"） | 属实。`:185` `absPath.replace(projectPath + pathSep, '')` 中 absPath 来自 `join()`（反斜杠）而 projectPath 保留用户入参形态；`:810`（batchValidateScripts）同款，`:830/:864/:944` 三处调用。`git log -S` 确认由历史 commit `0404f75` 引入，**非本分支回归**。影响面：Windows 正斜杠输入下 validate_scripts / verify_delivery script_health / create_files 后置校验误报（fail-noisy 方向，非假成功）。本审 verify_delivery 传反斜杠 3/3 passed 侧面印证形态敏感。 | **登记待办 P2**（发版不 block：存量 bug、0.28.3 同样存在、发版门禁本身不受影响）。修复 ~3 行（规范化分隔符后 replace）+ 正/反斜杠双形态用例，建议下批。 |
| 2 | e2e L2 连续跑竞态（第二轮起 2 个 bridge 用例 30s 超时） | 定性属实。干净环境单轮全绿已由**三轮独立证实**（批 K 两轮 + 本审一轮）；竞态为 afterAll 进程清理时序（残留游戏进程占 9081 端口），存量基建问题。本审首轮与后台 npm test 并发跑出 2 failed（edit_script 等非 bridge 用例也炸）进一步佐证"环境不净即竞态"。CI runner 每次全新不受影响。 | **登记待办 P3**（e2e 基建）。发版门禁按"干净环境单轮"执行已满足。建议后续批 afterAll 强化进程树清理（taskkill /T /F）。 |
| 3 | 两处 `:R` 残留（`gdscript-executor.ts:688` / `instance-api-auth.ts:121`） | 核查通过批 K 评估：① gdscript-executor：文件名 `randomUUID().slice(8)`（`:677`）每次新路径**无覆写场景**，:R 仅致 tmpdir 垃圾积累（os.tmpdir 系统清理兜底）；② instance-api-auth：触发链需"secret 文件存在且 <32 字符损坏 → fall through 重新生成 → writeFileSync 对 :R 文件 EACCES"，且 `safeWriteNoSymlink` 抛错由调用方 try/catch 降级（内存 secret，注释明示"认证不被磁盘问题阻断"）——不 crash，仅 MULTI_INSTANCE（手动 opt-in）多实例共享 secret 降级失效，触发面极窄。 | **登记待办 P3**。与 K-4 同款 `:R→:M` 统一修（3 行），建议与下批合并处理。两处均为历史遗留非本分支引入。 |

### 3.3 计划外修复 5968a03（readBridgeSecret ACL）正当性 — ✅ 成立

- **声明核实**：修复后四处 secret ACL 副本 grep 实测全部 `:M` 一致——`src/scripts/mcp_bridge.gd:553`（GD 游戏侧）/ `addons/godot_mcp_server/websocket_server.gd:187`（GD editor 侧）/ `src/core/editor-auth.ts:32` / `src/tools/game-bridge.ts:191`（TS 读路径，本 commit 所修）。"三副本漏改独此一处"的排查结论与全仓 `icacls.*:R` 盘点吻合（剩余两处即移交项 3，与 secret 无关）。
- **后果链成立**：R-only 无 DELETE → e2e afterAll/beforeAll 清理 EPERM → 整 suite 静默 skip（等价复活 G-4 修的静默 skip 问题）。批 K 提供两轮干净环境 75 passed + 修复后 secret 可删的实证，本审独立复现 L2 全绿。
- **修复最小且对齐先例**：1 行 + 注释，语义对齐 `editor-auth.ts:32` 既有 `:M`。安全权衡：本地单用户信任模型下 `:M` vs `:R` 边界差异微小（owner 总能 icacls 改回），换取 owner 可删性是正确工程取舍。
- **流程完备**：commit message 完整披露 + 批 K 报告 §5.3 + CHANGELOG :35 三处登记。属阻塞性前置（不修则 e2e L2 门禁不可重复执行），计划外理由充分。

### 3.4 K-2 保守处理（SDK 内置 setLevel + 注释锁定）裁决 — ✅ 终审维持

finding 前提复核属实：`node_modules/@modelcontextprotocol/server` 2.0.0 的 `mcp-DXXb3Vv3.mjs:734` 实测存在 `if (this._capabilities.logging) this._registerLoggingHandler();`——声明 `logging: {}` 即自动注册内置 `logging/setLevel` handler（维护 per-session `_loggingLevels`），"客户端调用会 method not found"的前提不成立。若按 brief 原方案自行注册，`setRequestHandler` 的 Map.set 覆盖语义会顶掉内置实现、丢级别过滤状态——**保守处理避免了引入真回归**。三重落地（capabilities 注释警告勿重复注册 / `vi.importActual` 真实 SDK 行为锁定 2 条 / 源码契约禁自行注册）充分。此为"capability 声明类 finding 必须先实测 SDK 内置行为"的正面案例。

### 3.5 最终判定：分支可发版（READY）

- Blocking 0；三维度全过；门禁 11/11 复现；wave1 遗留 3 项全部闭环。
- 移交 3 项均为存量问题（`0404f75` 历史引入 / e2e 基建竞态 / 历史 :R 遗留），发 0.28.4 不引入任何新回归，登记待办后发版。
- 版本号建议：批 K 建议 **0.28.4（patch）**，理由为 autoload 键迁移有自动迁移 + Breaking 需知段兜底、P0 修复幅度 patch 合适（0.29.0 亦合理，决策留用户）——本审认同 patch 足够：迁移是自愈型无需用户手动干预，且 Security 批均为既有功能的封堵非新 API。
- 发版外推清单（批 K §6 已列，本审确认）：push → merge → `npm version patch`（本波未改 rule-templates.ts，无 bump 强制）→ CHANGELOG [Unreleased] → 版本号段 → tag → `npm publish`。

---

## Blocking Issues

**无。**

## Nits

1. **Nit-1（watchdog 挂死场景壳协程泄漏）**：`_fill_response_box`（websocket_server.gd:510 附近）在 handler 真挂死时其内部 `await fn.call()` 永不返回，壳协程永久挂起（泄漏一个挂起协程帧）。无锁占用（互斥锁由 caller 释放）、无 reply 双发（box 结果被丢弃）、重启 editor 即清——影响极低，建议后续批在注释中补一句泄漏声明或评估 box 带代际标记。
2. **Nit-2（verify_delivery 门禁脚本未存档）**：批 K 用一次性 node 脚本（跑完即删）调用 `build/tools/delivery.js`，调用方式只在报告披露。本审已用 MCP 工具通道独立复现（3/3 passed），方法可复现性成立；建议后续把该调用固化为 `npm run verify:delivery` script，消除"门禁方法只存在于报告"的脆弱性。

## 值得进 memory 的教训

1. **同文件多批改动的"运行时闭环"要看最后一笔**：批 H 写的 e2e 验证了它当时的实现，批 I 随后改了同一代码路径（watchdog 包装），两层契约测试（源码 grep）绿但运行时 e2e 无重跑证据——静态契约锁不能替代"最后改动者重跑前批运行时验证"。本审补跑 3/3 passed 闭合，但流程上应由批 I brief 明确"改 debug 分支须重跑 e2e-debug-tools"。
2. **门禁报告可信度核验的最高效形态**：逐条亲跑 + 时间线排查——本审 e2e L2 首轮 2 failed 经时间线核对为自身并发失误（与后台 npm test 重叠 30s），复跑即绿；"复现失败→排除自身干扰→复现成功"的三步法避免了把操作失误误判为报告虚报。
3. **多副本 ACL/权限修复必须全模式 grep**（K 批教训复核成立）：`:R` 模式全仓盘点 4+2 处，历史修复只改了已知清单内的 3 处——`grep -rn ':R'` 全模式扫描才是完备盘点法；且残留两处的"触发面评估"（UUID 新路径无覆写 / 写失败有降级）是接受暂缓的合理依据，不是拍脑袋。

---

## 附：审查方法与证据可复现性

- 全部行号引用为 2026-08-15 HEAD（da14fa8）`grep -n` / `git show @@` / `sed -n` 实测。
- 全部 git 断言（diff 空 / hunk 区间 / SHA 主题）可直接以文中命令复跑。
- 全部门禁为 HEAD 亲跑（Godot 4.6.3，`GODOT_PATH=D:\godot\Godot_v4.6.3-stable_win64.exe`）；e2e 前清 `.godot` 缓存、与其它 vitest 实例串行。
- 本审唯一的写操作：本报告文件 + `npm run build`（产物 gitignore）/ `check:gdscript`（coverage 报告 gitignore）——`git status` 干净。
