# Server Instructions 注入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 MCP `initialize` 响应携带一份静态中文速查卡（`instructions` 字段），注入 client LLM 上下文，使陌生 AI client 首次会话即懂三层架构与 5 条致命陷阱。

**Architecture:** 构造低层 `Server` 时把 `src/instructions.md` 内容作为 `instructions` 字段传入；新增纯函数 `readInstructions()` 读文件 + 失败兜底 `undefined`（SDK 自动省略字段，server 正常启动）；build 内联脚本复制 `.md` 到产物，`files` 字段确保发布包含。

**Tech Stack:** TypeScript（`@modelcontextprotocol/sdk` `^1.29.0` 低层 `Server`）/ Node `fs`/`path`/`url` / vitest / npm 内联 build 脚本

**Spec:** `D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-07-08-server-instructions-design.md`（commit `87646be`，已过 reviewer 0C/0I/6A）

## Global Constraints

（每个 task 的需求隐式包含本节）

- **SDK**：`@modelcontextprotocol/sdk` `^1.29.0`，低层 `Server`（`import { Server } from '@modelcontextprotocol/sdk/server.js'`），非高层 `McpServer`
- **内容语言**：简体中文
- **内容长度**：`src/instructions.md` < 2000 字符（测试断言，防漂移膨胀）
- **失败兜底**：`readInstructions()` 读失败返回 `undefined`，**不抛异常、不把错误信息塞给 client**；记一条 warn 日志
- **纯静态**：不动态生成、不双语、不热重载、不按 profile 拼接
- **build 机制**：`tsc` + 内联 node 脚本复制非 `.ts` 资源；tsc 不复制 `.md`
- **不触及** `test/regression/defects.ts` 的任何 detect 路径（新代码仅读 `.md` + 构造参数增字段）
- **测试惯例**：根 `test/` 可用 `.ts`（`args-validator.test.ts` / `cpp.test.ts` 先例）；`GodotServer` 构造测试在 `test/godot-server.test.js`（.js，不用 `as any`）
- **提交惯例**：master 直接提交（用户惯例，不建分支、不 push）；commit message 中文，无 Co-Authored-By 尾巴

## File Structure

| 文件 | 动作 | 职责 |
|------|------|------|
| `src/instructions.md` | 新建 | 中文速查卡内容资产（5 节 + 5 陷阱） |
| `src/core/instructions.ts` | 新建 | `readInstructions(filePath?)` 纯函数：读 md + 兜底 undefined |
| `test/instructions.test.ts` | 新建 | 内容契约测试 + readInstructions 单元测试 |
| `src/GodotServer.ts` | 改 :99 | `new Server` 第二参数加 `instructions: readInstructions()` |
| `test/godot-server.test.js` | 改 constructor 块 | 追加接入断言（`_instructions` 非空） |
| `package.json` | 改 :31 build + :20 files | build 加复制 instructions.md；files 加 `build/instructions.md` |

---

## Task 1: 内容资产 `src/instructions.md` + 内容契约测试

**Files:**
- Create: `src/instructions.md`
- Create: `test/instructions.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `src/instructions.md` 文件（Task 2 的 `readInstructions` 读它；Task 4 build 复制它）

- [ ] **Step 1: 写 `src/instructions.md`（完整内容如下）**

```markdown
# Godot MCP Enhanced 使用速查

三层架构（headless + editor + bridge），覆盖场景/脚本/UI/动画/物理/粒子/导航/音频/测试/导出等领域。工具清单见 `manage_tools` / `docs/capability-matrix.md`。

## 三层模式决策

- **静态读写 .tscn/.gd** → headless：`edit_script`（优先 `search_and_replace`）/ `write_script` / `batch_*`
- **编辑器实时场景** → editor：`launch_editor` + `editor_*`（需插件连接）
- **运行中游戏** → bridge：`game_query` / `game_input` / `game_write`（需 `game_bridge_install` + 游戏运行）
- **一次性验证** → `run_and_verify` / `verify_delivery` / `validate_scripts`

## 五大致命陷阱

1. **运行时工具不持久化**：`signal_*` / `particles_*` / `ui_*` / `audio_*` 等 headless 运行时变更在进程退出后丢失；需持久化用 `add_node` + `save_scene` 或 `write_script`。
2. **edit_script 优先 search_and_replace**：基于内容匹配，对行号偏移鲁棒、CRLF 安全；勿用 Claude 内置 Edit 编辑 .gd（tab 缩进匹配率极低）。
3. **2D 截图 headless 空白**：headless 不渲染 2D CanvasItem，`screenshot` 返回 `BLANK_DETECTED` 时改用：① Bridge `take_screenshot`（游戏运行中）/ ② `screenshot(action=analyze)` 传外部截图 / ③ 手动截图。3D 不受影响。
4. **节点路径须 /root/ 前缀**：凡带 path/node_path 的 game_* 工具（game_query / game_write / game_wait / game_input / click_button / monitor / watch）必须 `/root/` 开头（如 `/root/Main/Player`）。
5. **Bridge 密钥 5min TTL**：长时间未操作后首次调用可能稍慢；权限循环设 `GODOT_MCP_BRIDGE_PERSISTENT_SECRET=true`（由 bridge 游戏进程读取，须启动游戏前设置、重启生效）。

## 安全模型

deny-by-default 路径白名单（`ALLOWED_PROJECT_PATHS`）+ GDScript 沙箱是**防误操作层**，非不可绕过的安全边界；不可信环境用容器/VM。

## 运行时详情

`manage_tools`（工具组启用/状态）· `godot_get_context`（会话全景：mode/connections/scene/performance）
```

- [ ] **Step 2: 写内容契约测试 `test/instructions.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('instructions.md 内容契约', () => {
  const content = readFileSync(join(process.cwd(), 'src', 'instructions.md'), 'utf-8');

  it('含三层模式标记', () => {
    expect(content).toMatch(/headless/);
    expect(content).toMatch(/editor/);
    expect(content).toMatch(/bridge/);
  });

  it('含 5 条陷阱关键词', () => {
    expect(content).toMatch(/持久化/);              // T1 运行时
    expect(content).toMatch(/search_and_replace/);  // T2
    expect(content).toMatch(/BLANK_DETECTED/);      // T3
    expect(content).toMatch(/\/root\//);            // T4
    expect(content).toMatch(/PERSISTENT_SECRET/);   // T5
  });

  it('指向 manage_tools / godot_get_context', () => {
    expect(content).toMatch(/manage_tools/);
    expect(content).toMatch(/godot_get_context/);
  });

  it('长度 < 2000 字符（精简速查卡防膨胀）', () => {
    expect(content.length).toBeLessThan(2000);
  });
});
```

- [ ] **Step 3: 运行测试，确认通过**

Run: `npx vitest run test/instructions.test.ts`
Expected: PASS（4 用例全绿）

- [ ] **Step 4: 提交**

```bash
git add src/instructions.md test/instructions.test.ts
git commit -m "feat(instructions): 新增中文速查卡内容资产 + 内容契约测试"
```

---

## Task 2: `src/core/instructions.ts` 纯函数 + 单元测试

**Files:**
- Create: `src/core/instructions.ts`
- Modify: `test/instructions.test.ts`（追加 readInstructions 测试块）

**Interfaces:**
- Consumes: `src/instructions.md`（Task 1 产物）；`src/core/logger.ts` 的 `getLogger()`
- Produces: `readInstructions(filePath?: string): string | undefined`（Task 3 的 GodotServer 调用它）

**签名说明**：`filePath` 可选参数省略时计算默认路径（`core/` 上一级的 `instructions.md`）；测试传入不存在路径以验证兜底，避免 `vi.spyOn(fs)` 的 ESM/Linux mock 坑。

- [ ] **Step 1: 在 `test/instructions.test.ts` 追加 readInstructions 测试（先写失败测试）**

在文件末尾追加：

```ts
import { readInstructions } from '../src/core/instructions.js';

describe('readInstructions', () => {
  it('默认路径返回非空字符串且含 headless 标记', () => {
    const result = readInstructions();
    expect(typeof result).toBe('string');
    expect(result).toMatch(/headless/);
  });

  it('默认路径返回值与 src/instructions.md 一致', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const direct = readFileSync(join(process.cwd(), 'src', 'instructions.md'), 'utf-8');
    expect(readInstructions()).toBe(direct);
  });

  it('filePath 指向不存在路径时返回 undefined 且不抛', () => {
    const result = readInstructions('/nonexistent/path/does-not-exist.md');
    expect(result).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run test/instructions.test.ts`
Expected: FAIL（`Cannot find module '../src/core/instructions.js'`）

- [ ] **Step 3: 写 `src/core/instructions.ts` 实现**

```ts
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getLogger } from './logger.js';

/**
 * 读取 server instructions（静态中文速查卡）。
 *
 * 编译后位于 build/instructions.md；instructions.ts 在 build/core/，故默认路径上溯一级。
 * filePath 可选：省略走默认路径，传入则读指定路径（测试注入用）。
 *
 * 失败时返回 undefined：SDK 内部 `this._instructions && {instructions:...}` 对 falsy 不带字段，
 * 故 server 正常启动、仅退化无注入；不把错误字符串塞给 client（避免内部信息泄露）。
 */
export function readInstructions(filePath?: string): string | undefined {
  const dir = dirname(fileURLToPath(import.meta.url));
  const resolved = filePath ?? join(dir, '..', 'instructions.md');
  try {
    return readFileSync(resolved, 'utf-8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    getLogger().warn('godot-mcp', `instructions.md not loaded: ${msg}`);
    return undefined;
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run test/instructions.test.ts`
Expected: PASS（内容契约 4 + readInstructions 3 = 7 用例全绿）

- [ ] **Step 5: tsc 类型检查**

Run: `npx tsc --noEmit`
Expected: exit 0（无类型错误）

- [ ] **Step 6: 提交**

```bash
git add src/core/instructions.ts test/instructions.test.ts
git commit -m "feat(instructions): readInstructions 纯函数 + 兜底 undefined + 单元测试"
```

---

## Task 3: `GodotServer.ts` 接入 + 构造测试断言

**Files:**
- Modify: `src/GodotServer.ts`（:99-102 构造块 + 顶部 import）
- Modify: `test/godot-server.test.js`（constructor describe 块追加 it）

**Interfaces:**
- Consumes: `readInstructions`（Task 2 产物）
- Produces: GodotServer 构造的 Server 实例携带 `_instructions`（Task 5 集成验证 + 真实 client initialize 响应）

- [ ] **Step 1: 在 `test/godot-server.test.js` 的 `describe('constructor', ...)` 块内追加接入断言（先写失败测试）**

在 `test/godot-server.test.js:130-161` 的 `describe('constructor', () => { ... })` 块内、最后一个 `it` 之后追加：

```js
    it('injects instructions into the MCP Server on construction', () => {
      const server = new GodotServer('/fake/ops.gd');
      // SDK private 字段 _instructions：GodotServer 构造时经 readInstructions() 注入
      // 升级 @modelcontextprotocol/sdk 时需复查此断言（字段改名/改可见性会假阳性失败）
      expect(server.server._instructions).toBeTruthy();
      expect(typeof server.server._instructions).toBe('string');
      expect(server.server._instructions).toMatch(/headless/);
    });
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run test/godot-server.test.js -t "injects instructions"`
Expected: FAIL（`_instructions` 为 undefined —— GodotServer 尚未传 instructions）

- [ ] **Step 3: 改 `src/GodotServer.ts`**

3a. 顶部 import 区（现有 import 块附近）追加：

```ts
import { readInstructions } from './core/instructions.js';
```

3b. `:99-102` 构造块改为：

```ts
    this.server = new Server(
      { name: 'godot-mcp-enhanced', version: pkgVersion },
      {
        capabilities: { tools: {}, resources: {}, prompts: {} },
        instructions: readInstructions(),
      }
    );
```

- [ ] **Step 4: 运行接入测试，确认通过**

Run: `npx vitest run test/godot-server.test.js -t "injects instructions"`
Expected: PASS

- [ ] **Step 5: 运行 godot-server 全量测试，确认无回归**

Run: `npx vitest run test/godot-server.test.js`
Expected: PASS（所有现有用例 + 新增 1 用例）

- [ ] **Step 6: tsc 类型检查**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 7: 提交**

```bash
git add src/GodotServer.ts test/godot-server.test.js
git commit -m "feat(godot-server): 构造 Server 注入 instructions + 接入断言"
```

---

## Task 4: `package.json` build 复制 + files 字段

**Files:**
- Modify: `package.json`（:31 build 脚本 + :20-26 files 字段）

**Interfaces:**
- Consumes: `src/instructions.md`（Task 1 产物）
- Produces: `build/instructions.md`（运行时 readInstructions 读它）；npm 发布产物含该文件

- [ ] **Step 1: 改 `package.json` build 脚本**

`:31` 现有 build 内联脚本（复制 `src/scripts/*.gd` 后）追加复制 `instructions.md`。改为：

```jsonc
"build": "tsc && node -e \"const fs=require('fs'),p=require('path');const src=p.join(__dirname,'src','scripts');const dst=p.join(__dirname,'build','scripts');fs.mkdirSync(dst,{recursive:true});fs.readdirSync(src).filter(f=>f.endsWith('.gd')).forEach(f=>{fs.copyFileSync(p.join(src,f),p.join(dst,f));console.log('Copied',f)});fs.copyFileSync(p.join(__dirname,'src','instructions.md'),p.join(__dirname,'build','instructions.md'));console.log('Copied instructions.md')\"",
```

（在原 `.gd` 复制 forEach 之后、`\"` 闭合前，追加 `fs.copyFileSync(...src/instructions.md, ...build/instructions.md)` + console.log）

- [ ] **Step 2: 改 `package.json` files 字段**

`:20-26` files 数组加一项 `"build/instructions.md"`：

```jsonc
"files": [
  "build/**/*.js",
  "build/**/*.d.ts",
  "build/scripts/*.gd",
  "build/instructions.md",
  "addons",
  "scripts"
]
```

- [ ] **Step 3: 运行 build，确认产物含 instructions.md**

Run: `npm run build`
Expected: 输出含 `Copied instructions.md`；`build/instructions.md` 文件存在

验证：`ls build/instructions.md`（应存在）

- [ ] **Step 4: 验证 npm 发布产物含该文件**

Run: `npm pack --dry-run 2>&1 | grep instructions`
Expected: 输出含 `build/instructions.md`

- [ ] **Step 5: 验证运行时路径解析（build 产物侧）**

Run: `node -e "import('./build/core/instructions.js').then(m => console.log('loaded:', typeof m.readInstructions(), (m.readInstructions()||'').slice(0,30)))"`
Expected: `loaded: string # Godot MCP Enhanced 使用速查`（前 30 字符）

- [ ] **Step 6: 提交**

```bash
git add package.json
git commit -m "build: build 复制 instructions.md + files 字段纳入发布产物"
```

---

## Task 5: 全量门禁 + 手动验证

**Files:** 无新增（仅验证）

- [ ] **Step 1: 全量测试**

Run: `npm test`
Expected: 全绿（新增 7 用例：instructions.test.ts 4 内容契约 + 3 readInstructions；godot-server.test.js +1 接入断言）。defects baseline 计数不变。

- [ ] **Step 2: tsc + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: tsc exit 0；lint 0 错误

- [ ] **Step 3: 完整 build**

Run: `npm run build`
Expected: exit 0；`build/instructions.md` 存在

- [ ] **Step 4: 手动验证 MCP initialize 响应（spec 验收）**

Run: `npm run inspector`（启动 `@modelcontextprotocol/inspector`），在浏览器 inspector 里发 initialize 请求，检查响应 `result.instructions` 字段为非空中文速查卡字符串。

Expected: 响应含 `instructions` 字段，内容为 `src/instructions.md` 全文。

> 若 inspector 在当前环境不可用，跳过此步（集成层已由 Task 3 白盒断言 + Task 4 Step 5 运行时路径解析覆盖）；记录"inspector 手动验证待用户确认"。

- [ ] **Step 5: 若 Step 1-3 全绿且 Step 4 验证通过/跳过，无需额外 commit**

（本 task 无代码改动；仅当修复发现的问题时才 commit）

---

## Self-Review

**1. Spec coverage（逐节核对）：**
- §2 目标（initialize 带 instructions / 精简中文 / 零侵入 / 失败退化）→ Task 1-4 全覆盖 ✅
- §3 非目标（YAGNI 4 条）→ plan 全程未引入动态/双语/热重载/拼接 ✅
- §5.1 instructions.md 内容（5 节 + 5 陷阱 + < 2000 字符）→ Task 1 Step 1 完整内容 + Step 2 长度断言 ✅
- §5.2 readInstructions 纯函数 + 兜底 undefined → Task 2（签名加 `filePath?` 可选参数用于测试注入，spec 精神不变）✅
- §5.3 GodotServer.ts:99 接入 → Task 3 ✅
- §5.4 package.json build + files → Task 4 ✅
- §7 错误处理（可读/异常/空串）→ Task 2 测试 3（异常兜底）；空串路径由 SDK `&&` 短路保证（spec §7 已述，无需单独测）✅
- §8 测试策略（5 用例）→ Task 1 内容契约 4 + Task 2 readInstructions 3 + Task 3 接入 1 = 8 用例（覆盖 spec 的 5 类）✅
- §10 验收（initialize 带 instructions / 内容契约 / 兜底 / build 产物 / publish dry-run / tsc+test+lint / 现有测试不回归）→ Task 1-5 全覆盖 ✅
- §review 6 ADVISORY → 全部落地：A1 baseline 可核实（Global Constraints）、A2 T5 env 作用方（Task 1 md 内容）、A3 T4 泛化（md 内容）、A4 T3 三出口（md 内容）、A5 弱化数字（md 内容）、A6 SDK 升级复查（Task 3 测试注释）✅

**2. Placeholder scan：** 无 TBD/TODO；每步含真实代码或真实命令；instructions.md 是完整内容非占位 ✅

**3. Type consistency：**
- `readInstructions(filePath?: string): string | undefined` —— Task 2 定义、Task 3 调用 `readInstructions()`（无参）、Task 4 Step 5 调 `m.readInstructions()` ✅ 一致
- `server.server._instructions` —— Task 3 测试断言（.js 文件直接访问，TS private 运行时可见）✅
- GodotServer 构造签名 `(scriptPath, options?)` —— Task 3 测试 `new GodotServer('/fake/ops.gd')` 与现有 `:132` 一致 ✅

无问题，plan 可执行。
