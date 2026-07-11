# editor PERSISTENT_SECRET Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 editor 侧加固定 secret 模式（对称 bridge S4），治本消除 `_ready` 每次覆盖写 `mcp_editor.key` 的需求及 MCP 端 TTL 缓存同步窗口。

**Architecture:** 对称移植 bridge `mcp_bridge.gd:216-226,441-443` 的 S4 机制到 editor plugin（GDScript）——`_generate_and_write_secret` 加 PERSISTENT 复用分支、`_delete_secret_file` 加 guard。配套扩展 TS 端 `buildSafeEnv` 透传白名单（`GODOT_MCP_EDITOR_*`），否则 `launch_editor` spawn 的编辑器子进程读不到 env，PERSISTENT 永不触发。文档改 template 源（`rule-templates.ts`），非生成物 .md。

**Tech Stack:** GDScript 4.x（editor plugin `addons/godot_mcp_server/`）、TypeScript（`src/helpers.ts`）、vitest（`test/helpers.test.js`）、Godot `--headless --import` 编译门（`test/fixtures/gdscript-check`）。

## Global Constraints

（从 spec `D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-07-11-editor-persistent-secret-design.md` 逐字抄录，所有 task 隐含遵守）

- **env 名**：`GODOT_MCP_EDITOR_PERSISTENT_SECRET`（与 `GODOT_MCP_BRIDGE_PERSISTENT_SECRET` 平行命名；两 secret 独立文件 `mcp_editor.key` / `mcp_bridge_9081.secret`）
- **默认值**：`false`（`.to_lower() == "true"` 判定；生产保持 secret 每次轮换，本地测试 opt-in）
- **对称阈值**：复用条件 `_existing.length() >= 32`（对称 bridge `mcp_bridge.gd:223`）
- **不改** `src/core/editor-auth.ts` 读逻辑（PERSISTENT 时 key 稳定，读逻辑零改动）
- **不退** ACL `:R`→`:M`（`:M` 保留作非 PERSISTENT 模式的覆盖写缓解）
- **`_start_server` 方案 1**：PERSISTENT 复用早 return 前**不**调 `_start_server()`，由 `_ready:49` 统一启动（避免双重调用致 TCPServer 孤儿）

## Spec Gap 纠正（review 发现，本 plan 已纳入）

spec 原列 2 文件改动，review 发现 2 处遗漏，本 plan 扩为 5 文件：

1. **`src/helpers.ts` buildSafeEnv 透传**（spec 漏）：`launch_editor`（`runtime.ts:128`）用 `buildSafeEnv()` spawn 编辑器，而 `buildSafeEnv`（`helpers.ts:141`）只透传 `GODOT_MCP_BRIDGE_*`，`GODOT_MCP_EDITOR_*` 被截断 → editor plugin `OS.get_environment()` 读空 → PERSISTENT 永不触发。bridge 能工作正是因为 `BRIDGE_*` 在白名单（`helpers.test.js:317` 测）。**必须对称扩展白名单**。
2. **改 `rule-templates.ts` 而非 `.claude/rules/godot-mcp-editor.md`**（spec 改动点 3 位置错）：后者是 `project.ts:453` 从 `DETAILED_RULE_TEMPLATES` 生成的产物，直接改会被下次 `setup_project_rules` 覆盖。改 template 源才持久。

**预存漂移（flag，不在本任务修）**：实际 `.claude/rules/godot-mcp-editor.md` 的「常见陷阱」段比 `rule-templates.ts:328-334` template 多 3 条（4.7 Vector 兼容、原生类虚函数 super() 回归、端口 9090-9094）——手动加到 .md 未回填 template。下次重新生成 .md 会丢失这 3 条。本 plan 只在 template 加 S4-editor 一条；漂移回填建议单独 task（见 Self-Review）。

---

## File Structure

| 文件 | 责任 | 本 plan 改动 |
|---|---|---|
| `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\websocket_server.gd` | editor plugin WebSocket 服务 + secret 管理 | `_generate_and_write_secret` 重排 + PERSISTENT 分支；`_delete_secret_file` guard |
| `D:\GitHub\godot-mcp-enhanced\test\fixtures\gdscript-check\addons\godot_mcp_server\websocket_server.gd` | 主文件精确拷贝，供 `--import` 编译门 | 同步主文件改动（diff 已验证两文件 414 行一致） |
| `D:\GitHub\godot-mcp-enhanced\src\helpers.ts` | `buildSafeEnv` 构造安全子进程 env | 白名单扩展 `BRIDGE_` → `BRIDGE_`‖`EDITOR_` + 注释 |
| `D:\GitHub\godot-mcp-enhanced\test\helpers.test.js` | `buildSafeEnv` 单测 | 加 EDITOR_ 透传断言（对称 :317）+ 扩展边界 :327 |
| `D:\GitHub\godot-mcp-enhanced\src\tools\rule-templates.ts` | `.claude/rules/*.md` 的 template 源 | editor template「常见陷阱」加 S4-editor 条目 |

---

## Task 1: buildSafeEnv 透传 GODOT_MCP_EDITOR_*（TS，TDD）

**为什么先做**：这是 launch_editor 路径下 PERSISTENT 能否触发的硬依赖。先落 TS 端 + 测试，再改 .gd。

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\test\helpers.test.js:317-337`（加测试 + 扩展边界）
- Modify: `D:\GitHub\godot-mcp-enhanced\src\helpers.ts:126-144`（白名单 + 注释）

**Interfaces:**
- Produces: `buildSafeEnv()` 透传 `GODOT_MCP_EDITOR_*` 子命名空间（editor plugin `_generate_and_write_secret` / `_delete_secret_file` 经 `OS.get_environment` 消费）

- [ ] **Step 1: 写失败测试（helpers.test.js）**

在 `helpers.test.js:325`（`透传 GODOT_MCP_BRIDGE_* env` 测试块结尾 `});` 之后、`:327` 边界测试之前）插入新测试：

```javascript
  it('透传 GODOT_MCP_EDITOR_* env 给 editor 子进程(S4-editor GDScript 修复依赖)', () => {
    // websocket_server.gd 读这个 env 启用 PERSISTENT_SECRET 复用。launch_editor
    // (runtime.ts:128)用 buildSafeEnv spawn 编辑器,若截断则 editor plugin
    // OS.get_environment() 读不到,PERSISTENT 永不触发。对称 BRIDGE_(见上测)。
    process.env.GODOT_MCP_EDITOR_PERSISTENT_SECRET = 'true';
    const env = buildSafeEnv();
    expect(env.GODOT_MCP_EDITOR_PERSISTENT_SECRET).toBe('true');
  });
```

同时扩展 `helpers.test.js:327-337` 的边界测试，加 EDITOR_ 断言（证明 EDITOR_ 透传 + 安全开关仍隔离）。将原测试改为：

```javascript
  it('透传 GODOT_MCP_BRIDGE_*/EDITOR_* 子命名空间,但不透传服务端安全开关', () => {
    // 边界:只透传 mcp_bridge.gd/websocket_server.gd 运行时配置(BRIDGE_/EDITOR_ 子前缀);
    // 服务端安全开关(UNRESTRICTED/ALLOW_UNSAFE 等)必须隔离 —— 子进程不能自行解锁路径/沙箱限制。
    process.env.GODOT_MCP_BRIDGE_FUTURE_FLAG = '1';
    process.env.GODOT_MCP_EDITOR_PERSISTENT_SECRET = 'true';
    process.env.GODOT_MCP_UNRESTRICTED = 'true';
    process.env.GODOT_MCP_ALLOW_UNSAFE = 'true';
    const env = buildSafeEnv();
    expect(env.GODOT_MCP_BRIDGE_FUTURE_FLAG).toBe('1');
    expect(env.GODOT_MCP_EDITOR_PERSISTENT_SECRET).toBe('true');
    expect(env.GODOT_MCP_UNRESTRICTED).toBeUndefined();
    expect(env.GODOT_MCP_ALLOW_UNSAFE).toBeUndefined();
  });
```

- [ ] **Step 2: 跑测试验证失败**

Run: `cd D:/GitHub/godot-mcp-enhanced && npx vitest run test/helpers.test.js -t "EDITOR"`
Expected: FAIL — 新测试 `expect(env.GODOT_MCP_EDITOR_PERSISTENT_SECRET).toBe('true')` 收到 `undefined`（buildSafeEnv 尚未透传 EDITOR_）；边界测试同理。

- [ ] **Step 3: 改 helpers.ts 白名单**

`helpers.ts:141`：
```typescript
    if (key.startsWith('GODOT_MCP_BRIDGE_') && value !== undefined) {
```
改为：
```typescript
    if ((key.startsWith('GODOT_MCP_BRIDGE_') || key.startsWith('GODOT_MCP_EDITOR_')) && value !== undefined) {
```

- [ ] **Step 4: 改 helpers.ts 注释（:126-136）**

在 `:131`（`never runs.` 行）之后、`:133`（`Scope is intentionally narrow` 行）之前插入一段；并将 `:133` 的 scope 描述更新为含 EDITOR_。

在 `* never runs.` 后插入：
```typescript
 *
 * S4-editor (2026-07-11): GODOT_MCP_EDITOR_* added symmetrically — editor plugin
 * (addons/godot_mcp_server/websocket_server.gd) reads GODOT_MCP_EDITOR_PERSISTENT_SECRET
 * at _ready via OS.get_environment(); launch_editor spawns the editor with buildSafeEnv,
 * so without passthrough the env is stripped and PERSISTENT never triggers. Same
 * sub-namespace rule (runtime config, NOT credentials).
```

`:133` 原文：
```typescript
 * Scope is intentionally narrow (GODOT_MCP_BRIDGE_, not GODOT_MCP_): server-side
```
改为：
```typescript
 * Scope is intentionally narrow (GODOT_MCP_BRIDGE_ / GODOT_MCP_EDITOR_, not bare
 * GODOT_MCP_): server-side
```

- [ ] **Step 5: 跑测试验证通过**

Run: `cd D:/GitHub/godot-mcp-enhanced && npx vitest run test/helpers.test.js -t "buildSafeEnv"`
Expected: PASS — 全部 buildSafeEnv 测试绿（含新 EDITOR_ 测试 + 扩展边界）。

- [ ] **Step 6: 跑全量 helpers.test.js 确认无回归**

Run: `cd D:/GitHub/godot-mcp-enhanced && npx vitest run test/helpers.test.js`
Expected: PASS — 全文件绿（strip 凭据 / 保留 PATH-HOME / BRIDGE_ 透传均不退化）。

- [ ] **Step 7: Commit**

```bash
cd D:/GitHub/godot-mcp-enhanced
git add src/helpers.ts test/helpers.test.js
git commit -m "feat(auth): buildSafeEnv 透传 GODOT_MCP_EDITOR_* 给 editor 子进程

对称 BRIDGE_* 白名单(helpers.test.js:317)。launch_editor(runtime.ts:128)用
buildSafeEnv spawn 编辑器,否则 editor plugin OS.get_environment() 读不到
GODOT_MCP_EDITOR_PERSISTENT_SECRET,PERSISTENT 永不触发。
服务端安全开关(UNRESTRICTED/ALLOW_UNSAFE)仍隔离,边界测试 :327 覆盖。"
```

---

## Task 2: websocket_server.gd PERSISTENT 复用 + delete guard（GDScript，编译门）

**测试模式说明**：项目对 `.gd` 无 gut/gdUnit 单测基建（bridge S4 当时也靠编译门 + e2e + 人工）。本 task 验证 = `--headless --import` 编译门（parse 干净）+ 行为核对清单。**必须用 `--import` 非 `--check-only`**（后者假绿，见 `godot-mcp-editor.md:95`）。

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\websocket_server.gd:51-108`（`_generate_and_write_secret`）、`:174-179`（`_delete_secret_file`）
- Modify: `D:\GitHub\godot-mcp-enhanced\test\fixtures\gdscript-check\addons\godot_mcp_server\websocket_server.gd`（同步）

**Interfaces:**
- Consumes: `GODOT_MCP_EDITOR_PERSISTENT_SECRET` env（Task 1 已确保 launch_editor 路径透传）
- Produces: PERSISTENT 模式下 `_secret` 复用文件内容、`_exit_tree` 不删 `mcp_editor.key`

- [ ] **Step 1: 重排 `_generate_and_write_secret` 头部 + 插 PERSISTENT 分支**

`addons/godot_mcp_server/websocket_server.gd` 中，将 `:55-68`（`_secret = _generate_secret()` 起到 `_secret_file = godot_dir.path_join("mcp_editor.key")`）整段替换为下面内容（重排：project_dir/godot_dir/`_secret_file` 提前到 `_generate_secret` 前，中间插 PERSISTENT 复用分支；方案 1——分支内**不**调 `_start_server`）：

old（`:55-68`，tab 缩进）：
```gdscript
	_secret = _generate_secret()
	if _secret.length() < 32:
		push_error("[MCP] Secret generation failed — WebSocket server will not start")
		_secret = ""
		return
	var project_dir: String = _get_project_dir()
	if project_dir == "":
		push_warning("[MCP] Cannot determine project dir; editor auth disabled")
		return
	var godot_dir: String = project_dir.path_join(".godot")
	var dir := DirAccess.open(project_dir)
	if dir and not dir.dir_exists(".godot"):
		dir.make_dir(".godot")
	_secret_file = godot_dir.path_join("mcp_editor.key")
```

new（重排 + PERSISTENT 分支，tab 缩进）：
```gdscript
	var project_dir: String = _get_project_dir()
	if project_dir == "":
		push_warning("[MCP] Cannot determine project dir; editor auth disabled")
		return
	var godot_dir: String = project_dir.path_join(".godot")
	var dir := DirAccess.open(project_dir)
	if dir and not dir.dir_exists(".godot"):
		dir.make_dir(".godot")
	_secret_file = godot_dir.path_join("mcp_editor.key")
	# S4-editor: 固定 secret 模式(本地测试, env GODOT_MCP_EDITOR_PERSISTENT_SECRET=true)。
	# mcp_editor.key 存在且有效则复用,跳过重生+写入+_restrict,打破"重生→覆盖写→
	# MCP 端 TTL 缓存不同步"窗口(对称 bridge mcp_bridge.gd:216-226 S4)。默认 false。
	# 不调 _start_server — 由 _ready:49 统一调(避免双重调用致 TCPServer 孤儿)。
	var _persistent_secret := OS.get_environment("GODOT_MCP_EDITOR_PERSISTENT_SECRET").to_lower() == "true"
	if _persistent_secret and FileAccess.file_exists(_secret_file):
		var _existing := FileAccess.get_file_as_string(_secret_file)
		if _existing.length() >= 32:
			_secret = _existing
			print("[MCP] Reusing persistent editor secret (GODOT_MCP_EDITOR_PERSISTENT_SECRET=true)")
			return
	_secret = _generate_secret()
	if _secret.length() < 32:
		push_error("[MCP] Secret generation failed — WebSocket server will not start")
		_secret = ""
		return
```

> `:69+`（`# Windows: FileAccess.close 走 atomic rename...` 起的 PowerShell 写 + fallback 逻辑）**原样不动**，紧接上面 new 的 `return` 之后。`:52-54` 的 I-3 SECURITY 注释也不动。

- [ ] **Step 2: `_delete_secret_file` 加 PERSISTENT guard**

`addons/godot_mcp_server/websocket_server.gd:174-179`。old：
```gdscript
func _delete_secret_file() -> void:
	if _secret_file != "" and FileAccess.file_exists(_secret_file):
		DirAccess.remove_absolute(_secret_file)
		print("[MCP] Auth secret file deleted")
	_secret_file = ""
	_secret = ""
```
new：
```gdscript
func _delete_secret_file() -> void:
	# S4-editor: 固定 secret 模式不删(持久化供下次启动复用 + 与 MCP 端 TTL 缓存保持同步)。
	# 对称 bridge mcp_bridge.gd:441-443。
	var _persistent_secret := OS.get_environment("GODOT_MCP_EDITOR_PERSISTENT_SECRET").to_lower() == "true"
	if _persistent_secret:
		return
	if _secret_file != "" and FileAccess.file_exists(_secret_file):
		DirAccess.remove_absolute(_secret_file)
		print("[MCP] Auth secret file deleted")
	_secret_file = ""
	_secret = ""
```

- [ ] **Step 3: 同步 fixture**

fixture 是主文件精确拷贝（diff 已验证两文件均 414 行、头部一致）。主文件改完后覆盖 fixture：

```bash
cd D:/GitHub/godot-mcp-enhanced
cp addons/godot_mcp_server/websocket_server.gd test/fixtures/gdscript-check/addons/godot_mcp_server/websocket_server.gd
```

验证同步：`diff addons/godot_mcp_server/websocket_server.gd test/fixtures/gdscript-check/addons/godot_mcp_server/websocket_server.gd && echo "SYNC OK"`，预期输出 `SYNC OK`（无差异）。

- [ ] **Step 4: 编译门验证**

Run（本会话 `GODOT_PATH=D:\godot\Godot_v4.7-stable_win64.exe`，按实际替换）：
```bash
cd D:/GitHub/godot-mcp-enhanced
"D:/godot/Godot_v4.7-stable_win64.exe" --headless --import --path test/fixtures/gdscript-check 2>&1 | grep -iE "error|parse|SCRIPT" || echo "COMPILE CLEAN"
```
Expected: 输出 `COMPILE CLEAN`（无 parse error / SCRIPT ERROR）。**若出现 error**：PERSISTENT 分支/guard 有语法错，回到 Step 1/2 核对 tab 缩进与 GDScript 语法。**禁用 `--check-only`**（只打 banner 不编译，假绿）。

- [ ] **Step 5: 行为核对清单（spec :85-87）**

人工核对（`addons/godot_mcp_server/websocket_server.gd`）：
- [ ] env 名 `GODOT_MCP_EDITOR_PERSISTENT_SECRET` 在 `_generate_and_write_secret` + `_delete_secret_file` 两处一致
- [ ] 默认 false（`.to_lower() == "true"`，非 env 存在即真）
- [ ] 复用阈值 `_existing.length() >= 32`
- [ ] `_start_server()` **仅**在 `_ready:49` 出现一次——PERSISTENT 分支内无此调用（grep 验证：`grep -n "_start_server" addons/godot_mcp_server/websocket_server.gd`，:45 代码块不应有，只有 :49 `_ready` 和 :181 定义）
- [ ] PERSISTENT 分支在 project_dir 校验之后（project_dir 为空时早在 `:61-63` return，到不了 PERSISTENT）

- [ ] **Step 6: 可选手动行为验证（有 Godot 环境时）**

```bash
# 预放一个有效 secret（>=32 字符）
mkdir -p /tmp/editor-persistent-test/.godot
echo -n "0123456789abcdef0123456789abcdef" > /tmp/editor-persistent-test/.godot/mcp_editor.key
GODOT_MCP_EDITOR_PERSISTENT_SECRET=true "D:/godot/Godot_v4.7-stable_win64.exe" --editor --path /tmp/editor-persistent-test
# 预期 stdout 含: [MCP] Reusing persistent editor secret (GODOT_MCP_EDITOR_PERSISTENT_SECRET=true)
# 预期: mcp_editor.key 内容不变(未被覆盖写)
```
（无 Godot 环境则跳过，注明"手动行为验证未执行"，编译门 + grep 核对已覆盖静态正确性。）

- [ ] **Step 7: Commit**

```bash
cd D:/GitHub/godot-mcp-enhanced
git add addons/godot_mcp_server/websocket_server.gd test/fixtures/gdscript-check/addons/godot_mcp_server/websocket_server.gd
git commit -m "feat(editor): PERSISTENT_SECRET 固定 secret 模式(对称 bridge S4)

_generate_and_write_secret 加 PERSISTENT 复用分支(env GODOT_MCP_EDITOR_PERSISTENT_SECRET=true
时复用 mcp_editor.key,跳过重生+写入+_restrict);_delete_secret_file 加 guard(PERSISTENT
时不删)。治本消除 _ready 覆盖写需求 + MCP 端 TTL 缓存同步窗口。

_start_server 方案 1:PERSISTENT 早 return 前不调,由 _ready:49 统一启动(避免
双重调用致 TCPServer 孤儿)。默认 false 保持生产 secret 轮换。

fixture(test/fixtures/gdscript-check)同步。--headless --import 编译门通过。"
```

---

## Task 3: rule-templates.ts 加 S4-editor 文档条目

**为什么改 template 源而非 .md**：`godot-mcp-editor.md` 是 `project.ts:453` 从 `DETAILED_RULE_TEMPLATES` 生成的产物，直接改 .md 会被覆盖。

**Files:**
- Modify: `D:\GitHub\godot-mcp-enhanced\src\tools\rule-templates.ts:328-335`（editor template「常见陷阱」段）

**Interfaces:** 无（纯文档）

- [ ] **Step 1: 在 editor template「常见陷阱」段加 S4-editor 条目**

`rule-templates.ts:334`（editor template 的 `常见陷阱` 段最后一条 `- **端口冲突**：...` 行）之后、`:335` 的模板字符串闭合 `` `, `` 之前，插入：

```typescript
- **editor 固定 secret（S4-editor）**：设环境变量 \`GODOT_MCP_EDITOR_PERSISTENT_SECRET=true\`，editor plugin 复用现有 \`mcp_editor.key\`（不重生、不收紧 ACL、\`_exit_tree\` 不删除），彻底消除 \`_ready\` 覆盖写需求及 MCP 端 TTL 缓存同步窗口。仅本地测试用（安全降级——secret 固定不再轮换，生产保持默认 false）。对称 bridge \`GODOT_MCP_BRIDGE_PERSISTENT_SECRET\`（见 godot-mcp-bridge.md「密钥权限循环」）。
```

> 注意：在 TS 模板字符串内，反引号需转义为 `` \` ``（如上），否则提前终止字符串。

- [ ] **Step 2: 验证 template 语法（TS 编译）**

Run: `cd D:/GitHub/godot-mcp-enhanced && npx tsc --noEmit src/tools/rule-templates.ts 2>&1 | head -20 || echo "TSC CHECK DONE"`
Expected: 无报错（若项目用项目级 tsc，跑 `npx tsc --noEmit` 全量）。反引号转义错会报字符串未终止。

- [ ] **Step 3: 可选——重新生成 .md 验证产出（需确认漂移处理）**

⚠️ **预存漂移**：实际 `.claude/rules/godot-mcp-editor.md` 比 template 多 3 条手动加的（4.7 Vector / super() 回归 / 端口 9090-9094）。**若此时跑 setup_project_rules 重新生成 .md，会丢失这 3 条**。

**两个选择**（由执行者/用户定）：
- A) 不重新生成 .md（template 改了即可，.md 下次用户主动 setup 时同步——届时需先回填漂移）
- B) 先把 .md 多出的 3 条回填到 `rule-templates.ts:330-334`，再重新生成（彻底消漂移，但扩范围）

本 task 默认 **A**（最小范围）。漂移回填记为后续 TODO（见 Self-Review）。

- [ ] **Step 4: Commit**

```bash
cd D:/GitHub/godot-mcp-enhanced
git add src/tools/rule-templates.ts
git commit -m "docs(rule): editor template 加 S4-editor 固定 secret 陷阱条目

改 template 源(rule-templates.ts)而非生成物 .claude/rules/godot-mcp-editor.md
(后者由 project.ts:453 从 DETAILED_RULE_TEMPLATES 生成,直接改会被覆盖)。
对称 bridge godot-mcp-bridge.md 密钥权限循环条目。"
```

---

## Self-Review

**1. Spec coverage**

| spec 要求 | 覆盖 task |
|---|---|
| 改动点 1 `_generate_and_write_secret` PERSISTENT 复用分支 | Task 2 Step 1 |
| 改动点 1 重排 `_secret_file` 赋值顺序 | Task 2 Step 1（project_dir/godot_dir/`_secret_file` 提前） |
| 改动点 1 `_start_server` 方案 1（不调，靠 _ready:49） | Task 2 Step 1（注释）+ Step 5（grep 核对） |
| 改动点 2 `_delete_secret_file` guard | Task 2 Step 2 |
| 改动点 3 rule 文档加 S4-editor 条目 | Task 3 Step 1（改 template 源，spec gap 纠正） |
| 验证：编译干净 | Task 2 Step 4 |
| 验证：注释自洽 | Task 2 Step 5 |
| 验证：`_start_server` 单次调用 | Task 2 Step 5（grep） |
| **spec gap**：helpers.ts 透传 | Task 1（spec 漏，本 plan 补） |

无遗漏。

**2. Placeholder scan**：无 TBD/TODO/"类似 Task N"；每步含实际代码或精确命令。Task 2 Step 1 的 `:69+ 原样不动` 是精确行号指示（非占位符），实施者照原样保留。

**3. Type/命名一致性**：
- env 名 `GODOT_MCP_EDITOR_PERSISTENT_SECRET`：Task 1（helpers.ts）、Task 2（.gd 两处）、Task 3（文档）四处一致 ✓
- `buildSafeEnv` 签名不变（仅白名单条件扩展）✓
- `_persistent_secret` 局部变量名在 `_generate_and_write_secret` + `_delete_secret_file` 两处一致（对称 bridge `mcp_bridge.gd:219,441`）✓

**4. 失败模式**

| 新 codepath | 失败方式 | 测试覆盖 | 错误处理 | 用户可见 |
|---|---|---|---|---|
| PERSISTENT 复用分支 | env 未透传（launch_editor）| Task 1（helpers.test.js）| — | 静默不触发（已修） |
| PERSISTENT 复用分支 | secret 文件 <32 字符 | Task 2 Step 6（手动）| 走原 `_generate_secret` 路径 | print 区分 |
| `_start_server` 双重调用 | 误在分支内调 | Task 2 Step 5（grep）| — | TCPServer 孤儿（已防） |
| `_delete` guard | PERSISTENT 时仍删 | 编译门不覆盖行为 | — | secret 不持久（手动 Step 6 验） |

无"无测试 + 无错误处理 + 静默失败"的关键缺口（helpers.ts 透传这条最危险的静默失败已被 Task 1 测试覆盖）。

**5. 后续 TODO（建议单独 task，不在本 plan）**

- **rule template 漂移**（决策：不回填 / wontfix，2026-07-11）：`.claude/rules/godot-mcp-editor.md` 手动加的 3 条（4.7 Vector / super() 654b162 / 端口 9090-9094）含 godot-mcp-enhanced **内部引用**（`docs/review-followup-2026-06-18.md:93` 路径、`[[godot-editor-plugin-e2e-verification]]` wikilink、`test/fixtures/gdscript-check` 路径、654b162 hash），不适合进生成给**目标项目**（装 plugin 的用户项目）的 template。信息已在 defects.md/CHANGELOG/开发日志。下次 `setup_project_rules` 重新生成 .md 时丢 = 清理生成物错位（可接受）。原列 IMPORTANT 回填，经评估降级 wontfix。
- **e2e 集成**（可选）：对称 `e2e-full-tool-verification.test.ts:822`，加 editor PERSISTENT 的 e2e（设 env + launch_editor + 验证 secret 复用）。

---

## Completion Summary

- Task 1（helpers.ts TDD）：7 steps，先写失败测试 → 白名单扩展 → 测试绿
- Task 2（websocket_server.gd 主+fixture）：7 steps，重排 + PERSISTENT 分支（方案 1）+ delete guard + fixture 同步 + 编译门 + 行为核对
- Task 3（rule-templates.ts）：4 steps，template 源加文档条目 + flag 漂移
- spec gap 纠正：2 处（helpers.ts 透传 + rule-templates 替代 .md）
- 后续 TODO：2 项（漂移回填 IMPORTANT / e2e 可选）
