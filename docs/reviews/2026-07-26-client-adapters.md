# client-adapters 扩展（4→13）第三方审查报告

**日期**：2026-07-27（补审查，实现于 2026-07-26）
**审查对象**：MCP client adapter 从 4 个扩展到 13 个
**审查者**：独立 code-reviewer 子 agent（隔离视角）+ 主 agent 复核 N-1
**审查范围**：spec / plan（1847 行）/ 代码实现 / 测试 / 文档同步 / 向后兼容

## 审查对象 commit 清单

| commit | 说明 |
|--------|------|
| `c242fd2` | docs(spec): client adapters 扩展设计 (4→13 client) |
| `26d7cc8` | docs(spec): 校准 client adapter 设计——plan 前置核实修正 |
| `cd4cbb9` | docs(plan): client adapter 扩展实现计划（12 task TDD，1847 行） |
| `9dcd870` | docs: CHANGELOG 记录 client adapter 扩展 (4→13) |
| `ec41678` | fix(cli): client adapter Minor 收尾——OpenCode seed/Antigravity 反向断言/DEFAULTS 类型 |
| `0232379` / `57b41a3` | docs: CHANGELOG 段标题对齐 em dash 风格 |

---

## 总体判定

**SHIPPED WITH NITS**（已交付，4 处文档/设计层面 Nits，无 Blocking）

13 个 client adapter 全部真实落地（不是声称），代码与 spec §2 表逐行对齐，测试覆盖完整（13/13 + 反向断言 + BOM + user-state + 跨平台 mock），向后兼容未破坏。

---

## A. 设计正确性 — ✅ 13 个 client 逐一定位对齐 spec

13 个 adapter 全部在 `ALL_ADAPTERS` 注册（`D:\GitHub\godot-mcp-enhanced\src\cli\clients\index.ts:24-40`），逐一核查 scope / 路径 / server_key / type / user-state 与 spec §2 表对齐：

| Client | 文件:行 | scope | 路径/server_key | 核查结论 |
|---|---|---|---|---|
| Claude Code | `claude-code.ts:10,17` | project | `{proj}/.claude/settings.json` `mcpServers` | 符合官方 |
| Cursor | `cursor.ts:10,17` | project | `{proj}/.cursor/mcp.json` `mcpServers` | 符合官方 |
| OpenCode | `opencode.ts:13,26` | project | `{proj}/opencode.json` `mcp` + `type:"local"` | 符合 sst/opencode local schema |
| Codex | `codex.ts:9` | global | CLI `codex mcp add`（避 TOML 陷阱） | 保留现状，合理 |
| Claude Desktop | `claude-desktop.ts:10,13` | global | `{APPDATA}/Claude/claude_desktop_config.json` | Win 路径正确，用 globalConfigRoot |
| Windsurf | `windsurf.ts:10,14` | global | `~/.codeium/windsurf/mcp_config.json` | 用 homedir()，符合 Codeium 官方 |
| Cline | `cline.ts:10,18` | global | `{APPDATA}/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` | 路径精确（VS Code ext id 正确） |
| Zed | `zed.ts:10,13` | global | `{APPDATA}/Zed/settings.json` `context_servers` | server_key 用 `context_servers`（非 mcpServers）正确 |
| Gemini CLI | `gemini-cli.ts:9,19` | project | `{proj}/.gemini/settings.json` | 符合 Google `--scope` 默认 project |
| Antigravity | `antigravity.ts:10,16-22` | global | 双路径 `~/.gemini/config/` + 旧 `~/.gemini/antigravity/` | 双路径兼容实现到位 |
| Trae | `trae.ts:10,13` | global | `{APPDATA}/Trae/User/mcp.json` | VS Code fork 路径合理，type 保守不加（注释 `trae.ts:28-29`） |
| Cherry Studio | `cherry-studio.ts:10,17` | global | `{APPDATA}/CherryStudio/mcp_servers.json` + `type:"stdio"` | 驼峰目录 + schema 强制 type，均正确 |
| Qwen Code | `qwen-code.ts:9,19` | project | `{proj}/.qwen/settings.json` | 符合 Qwen `--scope` 默认 |

**其他核查**：
- DEFAULTS 类型（commit ec41678）：per-client 用 `private static readonly USER_STATE_KEYS` + `USER_STATE_DEFAULTS`（如 `cline.ts:13-14`）
- type pin 策略：仅 Cherry Studio 强制 `type:"stdio"`、OpenCode 保留 `type:"local"`、Trae 不加（实机验证待定）
- BOM 防御：`stripBom`（`json-config.ts:5-7`）+ `readJsonForCheck`（`:46-53`），13 个 adapter 无内联 `JSON.parse(readFileSync)`

**无法核实**：各 client 配置路径是否符合**最新**官方文档（无实机环境），但路径/server_key 与 spec §2 三方交叉一致。

---

## B. 测试覆盖 — ✅ 13/13 专属测试文件齐备

| 测试维度 | 覆盖证据 |
|----------|----------|
| scope 断言（13/13） | 每个 test 文件首测均断言 `adapter.scope` |
| 反向断言 configure→isConfigured true | 全 13 个有 |
| user-state reconfigure 保留 | Cline/Cherry/Antigravity/Gemini/Qwen/OpenCode 6 个有 |
| BOM 防御 | `json-config.test.ts:26,54` + `opencode.test.ts:109` |
| 跨平台 mock | `paths.test.ts:14-46`（win32/darwin/linux 四测）+ global adapter `vi.doMock('os'/'paths.js')` |
| Antigravity 双路径 | `antigravity.test.ts:26,64` |
| Cherry type:"stdio" | `cherry-studio.test.ts:21` 显式断言 |
| Trae 不含 type | `trae.test.ts:22` 显式断言 undefined |
| 损坏 JSON 备份（F3） | `json-config.test.ts:31` + `opencode.test.ts:94` |

**OpenCode seed 测试（commit ec41678）真实存在**：`opencode.test.ts:58-68` 断言首次创建 seed `enabled:true`，`:117-126` 断言 reconfigure 保留旧 `enabled:false`。

**Antigravity 反向断言（commit ec41678）真实存在**：`antigravity.test.ts:54-74` 两个反向测例。

**测试级别**：单元级（mock `execFile`/`vi.doMock` os+paths + `mkdtempSync` 真实 tmpdir），非集成级。setup/doctor 测试 mock 全 13 adapter（`setup.test.ts:9-137`、`doctor.test.ts:7-83`）。

**无法核实**：vitest/tsc/eslint 是否全绿（无运行环境），plan Task 12 Step 2 要求全绿才 commit，代码层面未见会导致失败的问题。

---

## C. 文档同步 — ⚠️ 部分缺口（N-1）

| 仓库级约束 | 实测 | 结论 |
|-----------|------|------|
| 独立副本同步（`.claude/rules` ↔ `rule-templates.ts`） | grep `rule-templates.ts` 搜 client/adapter/setup → 零命中（仅 setup_project_rules）；`.claude/rules/godot-mcp-*.md` 6 文件均与 client adapter 无关 | ✅ **本 PR 未触发**，cli 改动不涉及分发规则模板 |
| capability-matrix | grep matrix 搜 Windsurf/Cline/client/adapter → 零命中 | ✅ **matrix 未被误改**（cli 不是 MCP 工具，spec §4-14 明确不进 matrix，CHANGELOG `CHANGELOG.md:18` 也声明） |
| **README / 使用指南** | grep README + 3 份使用指南搜新增 9 client（Claude Desktop/Gemini CLI/Antigravity/Trae/Cherry Studio/Qwen Code） → **零命中** | 🔴 **N-1 文档缺口**（主 agent 复核确认） |
| CHANGELOG | `CHANGELOG.md:9-18` 13 client 全列（含 scope 分布、BOM、user-state、Cherry type、matrix 不入） | ✅ 完整 |

**N-1 主 agent 复核结论**：grep README.md / README.en.md / docs/使用指南.md / 使用指南-ZCode.md / 使用指南-Warp.md 搜 "claude desktop|gemini.cli|antigravity|trae|cherry studio|qwen" 全部零命中，子 agent 结论成立。README.md:452-476 client 列表段只覆盖 Claude Code/Cursor/Cline/Windsurf/CodeBuddy/Warp/ZCode（且都是手动 JSON 配置法）。

---

## D. 向后兼容性 — ✅ 未破坏

- **原 4 client adapter 未破坏**：`claude-code.ts`/`cursor.ts`/`opencode.ts`/`codex.ts` 的 `configure()` 核心 entry 形态（`{command, args, env:{GODOT_PATH}}`）与改造前一致，仅补 `scope` + `isConfigured` 改用 `readJsonForCheck`（语义等价，仅多 BOM strip——是 bug fix 非破坏）
- **OpenCode 增强**：加 user-state 白名单 + 首次 seed `enabled:true`，对既有配置无破坏（保留旧值）
- **接口签名兼容**：`ClientAdapter` 方法签名（detect/isConfigured/configure）未变；`doctor.ts:12 checkClientConfig` 签名未动（spec §1.3 明确保守）
- **公开 API**：`ALL_ADAPTERS` 是新增导出，原有导出未删

---

## E. 验证完整性 — ✅ 12 task TDD 落实，无 YAGNI 违规

- **12 task TDD**：plan 1847 行确实 12 Task（Task 1 基础设施 → Task 12 CHANGELOG），每个 Task 含「Step 1 写失败测试 → Step 2 确认失败 → Step N 实现 → 通过 → commit」TDD 节奏。验收对照表（plan:1830-1847）14 条 spec §4 全映射到 Task
- **YAGNI 判断**：1847 行**不过度设计**——长度主要来自 9 个 adapter 的完整代码块（plan 直接贴实现代码便于 worker 复制）。未引入未要求抽象：无 `--global/--project` flag（spec §3.6 明确 YAGNI）、无 adapter registry 工厂、无 plugin 机制。`globalConfigRoot()` / `readJsonForCheck` / `readJsonConfigWithBackup` 分离有明确语义理由。**无 YAGNI 违规**
- **final review 质量**：plan 末尾是「验收对照表」非独立 final review 段——但 AGENTS.md「plan 落地后必出第三方审查文档」要求的是 plan 落地后产出 `docs/reviews/` 审查文档（即本次审查），不是 plan 内含 final review。grep `docs/reviews/*client*` → 零命中，**确认此前未产出第三方审查文档**（本次审查正是补此缺口）

---

## Blocking Issues

**无。**

---

## Nits

### N-1（文档完整性，confidence 85，主 agent 复核确认）：新增 9 client 在 README / 使用指南无说明

- **证据**：`README.md:452-476` client 列表段只覆盖 Claude Code/Cursor/Cline/Windsurf/CodeBuddy/Warp/ZCode（手动 JSON 配置法），新增的 Claude Desktop/Gemini CLI/Antigravity/Trae/Cherry Studio/Qwen Code 6 个无说明；`docs/使用指南.md` grep 新增 client 名零命中
- **影响**：用户跑 `npx godot-mcp-enhanced setup` 后这些 client 被自动配置，但文档查不到对应说明（尤其 Trae 的 type 保守不加、Cherry 的 type:"stdio" 强制、Antigravity 双路径等行为需用户知情）
- **修复方向**：README.md「一键配置」段（:478-482）补一句「支持 13 client：...（列全）」，或 `docs/` 新增 `client-adapters.md` 列表 + 各 client 路径/scope/type 备注
- **为何非 Blocking**：spec §4 验收标准未把 README/使用指南列为必交付物（只要求 CHANGELOG），spec §「实现产物清单」也只列 CHANGELOG 未列 README——这是 spec 本身产物清单遗漏，但属于 advisory

### N-2（设计 nit，confidence 80）：Gemini CLI / Qwen Code 的 detect() 用 process.cwd() 而非 projectDir

- **证据**：`gemini-cli.ts:14-16` `detect()` 用 `existsSync(join(process.cwd(), '.gemini', 'settings.json'))`；`qwen-code.ts:14-16` 同。而 `isConfigured(projectDir)` 用传入的 projectDir
- **影响**：当前调用链（setup.ts:52, doctor.ts:31 均用 `process.cwd()`）下 detect 与 isConfigured 目录一致，**功能正确**。但 detect 签名无参，若未来有调用方在不同 cwd 调 detect 会导致 detect/isConfigured 目录不一致
- **修复方向**：advisory，加一行注释说明「detect 依赖 process.cwd()，与 setup/doctor 调用链一致」

### N-3（advisory，confidence 80）：plan Task 12 Step 3 verify_delivery 标注「失败不阻塞」

- **证据**：plan:1812-1817「若 verify_delivery 因无关环境问题失败，记录原因，不阻塞（client adapter 是纯 TS CLI 侧改动）」
- **影响**：AGENTS.md「发版门禁」段明确 `verify_delivery` 是发版硬性门禁。plan 给的逃生舱合理（client adapter 纯 TS，不涉及 .tscn/.gd），但措辞「不阻塞」可能被误读为可绕过门禁
- **修复方向**：改为「verify_delivery 主要确认未破坏既有交付；若因 Godot 未装失败，记录原因并人工确认 client adapter 改动不触及交付物」

### N-4（一致性 nit，confidence 80）：Windsurf 用 homedir() 而非 globalConfigRoot()

- **证据**：`windsurf.ts:14` 用 `join(homedir(), '.codeium', 'windsurf', 'mcp_config.json')`；而 Claude Desktop/Cline/Zed/Trae/Cherry 用 `globalConfigRoot()`
- **影响**：功能正确（Windsurf 配置在 home 非 APPDATA，spec §3.3 确认）。但 8 个 global adapter 里 7 个用 `globalConfigRoot()`，Windsurf 独用 `homedir()`，初读会疑惑不一致
- **修复方向**：加一行注释说明「Windsurf 配置在 home 非 APPDATA（spec §3.3）」

---

## 值得记忆的工程教训（→ 待主 agent 集中登记）

1. spec/plan 的「实现产物清单」可能漏列文档同步项（本次 spec §实现产物清单只列 CHANGELOG，未列 README/使用指南）——审查者不能只对照清单打勾，要独立 grep 用户可见文档
2. detect() 无参签名与 isConfigured(projectDir) 的目录耦合是隐含假设——依赖调用链 cwd 一致才能保正确性，设计时应在注释显式声明此耦合
3. 跨平台全局路径不能无脑统一用 homedir()——Windsurf 在 home、Claude Desktop 在 APPDATA，须按各 client 官方路径分别选 homedir() vs globalConfigRoot()
4. 1847 行 plan 不等于过度设计——若长度来自 9 个同类 adapter 的完整代码块（便于 worker 直接复制），且未引入未要求抽象，是可接受的；YAGNI 判据看抽象层数非行数
5. BOM 防御要双路径覆盖——只在 configure 读加 stripBom 不够，isConfigured 内联读也要改，否则 doctor 误报 + setup 破坏幂等

---

## 相关文件（绝对路径）

- 实现：`D:\GitHub\godot-mcp-enhanced\src\cli\clients\*.ts`（13 adapter）+ `index.ts:24-40`（ALL_ADAPTERS）+ `json-config.ts`（BOM/备份）
- 测试：`D:\GitHub\godot-mcp-enhanced\test\cli\clients\*.test.ts`（13 文件）+ `json-config.test.ts` + `paths.test.ts` + `setup.test.ts` + `doctor.test.ts`
- 文档：`CHANGELOG.md:9-18`、`README.md:452-476`（缺口见 N-1）
- spec：`D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-07-26-client-adapters-design.md`
- plan：`D:\GitHub\godot-mcp-enhanced\docs\superpowers\plans\2026-07-26-client-adapters-expansion.md`

---

## 审查者署名

- **独立审查**：code-reviewer 子 agent（agent_317a0ae1，已完成）
- **复核**：主 agent（grep 复核 N-1 文档缺口成立）
- **限制声明**：各 client 配置路径是否符合最新官方文档无法核实（无实机环境）；vitest/tsc/eslint 全绿无法核实（无运行环境），但代码层面未见会导致失败的问题
