---
date: 2026-07-08
topic: server-instructions
status: draft
related:
  - docs/superpowers/plans/2026-07-08-server-instructions.md
  - 2026-07-07-mcp-roots-dynamic-auth-design.md（同属"协议级细粒度特性"主题）
source: 2026-07-07 三轮调研 P0 候选（官方 MCP servers 借鉴）
---

# Server Instructions 注入设计

## 1. 背景与动机

2026-07-07 三轮调研（官方 MCP servers + sparda + skil-lock）产出 P0 候选「Server Instructions」：

- 官方 `everything` 参考实现在 `McpServer` 构造时传 `instructions` 字段（`D:\GitHub\_research\servers\src\everything\server\index.ts:75`），client 在 MCP `initialize` 响应中收到，注入 LLM 上下文。
- 本项目 `GodotServer.ts:99-102` 用**低层 `Server`**（`@modelcontextprotocol/sdk` `^1.29.0`），构造只传 `{ name, version }` 与 `{ capabilities }`，**未传 `instructions`**。
- SDK 低层 `Server` 同样支持该字段：`server/index.js:50` `this._instructions = options?.instructions`，`:279` initialize 响应里 `...(this._instructions && { instructions: this._instructions })`。

**价值**：陌生 AI client（Claude / Cursor / CodeBuddy / Warp 等）首次会话即获得项目用法速查，减少"探路循环"与致命陷阱踩坑。**零运行时成本**（构造时读一次静态文件）。

## 2. 目标

1. MCP `initialize` 响应携带 `instructions` 字符串字段。
2. 内容为**精简中文速查卡**（~400 字 / ~700 token）。
3. 接入对现有逻辑**零侵入**：构造参数加一个字段 + 一个纯函数 + build 复制 + files 一项。
4. **失败安全退化**：文件缺失/读失败不影响 server 启动，仅退化无注入。

## 3. 非目标（YAGNI，明确不做）

- ❌ 动态 mode / profile / connectionMode 注入 —— per-session 状态交给 `godot_get_context` 运行时查（职责分离）。
- ❌ 双语（`instructions.en.md` 作为后续 follow-up，跟 README/README.en 主+译模式）。
- ❌ 热重载（构造时读一次，与 everything 参考一致）。
- ❌ 按 profile 片段拼接（与现有 capability-matrix / profile 系统重复）。

## 4. 架构

```
src/instructions.md  ──(npm build 复制)──▶  build/instructions.md
                                                        │
                                          readInstructions()  运行时读
                                                        ▼
                          GodotServer.ts:99  new Server({_info}, { capabilities, instructions })
                                                        │
                                          MCP initialize 响应
                                                        ▼
                                          client LLM 上下文
```

**一句话**：构造 `Server` 时把一份静态中文 markdown 作为 `instructions` 字段传入，SDK 在 initialize 响应自动带给 client。

## 5. 组件（4 处改动）

### 5.1 `src/instructions.md`（新建）

精简中文速查卡，结构固定为 5 节：

1. **定位**（1-2 句）：Godot MCP，三层架构（headless + editor + bridge），覆盖场景/脚本/UI/动画/物理/粒子/导航/音频/测试/导出等领域（工具清单见 `manage_tools` / `docs/capability-matrix.md`，随版本演进，不在此写死数字）。
2. **三层模式决策树**（何时用哪个）：
   - 静态读写 `.tscn`/`.gd` → headless（`edit_script` / `write_script` / `batch_*`）
   - 编辑器实时场景 → editor（`launch_editor` + `editor_*`，需插件连接）
   - 运行中游戏 → bridge（`game_query`/`game_input`/`game_write`，需游戏运行 + `game_bridge_install`）
   - 一次性验证 → `run_and_verify` / `verify_delivery` / `validate_scripts`
3. **5 条致命陷阱**（每条一行，含规避动作）：
   - **T1 运行时工具不持久化**：`signal_*` / `particles_*` / `ui_*` / `audio_*` 等 headless 运行时变更在进程退出后丢失。需持久化用 `add_node` + `save_scene` 或 `write_script`。
   - **T2 `edit_script` 优先 `search_and_replace`**：基于内容匹配，对行号偏移鲁棒、CRLF 安全。**勿用 Claude 内置 Edit 编辑 `.gd`**（tab 缩进匹配率极低）。
   - **T3 2D 截图 headless 空白**：headless 不渲染 2D CanvasItem，`screenshot` 返回 `BLANK_DETECTED` 时改用：① Bridge `take_screenshot`（游戏运行中）/ ② `screenshot(action=analyze)` 传外部截图路径 / ③ 手动截图。3D 不受影响。
   - **T4 节点路径须 `/root/` 前缀**：凡带 `path`/`node_path` 参数的 `game_*` 工具（`game_query` / `game_write` / `game_wait` / `game_input` / `click_button` / `monitor` / `watch`）必须以 `/root/` 开头（如 `/root/Main/Player`），不接受 `root/Main/Player`（统一经 `validateBridgePath` 校验）。
   - **T5 Bridge 密钥 5min TTL**：长时间未操作后首次调用可能稍慢；本地测试遇权限循环设 `GODOT_MCP_BRIDGE_PERSISTENT_SECRET=true`（**该 env 由 bridge 游戏进程 `mcp_bridge.gd` 读取、TS server 端不识别——须在启动游戏前设置，经 spawn 透传到游戏子进程，重启游戏才生效**）。
4. **安全模型**（1-2 句）：deny-by-default 路径白名单（`ALLOWED_PROJECT_PATHS`）+ GDScript 沙箱是**防误操作层**，非不可绕过的安全边界；不可信环境用容器/VM。
5. **运行时详情入口**：`manage_tools`（工具组启用/状态）、`godot_get_context`（会话全景：mode/connections/scene/performance）。

**长度约束**：全文 < 2000 字符（测试断言，防漂移膨胀）。

### 5.2 `src/core/instructions.ts`（新建）

纯函数，可独立测试。放 `core/`（与 `logger.ts` / `path-utils.ts` 等基础设施同级），符合"单文件单职责平铺"规则。

```ts
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getLogger } from './logger.js';

/**
 * 读取 server instructions（静态中文速查卡）。
 * 编译后位于 build/instructions.md，core/ → 上一级。
 * 失败时返回 undefined：SDK 在 _instructions falsy 时不带该字段，server 正常启动。
 */
export function readInstructions(): string | undefined {
  const dir = dirname(fileURLToPath(import.meta.url));
  const filePath = join(dir, '..', 'instructions.md');
  try {
    return readFileSync(filePath, 'utf-8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    getLogger().warn('godot-mcp', `instructions.md not loaded: ${msg}`);
    return undefined;
  }
}
```

**与 everything 参考的差异**：参考失败时返回 `"Server instructions not loaded: " + e` 字符串塞给 client —— 会把内部错误信息泄露给 client。本设计改为返回 `undefined`，SDK 不带该字段，更干净。

### 5.3 `GodotServer.ts:99-102`（改 1 处）

```ts
// before
this.server = new Server(
  { name: 'godot-mcp-enhanced', version: pkgVersion },
  { capabilities: { tools: {}, resources: {}, prompts: {} } }
);

// after
this.server = new Server(
  { name: 'godot-mcp-enhanced', version: pkgVersion },
  { capabilities: { tools: {}, resources: {}, prompts: {} }, instructions: readInstructions() }
);
```

顶部加 `import { readInstructions } from './core/instructions.js';`。

`instructions` 为 `string | undefined`，undefined 时 SDK 不带字段，向后兼容。

### 5.4 `package.json`（改 2 处）

**build 脚本**：现有内联 node 脚本只复制 `src/scripts/*.gd`，扩展为也复制 `src/instructions.md` → `build/instructions.md`：

```jsonc
// 在 .gd 复制循环后追加：
fs.copyFileSync(p.join(__dirname, 'src', 'instructions.md'),
                p.join(__dirname, 'build', 'instructions.md'));
console.log('Copied instructions.md');
```

**files 字段**：加一项 `"build/instructions.md"`，确保 npm 发布包含。

```jsonc
"files": [
  "build/**/*.js",
  "build/**/*.d.ts",
  "build/scripts/*.gd",
  "build/instructions.md",   // 新增
  "addons",
  "scripts"
]
```

## 6. 数据流

| 阶段 | 位置 | 动作 |
|------|------|------|
| 源 | `src/instructions.md` | 人工撰写中文速查卡，纳入版本控制 |
| 构建 | `npm run build` | tsc 编译 + 内联脚本复制 `.gd` + 复制 `instructions.md` |
| 产物 | `build/instructions.md` | 随 `build/GodotServer.js` 同级发布 |
| 运行时 | `new GodotServer()` 构造 | `readInstructions()` 读 `build/instructions.md`（`core/` 上一级） |
| 协议 | MCP initialize 响应 | SDK 自动带 `instructions` 字段 |
| 消费 | client LLM 上下文 | 注入速查卡，指导后续工具调用 |

## 7. 错误处理

| 场景 | 行为 |
|------|------|
| 文件存在且可读 | 返回内容字符串 |
| 文件缺失 / 权限不足 / 读异常 | `getLogger().warn(...)` 记一条，返回 `undefined`；SDK 不带 `instructions` 字段；server 正常启动，仅退化无注入 |
| 内容为空字符串 | 同"可读"路径返回 `''`，SDK 视 `_instructions` 为 falsy 不带字段（与 undefined 等效） |

**不抛异常**：instructions 是增强项，缺失不能阻断 server 启动。

## 8. 测试策略

新建 `test/instructions.test.js`（沿用项目 .js 测试惯例）：

1. **正常读取**：`readInstructions()` 返回非空字符串，含关键标记词（`headless` / `editor` / `bridge` / `search_and_replace` / `manage_tools` / `godot_get_context`）。
2. **内容契约**：含 5 条陷阱的关键词标记（T1 运行时/T2 search_and_replace/T3 2D 截图/T4 root 前缀/T5 TTL），防内容漂移丢失陷阱。
3. **长度上限**：`content.length < 2000`，防膨胀（精简速查卡承诺）。
4. **失败兜底**：mock `readFileSync` 抛异常时，函数返回 `undefined` 且不抛（用 `vi.spyOn` 或临时重命名验证；选不依赖真实文件系统 Mock 的方式，避免污染）。
5. **接入断言**：在现有 `test/godot-server.test.js` 的构造测试里追加一条断言——构造后 `(this.server as any)._instructions` 为非空字符串（SDK 内部 private 字段，白盒断言）。**SDK（`@modelcontextprotocol/sdk`）minor/major 升级时需复查此断言**（字段改名/改可见性会假阳性失败；SDK 无公开读 instructions 的 API，故取白盒方案）。**不**做 inspector / Client 端 initialize 端到端测试（太重，性价比低）；集成层由测试 1 + 本断言间接覆盖（readInstructions 返回值即传入 Server 的 instructions）。

**回归**：现有 `test/godot-server.test.js` 不受影响（构造签名仅增字段，未改既有行为）。**本次改动不触及 `test/regression/defects.ts` 的任何 detect 路径**（新代码仅读 `.md` 文件 + 构造参数增字段，不碰 spawn / path 校验 / secret / ClassDB / 脚本校验等 defect 检测面），baseline 计数不变。

## 9. 影响面

- **代码**：4 文件（1 新建 md / 1 新建 ts / 1 改 GodotServer.ts / 1 改 package.json）。
- **运行时行为**：仅在 MCP initialize 响应多一个字段，无其他副作用。
- **依赖**：零新增（`readFileSync` / `fs` / `path` / `url` 均已有）。
- **构建**：build 多复制一个文件，files 多一项。
- **测试**：新增 1 测试文件（~5 用例）。
- **defects**：不触及任何 detect 路径（baseline 计数不变，见 §8 可核实表述）。

## 10. 验收标准

- [ ] MCP initialize 响应携带非空 `instructions` 字段（手动用 `@modelcontextprotocol/inspector` 或测试断言）。
- [ ] `src/instructions.md` 含 5 节结构 + 5 条陷阱，中文，< 2000 字符。
- [ ] `readInstructions()` 文件缺失时返回 undefined，不抛、不阻断启动。
- [ ] `npm run build` 后 `build/instructions.md` 存在。
- [ ] `npm publish --dry-run` 产物含 `build/instructions.md`（files 字段生效）。
- [ ] `tsc` exit 0；`npm test` 全绿（新增 5 用例）；`npm run lint` 0。
- [ ] 现有 `test/godot-server.test.js` 构造测试不受影响。

## 11. 后续 follow-up（不在本 spec 范围）

- `instructions.en.md` 英文版 + 按 client locale 选择（需评估 MCP 协议是否传 locale）。
- 内容随重大版本演进（陷阱清单更新机制）。
