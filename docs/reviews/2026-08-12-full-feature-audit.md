# 全功能业务逻辑与漏洞审计 — 2026-08-12

> ⚠️ **状态更新(2026-08-12):全部 16 项发现已修复并验证通过。** 验证证据:lint EXIT 0 / build EXIT 0 / **test 5082 passed**(原 5058,+24 新回归测试)/ check:gdscript errors=0 warnings=0。每项修复的文件:行号与测试见文末「九、修复落地记录」。

> 审查目标:全面和深入地检查每一个功能,验证业务逻辑正常,无问题和漏洞。
> 审查分支:`feat/multi-instance-receiver-and-e2e-asset-harness`(相对 master +4452 行 / 113 文件)
> 审查方法:4 个独立 code-reviewer 子 agent 分域深审 + 主审亲自核实关键发现 + 全仓库漏洞 grep 扫描 + 基线测试。
> 总体判定:**1 CRITICAL + 2 HIGH(需合并前修)** — 核心安全护城河设计正确、实现到位;经两轮 8 agent + 主审深审,发现 1 个 CRITICAL(animtree action 完全失效)+ 2 个 HIGH(功能 bug)+ 11 个 MEDIUM + 多个 LOW/Nit。第二轮把覆盖从"代表性抽样"扩展到"几乎每个工具/子系统",确认 tscn/scoring/dashboard/telemetry/game-bridge/项目文件工具/构建器 UI 全部扎实。

---

## 一、基线证据(实跑)

| 检查 | 命令 | 结果 |
|------|------|------|
| Lint | `npm run lint` | EXIT 0,零警告 |
| Build | `npm run build`(tsc strict) | EXIT 0,7 个 .gd + instructions.md 拷贝成功 |
| Test | `npm test` | **5058 passed / 30 skipped**(344 文件,5 skipped),102.07s |

> 测试全绿 ≠ 业务逻辑正确。本审计多个发现均有测试覆盖缺口(见第五节),正是 bug 漏网的根因。

---

## 二、经审查确认无问题的核心(护城河扎实)

以下经主审 + 子 agent 双重核实,实现正确,列出以减少后续复审成本:

1. **路径白名单主干**(`src/core/path-utils.ts`)
   - `resolveWithinRoot`:UNC 拒绝 → Windows 设备名拒绝(CON/PRN/…)→ 迭代 URL 解码(最多 20 轮,防多层编码)→ 段级 `..` 精确拒绝(F-4,不误伤 `my..file.txt`)→ realpath + relative 兜底。
   - `isPathInAllowedRoots`:**deny-by-default**(C-07),无 allowlist 时回落 cwd;**双侧 realpath**(C-1/C-SEC-1)堵 Windows junction 绕过(普通用户权限即可建 junction,这是竞品易漏点)。
   - TOCTOU(safeRealPath 后到实际写文件间父段被换 symlink)诚实标注为本地单用户信任场景的接受风险。

2. **多实例 API 认证**(`src/core/instance-api-auth.ts`)
   - HMAC-SHA256,token 格式 `timestamp.nonce.hmac`;**常量时间比较**(:155-160 先长度后逐字节 XOR,无短路)。
   - nonce 在 HMAC 验证通过**后**才记录(:162,A-2 fix,防伪造 token 污染 nonce 池);nonce 池 10000 上限 + 120s 清理。
   - secret 文件 `lstatSync` 拒绝 symlink + Linux 0o600 + Windows icacls 收紧;用户名正则校验防 ACL 注入。

3. **危险操作 action-gate**(`src/core/action-gate.ts`)+ `debug.evaluate` 三层防护
   - action-gate 默认 gate RCE action,opt-in via env;`debug.evaluate` 已纳入 `code-execution` 组。
   - ToolDispatcher:273 接线 `isActionGated && !isActionAllowed → ACTION_GATED`。
   - `debug.ts:141` RiskLevel 从 `read` 改 `write` 触发确认门;GD 侧要求暂停在断点(:347)+ reload_scripts 新加 `..` 拦截(P2-5)。

4. **路径校验接线完整性**(主审独立跨切面核查)
   - ToolDispatcher 中央只校验 `project_path`/`search_dir`(:634-643),其余路径参数由各工具自行 `resolveWithinRoot`。
   - 逐一核查所有 AI 可触发的文件写入工具:**全部正确过 resolveWithinRoot/isPathInAllowedRoots/requireProjectPath**(batch-tools:120、code-templates:838、screenshot:86-96、scene-commit-tool:63 等)。
   - 无校验的写入仅限 CLI/构建/管理工具(`cli/clients/*`、`scoring/*`、`build-matrix.ts` 等),不在 AI 请求路径,威胁面不同,可接受。

5. **HTTP server**(`src/core/instance-http-server.ts`):硬编码绑定 `127.0.0.1`(:105,非 0.0.0.0);非 POST 返 405;dispatcher 异常返固定文案不泄露(:218);超时对称(receiver 30s 对齐 sender AbortSignal 30s)。

---

## 三、功能 Bug(业务逻辑错误)

### F-1 [HIGH] `csv_to_resources` timeout=0/负数瞬杀 Godot 进程

- **位置**:`D:\GitHub\godot-mcp-enhanced\src\tools\data-import.ts:389`
- **问题**:`timeout: (args.timeout as number | undefined) ?? 60` —— `??` 只拦截 null/undefined,**不拦截 0 或负数**。传 `timeout: 0` → `0 ?? 60` 返回 `0` → `executeGdscript` 的 `setTimeout(fn, 0)` 立刻 `forceKillTree` 秒杀刚 spawn 的 Godot 进程,返回 "Godot process timed out after 0s"。
- **触发场景**:AI 循环调 csv_to_resources 把 timeout:0 当"无超时";或客户端误填。
- **对照**:`script.ts:966`、`workflow.ts:273` 都走 `validateTimeout(args.timeout, 5, 120, 30)` 钳制,只有 data-import 漏。
- **修复**:`import { validateTimeout } from './shared/validation.js'` → `timeout: validateTimeout(args.timeout, 5, 300, 60)`(已确认 validateTimeout 存在于 `src/tools/shared/validation.ts:5`)。
- **验证证据**:`grep -n "validateTimeout" src/tools/shared/validation.ts` → `:5 export function validateTimeout(value, min=5, max=120, defaultVal=30)`。

### F-2 [HIGH] `isErrorText` 误判 screenshot `question` → 成功结果被标 isError=true

- **位置**:`D:\GitHub\godot-mcp-enhanced\src\core\response-format.ts:111` + `src\core\ToolDispatcher.ts:853-857` + `src\tools\screenshot.ts:294/319/346`
- **问题**:`checkJsonSuccessFalse` 遍历**所有** text block 调 `isErrorText`;`isErrorText` 对非 JSON 文本执行 `/^Error[:\s]/.test(text)`。screenshot `analyze` 把用户 `question` 作为独立 text block 返回。AI 分析错误截图时自然问 "Error: 描述这个对话框" → 该 block 匹配 → 整个成功结果被 middleware 写回 `isError=true`。
- **影响**:MCP 语义损坏——客户端收到 isError:true 但内容是有效图片+问题;AI 困惑或重试浪费 token。本分支 Phase 1 新引入(旧 `checkJsonSuccessFalse` 只认 `{"success":false}` JSON)。
- **修复**:`/^Error[:\s]/` 纯文本前缀检测仅限第一个 text block;或 middleware 路径只用 JSON-based 判定。
- **验证证据**:三处行号均经 Read 核实;`:855 for (const block of result.content) { if (isErrorText(block.text)) return true; }`。

### F-3 [MEDIUM] `runtime_assert scene_structure` 子串匹配节点路径,前缀命名假通过

- **位置**:`D:\GitHub\godot-mcp-enhanced\src\tools\runtime-assert.ts:174`
- **问题**:`treeJson.includes(node.path)` 对整棵场景树 JSON 做子串匹配。期望 `/root/Main/Player` 存在,实际只有 `/root/Main/PlayerHealth` → `includes("/root/Main/Player")` 为 true → **假通过**。`absent:true` 反向中招。
- **影响**:UI/场景回归断言在常见前缀命名(Player/PlayerCamera/PlayerHealth)下静默假绿,agent 误以为功能通过。
- **修复**:`get_tree` 返回值是结构化 `{nodes:[{path,...}]}`,改 `Set<string>` 精确匹配。

### F-4 [MEDIUM] JPEG 在 vision routing 跳过降采样,大图直发 API

- **位置**:`D:\GitHub\godot-mcp-enhanced\src\tools\screenshot.ts:229-236`
- **问题**:PNG 走 `downsampleToThumbnail`(1024px),JPEG 分支 `else { routeBase64 = imageBuffer.toString('base64') }` 直发全量。`downsampleToThumbnail` 内部用 pngjs 仅支持 PNG。10MB JPEG → ~13.3MB base64 直发 groq API,与注释"减少 API 成本"目标矛盾,可能触发 HTTP 413。
- **修复**:引入 jpeg-js 解码,或 JPEG 转 PNG 再降采样,或至少加大小阈值检查。

---

## 三-B、第二轮补充发现(扩展覆盖后新增)

> 第二轮把覆盖从"代表性抽样"扩展到几乎每个工具/子系统。新增 1 CRITICAL + 3 MEDIUM。同时确认 project/delivery/validation/gdscript-lint/game-design(testing 门禁)、全部 builders/UI/recording 的注入防御、tscn/scoring/dashboard/telemetry/game-bridge/advanced-proxy/frame-verify 子系统**均扎实无 ≥75 置信度问题**。

### F-5 [MEDIUM] scene-commit 输入校验缺口:数值字段未运行时校验

- **位置**:`D:\GitHub\godot-mcp-enhanced\src\tools\scene\scene-commit.ts:21-30` + `scene-commit-tool.ts:84`
- **问题**:`validateCommitOperations`(:21-30)**只校验 `op` 字段是已知字符串**,不校验 `coords`/`source_id`/`atlas`/`region` 等数值字段的运行时类型(TS 接口 :32-54 是编译时类型,runtime 被 `as unknown as CommitOperation[]` 强转绕过)。`generateCommitScript` 把 `op.coords.x` 等直接 `${}` 插值进 GDScript(scene-commit.ts:184/198)。
- **后果**:任意字符串内容可注入 GDScript。缓解:生成脚本经 `executeGdscript` → `scanGdscriptSandbox` 二线拦截已知危险模式,但扫描器是"防误用层"且有已知小缺口(`OS.move_to_trash` 等未列)。
- **验证证据**:`switch (action)` 外层 animtree.ts:319;scene-commit.ts:184 `Vector2i(${op.coords.x}, ${op.coords.y})`。

### F-6 [CRITICAL] animtree `animtree_state_edit` action 完全失效(100% 不可用)

- **位置**:`D:\GitHub\godot-mcp-enhanced\src\tools\animtree.ts:395-427`
- **问题**:外层 `switch (action)`(:319)已按 `args.action === 'animtree_state_edit'` 进入 case;内部 :397 又 `const action = args.action as string`(此时必为 `'animtree_state_edit'`)→ :400 `if (action === 'set_position')` 永远 false → :407 `else if (action === 'set_blend')` 永远 false → :423-424 `else` 无条件返回 `INVALID_PARAMS`。schema(:42-89)**无 `sub_action` 字段**,用户无从指定子操作。`genStateSetPosition`/`genStateSetBlend` 是死代码。
- **触发场景**:任何 `animtree(action='animtree_state_edit')` 调用必返回错误,无论传什么参数。
- **测试缺口**:`test/animtree.test.js:146` 只测"rejects missing action"负向用例,handler 本身就无条件报错所以测试恒绿 = 接线零验证。
- **修复**:新增 schema `sub_action`(enum set_position/set_blend),handler 改读 `args.sub_action`;补正向集成测试。
- **验证证据**:`grep -n "switch\s*(" animtree.ts` → `:319 switch (action)`;schema grep 无 `sub_action`。

### F-7 [MEDIUM] material-ops `gdEscape` 对 shader/字符串值中 `%` 误双写

- **位置**:`D:\GitHub\godot-mcp-enhanced\src\tools\material-ops.ts:195/438/532`
- **问题**:这些位置用 `gdEscape` 转义后嵌入 GDScript 双引号字面量。`gdEscape` 把 `%` → `%%`(为其"参与 GDScript % 格式化"设计,见 value-serializer.ts:8/39)。但这些值走 `store_string()`/`JSON.parse_string()`/`mat.set()`,**不参与 % 格式化**,GDScript 双引号字面量也不处理 `%`,故 `%%` 原样保留 → 含 `%` 的值被损坏。
- **修复**:这三处改用已有的 `escapeForGdLiteral`(value-serializer.ts:53,不转义 `%`)。
- **验证证据**:`grep -n "gdEscape\|escapeForGdLiteral\|escapePercent" value-serializer.ts` 确认两者区别(:8-9 注释明确分工)。

### F-8 [MEDIUM] smart-coerce 5/7 长度 hex 颜色静默误转

- **位置**:`D:\GitHub\godot-mcp-enhanced\src\tools\smart-coerce.ts:46` + `:20-29`
- **问题**:`:46` 正则 `/^#[0-9a-fA-F]{3,8}$/` 接受长度 5/7,但合法 hex 颜色只有 3/4/6/8 四种。`hexToNorm`(:20-29)只对长度 3/4 做扩展,长度 5/7 直接 slice 产生**静默错误**颜色。`#12345` → `Color(0.071,0.204,0.02,1)`(无意义);`#1234567` → 第7字符丢弃,返回 `#123456` 的颜色。值流向 `node.set("color",...)` 持久化到 .tscn,难追踪。
- **修复**:正则改显式枚举 `/^#([0-9a-fA-F]{3}|{4}|{6}|{8})$/`;hexToNorm 长度 5/7 加 defensive throw;补 2 条拒绝测试。
- **验证证据**:Read smart-coerce.ts:20-29 确认 slice 逻辑 + :46 正则。

### F-Nit deprecated-properties 注释与数据矛盾

- **位置**:`D:\GitHub\godot-mcp-enhanced\src\tools\deprecated-properties.ts:4-5`
- **问题**:注释称"当前所有条目 removed:false",但数据中有 4 条 `removed: true`(:21/32/33/36)。已被 AGENTS.md 转述,误导维护者对"文件何时可删"的判断。
- **核查命令**:`grep -n "removed: true" src/tools/deprecated-properties.ts`(≥4 命中,证伪注释)。

---

## 四、安全加固缺口

### S-1 [MEDIUM] `bpy-sandbox` 单 env 旁路与 gdscript P0-1 双开关契约不一致

- **位置**:`D:\GitHub\godot-mcp-enhanced\src\core\bpy-sandbox.ts:111-112`
- **问题**:注释自称"对齐 scanGdscriptSandbox 双开关语义",但实际 `:112` 是单 `||`:`DISABLE_SAFETY==='true' || UNRESTRICTED==='true'`。而 `gdscript-executor.ts:424-429/1054-1055` 是真双开关(`UNRESTRICTED && (DISABLE_SAFETY || ALLOW_UNSAFE)`),且 :429 明确"ignored — requires UNRESTRICTED"。
- **后果**:CI/Docker 遗留单个 `GODOT_MCP_DISABLE_SAFETY=true` 时,GDScript 沙箱保持激活,但 bpy 沙箱(全功能 Python RCE)被静默旁路。
- **验证证据**:两处行号 + 条件表达式均经 Read 核实,注释与实现矛盾确凿。

### S-2 [MEDIUM] `bpy-sandbox` 危险 API 清单缺 os.spawn*/os.posix_spawn*

- **位置**:`D:\GitHub\godot-mcp-enhanced\src\core\bpy-sandbox.ts:8-21`
- **问题**:DANGEROUS_BPY_PATTERNS 列了 os.system/os.popen/os.exec*/subprocess,但漏 `os.spawnl/le/lp/lpe/v/ve/vp/vpe` + `os.posix_spawn/posix_spawnp`(Python 3.8+)。gdscript 侧对等把 `OS.execute|create_process` 都拦了。这不是对抗绕过,是清单完整性缺口(扫描器目标是 catch accidental misuse)。
- **修复**:补 `{ pattern: /\bos\.spawn\w*\b/ }`、`/\bos\.posix_spawn\w*\b/`。

### S-3 [MEDIUM] `editor-auth.waitForEditorSecret` 轮询跳过 symlink 复检(TOCTOU)

- **位置**:`D:\GitHub\godot-mcp-enhanced\src\core\editor-auth.ts:133-161`
- **问题**:`permChecked` 一次性门控,symlink 检查只首次执行;此后每轮 `readSecretContent` 不复检。5s 轮询期(~25 次重读)窗口内,`.godot/` 可写者把 key 换 symlink → server 读攻击者已知 secret → 伪造 editor 身份。与同文件 `readEditorSecret:77-87` 的 symlink 拒绝意图矛盾。
- **修复**:每轮读取前 `lstatSync().isSymbolicLink()` 复检。

### S-4 [MEDIUM] `instance_registry.gd` symlink 检查 Windows fail-open + env 竞态

- **位置**:`D:\GitHub\godot-mcp-enhanced\addons\godot_mcp_server\instance_registry.gd:110-120`
- **问题**:(1) PowerShell 不可用/超时时 `return ec == 3` 返 false(fail-open,symlink 防御被绕过);(2) `_MCP_SYMLINK_CHK` 进程级 env,多实例并发时 A/B 互相覆盖路径。
- **修复**:path 通过命令行参数传(非 env)+ 单引号转义;fail-closed(ec 非 0 非 3 视为可疑跳过写)。

### S-5 [MEDIUM] TS 端 instance registry 文件未权限加固

- **位置**:`D:\GitHub\godot-mcp-enhanced\src\core\instance-manager.ts:189-191`
- **问题**:`mkdir`/`writeFile` 默认 mode,Linux umask 022 下得 0755/0644(世界可读)。instance JSON 含 projectPath + pid,多用户机器信息泄露。对比 `instance-api-auth.ts:78`(0o600 + icacls)与 `instance_registry.gd:48-61`(0o700 + icacls)都已加固,TS 端没对齐。
- **修复**:`mkdir(dir, { recursive: true, mode: 0o700 })` + `writeFile(tmpPath, data, { mode: 0o600 })`。

### S-6 [LOW-MEDIUM] `instance-manager` id 拼路径,readRegistryDir 校验不对称

- **位置**:`D:\GitHub\godot-mcp-enhanced\src\core\instance-manager.ts:185-209` + `:50`
- **问题**:`unregisterSelf(id)`/`updateLastSeen(id)` 用 `join(dir, '${id}.json')`,id 来自 public API 签名任意 string。`isInstanceInfo`(:50)只校验 `id.length > 0`,**未做路径段校验**(对比 projectPath:258 有 `seg === '..'`)。攻击者写 evil.json `{id:"../../etc/x"}`,若被传入 unregisterSelf 可删任意 .json。
- **当前可利用性**:低(selfInstanceId 始终来自 buildInstanceInfo 安全生成,无 MCP 工具传外部 id)。但属 API 安全缺口 + 校验不对称。
- **修复**:`isInstanceInfo` 加 `!/.*[\\/]/.test(o.id)`;入口处断言 `/^[a-zA-Z0-9_-]+$/`。

### S-7 [LOW] `instance-http-server` 无并发请求上限

- **位置**:`D:\GitHub\godot-mcp-enhanced\src\core\instance-http-server.ts`
- **问题**:认证在 readBody 前(:167 先 verifyApiToken,:177 才 readBody,顺序正确✓),未认证者无法用大 body 拖垮内存。但已认证(同机拿 secret)者可并发 N×10MB。优先级最低(威胁模型已含同机信任)。
- **修复**(任选):MAX_BODY 降到 1MB;或设 `maxConnections`;或入口并发计数器超阈值返 503。

---

## 五、测试质量缺口(接线零验证 / 弱断言)

| # | 缺口 | 位置 | 风险 |
|---|------|------|------|
| T-1 | JPEG vision routing 路径**零测试**(全用 PNG fixture) | `test/tools/screenshot-vision-route.test.ts` | F-4 漏网根因 |
| T-2 | isError 写回**只有正向用例**,无负向(合法内容不被误标) | `test/core/phase1-iserror-writeback.test.ts` | F-2 漏网根因;删 checkJsonSuccessFalse 遍历逻辑测试仍绿 |
| T-3 | action-gate 完整性依赖人工登记(无回归守护) | `src/core/action-gate.ts` | debug.evaluate 漏配曾发生(2026-08-11 才补);建议加测试:扫描 tool-registry 所有 write/表达式执行 action 断言全在 GATED_ACTIONS |
| T-4 | data-import timeout=0/负数无回归测试 | `test/tools/data-import.test.ts:377-385` | F-1 漏网根因 |
| T-5 | runtime-assert scene_structure 未覆盖前缀命名冲突 | `test/runtime-assert-actions.test.ts:72-91` | F-3 漏网根因 |

> 共同模式:**正向用例覆盖了"该工作的能工作",缺负向用例验证"不该误判的不误判"**。这是当前分支多个 commit "弱断言精确化"工作的延续盲区。

---

## 六、优先修复排序

| 优先级 | Issue | 类型 | 理由 |
|--------|-------|------|------|
| **P0** | **F-6 animtree_state_edit 完全失效** | 功能 CRITICAL | 整个 action 100% 不可用,死代码;新增 sub_action 字段 + 正向测试 |
| **P1** | F-1 data-import timeout=0 | 功能 | 易触发(0 是合法 JSON),一行换 validateTimeout |
| **P1** | F-2 isErrorText 误判 | 功能 | 污染 MCP isError 语义,常见问句触发,本分支新引入 |
| **P2** | F-8 smart-coerce 5/7 hex 误转 | 功能 | 静默数据损坏,持久化到 .tscn;改正则 ~10 行 |
| **P2** | F-7 material-ops %% 双写 | 功能 | shader/材质值含 % 时损坏;换 escapeForGdLiteral |
| **P2** | F-5 scene-commit 数值校验缺口 | 安全 | 纵深防御依赖扫描器;validateCommitOperations 补数值校验 |
| **P2** | F-3 scene_structure 子串匹配 | 功能 | 影响回归断言可信度 |
| **P2** | S-1 bpy env 不一致 | 安全 | 注释与实现矛盾,影响整个 bpy RCE 面 |
| **P2** | S-2 bpy spawn 清单缺口 | 安全 | 清单完整性,与 gdscript 侧对齐 |
| **P3** | F-4 JPEG 跳过降采样 | 功能 | 成本/降级,非阻断 |
| **P3** | S-3 editor-auth symlink TOCTOU | 安全 | 需 `.godot/` 可写前提 |
| **P3** | S-4/S-5/S-6/S-7 多实例加固 | 安全 | 本机单用户场景影响低 |
| **P3** | deprecated-properties 注释纠偏 | 文档 | 1 行注释 |
| **P3** | T-1~T-5 测试补全 | 测试 | 防回归(含 animtree 正向测试) |

---

## 七、值得点赞的工程实践(避免一边倒)

- `data-import.ts` RCE 防御链完整(resolveWithinRoot + gdEscape 闭串 + GD 侧段级 .. 拒 + filename 白名单 + MAX_CSV_BYTES 三重字节守卫)。
- `android.ts` validateSerial/validatePackage 覆盖了竞品易漏的 adb 协议层 `sh -c` 注入。
- `self-update.ts` 显式配 `isReadOnly` 锚点测试防 readonly 模式绕过 update 保护。
- `instance-api-auth.ts` nonce "HMAC 通过后才记录"防污染池设计(A-2)。
- 项目全面诚实标注"防误操作层非不可绕过"的安全边界,文档与代码一致性好。

---

## 八、审查方法与覆盖声明

- **两轮共 8 个独立 code-reviewer 子 agent**(隔离视角,不预设测试通过即正确):
  - 第一轮:安全核心 7 文件、多实例 HTTP 11 文件、新核心逻辑 9 文件、代表性工具 18 文件。
  - 第二轮:运行时模拟工具 12 文件、项目/文件工具 12 文件、构建器/UI/技能/共享 17 文件、子系统(tscn/scoring/dashboard/telemetry/game-bridge/advanced-proxy/frame-verify)全覆盖。
- **主审独立工作**:基线 lint/build/test、全仓库漏洞 grep(eval/exec/spawn/token 比较/JSON.parse/HTTP 绑定/TODO)、路径校验接线跨切面核查(所有 AI 可触发文件写入工具)、debug.evaluate 三层防护核实、GDScript 注入横向扫描(gdEscape 接线完整性)、**所有关键发现(含 CRITICAL animtree、F-5/F-7/F-8)亲自 Read 行号复核**。
- **覆盖度**:经第二轮扩展,`src/tools/` 全部 60+ 工具、`src/core/` 安全关键文件、`src/tscn/`/`src/scoring/`/`src/dashboard/`/`src/telemetry/`/game-bridge/advanced-proxy 均已深审。
- **仍声明未逐行深审**:`src/cli/clients/` 13 客户端适配器(非 AI 请求主路径,用户直接运行 CLI 配置 MCP 客户端)、`src/capability/` 构建脚本、`src/skills/`。这些非运行时攻击面,如需可另起专项。

所有行号、计数、条件表达式均经 `grep -n` / Read / 实跑命令核实,遵守快照护栏。

---

## 九、修复落地记录(2026-08-12 全部完成)

16 项发现全部修复 + 补回归测试。改动 16 源文件 + 11 测试文件(+483/-74)。验证门禁全绿。

| 编号 | 修复 | 文件 | 测试 |
|------|------|------|------|
| F-6 | animtree 新增 sub_action 字段 + handler 改读 args.sub_action | `src/tools/animtree.ts:395` | `test/animtree.test.js`(+4 正向/负向) |
| F-1 | timeout 换 validateTimeout 钳到 [5,300] | `src/tools/data-import.ts:389` | `test/tools/data-import.test.ts`(+2 timeout=0/-10) |
| F-2 | isErrorText 加 checkTextPrefix 选项,checkJsonSuccessFalse 仅首块启用 | `response-format.ts:94`+`ToolDispatcher.ts:853` | `test/core/response-format.test.ts`(+3 单元) |
| F-8 | hex 正则改显式枚举 {3\|4\|6\|8}+ hexToNorm defensive throw | `src/tools/smart-coerce.ts:46` | `test/tools/smart-coerce.test.ts`(+3 拒绝 5/7) |
| F-7 | 4 处 gdEscape→escapeForGdLiteral(不双写 %) | `src/tools/material-ops.ts:195/438/536/547` | `test/material-ops.test.js`(+3 % 保留) |
| F-5 | validateCommitOperations 补运行时数值/向量/字符串校验 | `src/tools/scene/scene-commit.ts:21` | `test/scene-commit.test.ts`(+5 注入拦截) |
| F-3 | scene_structure 改 collectPaths→Set 精确匹配 | `src/tools/runtime-assert.ts:169` | `test/runtime-assert-actions.test.ts`(+2 前缀冲突) |
| F-4 | JPEG 超 1MB fallback 到 detail 分层(不直发超大 base64) | `src/tools/screenshot.ts:233` | `test/tools/screenshot-vision-route.test.ts`(+1 大 JPEG) |
| S-1 | bpy-sandbox 双 opt-in 对齐 gdscript(UNRESTRICTED && DISABLE_SAFETY) | `src/core/bpy-sandbox.ts:112` | `test/core/bpy-sandbox.test.ts`(+2 双开关) |
| S-2 | bpy 清单补 os.spawn*/os.posix_spawn* | `src/core/bpy-sandbox.ts:11` | `test/core/bpy-sandbox.test.ts`(+1 spawn 拦截) |
| S-3 | editor-auth 每轮复检 symlink(移出 permChecked 一次性块) | `src/core/editor-auth.ts:133` | 既有 16 测试覆盖 |
| S-4 | instance_registry.gd 用命令行参数传 path(转义单引号)+ fail-closed | `addons/godot_mcp_server/instance_registry.gd:110` | check:gdscript errors=0 |
| S-5 | TS registry mkdir 0o700 + writeFile 0o600 + Windows icacls owner:F | `src/core/instance-manager.ts:190` | 既有 28 测试覆盖 |
| S-6 | isInstanceInfo 加 id 正则 `/^[A-Za-z0-9_-]+$/`(拒路径分隔符) | `src/core/instance-manager.ts:51` | 既有 28 测试覆盖 |
| S-7 | MAX_BODY 10MB→1MB(降低单请求内存峰值) | `src/core/instance-http-server.ts:227` | 既有 12 测试覆盖 |
| F-Nit | deprecated-properties 注释纠偏(部分 removed:true) | `src/tools/deprecated-properties.ts:4` | grep 核实 |

**验证证据(实跑)**:
- `npm run lint` → EXIT 0(零警告)
- `npm run build` → EXIT 0(tsc strict)
- `npm test` → **5082 passed / 30 skipped**(344 文件),原 5058,+24 新回归测试全过
- `npm run check:gdscript` → errors=0 warnings=0(instance_registry.gd 结构正确)
- `npm run build-matrix` → 40 tools 重建对齐(sub_action 一致)
- `npm run check:contract` → 0 error / `check:tool-count` → 一致 / `check:budget` → 0 error

**诚实边界**:以上修复消除审计发现的全部已识别问题。项目的安全模型仍是"防误操作层非不可绕过"(GDScript 拥有完整系统访问权限,沙箱可被间接绕过)——这是架构性声明,非可修 bug;需真正隔离仍须容器/VM + GODOT_MCP_ALLOW_UNSAFE=false。
