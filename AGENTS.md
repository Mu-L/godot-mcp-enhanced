# godot-mcp-enhanced AGENTS.md

> **适用范围**:本目录及子目录。
> **文件定位**:`godot-mcp-enhanced` 仓库自身的**单一项目配置**(开发本 MCP server 时遵循的规则)。
> **与 CLAUDE.md 的关系**:本文件独立存在,按通用 AGENTS.md 模板 19 维重组;`CLAUDE.md` 面向 Claude Code 客户端,两者可并存,内容互不覆盖。ZCode / Codex / Cursor / Cline 等遵循 AGENTS.md 标准的客户端读本文件。
> **注意区分**:本文件**不是** `setup_project_rules` 工具分发给目标 Godot 项目的 AGENTS.md(那是运行时产物,由 `src/tools/agentsmd-builder.ts` 生成);本文件是开发本仓库时用的规则。

---

## ⚠️ 工具兼容性差异(必读)

不同 agent 工具对 AGENTS.md 的加载行为差异极大(2026-07-22 经 ZCode 官方文档核实):

| 特性 | Claude Code | Cursor / Windsurf | ZCode |
|------|------------|------------------|-------|
| 读 workspace 根 AGENTS.md | ✅ | ✅ | ✅ |
| 读用户全局 `~/.zcode/AGENTS.md` 或 `~/.claude/CLAUDE.md` | ✅ | ✅ | ✅ |
| **展开 `@import` / `@include`** | ✅ | ✅ | ❌ **不支持** |
| **递归扫描子目录 AGENTS.md** | ✅(就近优先) | 部分 | ❌ **不支持** |
| 多层级 AGENTS.md 合并 | ✅ | 部分 | ❌ 只读根 + 用户全局 |

**关键影响**:本文件按"单文件、自包含"设计,所有规则在文件内,不依赖 `@import`。不要写 `@XXX.md` import 语句——在 ZCode 下是死链。

---

## TL;DR 速查表(agent 必读)

| 维度 | 规则 |
|------|------|
| 🌐 语言 | **简体中文回复**(代码/命令/标识符保持英文) |
| 📁 路径 | 文件引用一律绝对路径(如 `D:\GitHub\godot-mcp-enhanced\src\index.ts`) |
| 🛑 红线 | 密钥 / 危险命令 / 禁编辑文件类别 / 完成前必说验证方式(见 Non-Negotiables) |
| ✅ 完成前 | 声明"完成"前**必须说验证方式**(跑了什么命令 / 看了什么输出) |
| 🤔 不确定 | 跨子系统改动 / 删非自己文件 / 外部 API / 连续失败 2 次 → 停下问 |
| 📝 commit | Conventional Commits(`feat:`/`fix:`/`docs:`...) |
| 🔧 技术栈 | TypeScript(ES2022/strict)+ GDScript + MCP SDK + Vitest |
| 🚪 发版门禁 | `npm run build` → `npm test` → `verify_delivery`(MCP 工具)全绿才发版 |

---

## Non-Negotiables(不可妥协红线)

**触发即停**:

### 密钥

- 禁止打印/粘贴 secret(token、API key、cookie、密码)到聊天、commit、日志。
- CI env 变量**只照搬名字不照搬真值**;缺 secret 时停下问用户,不编造占位符。
- 只认 `.env.example`,真凭证永不入库。
- **密钥不入 config**:工具配置文件里**不要 inline 写 API Key**;改用环境变量或独立 secrets 文件(如 `secrets.env` + `.gitignore`),启动时加载。

### 危险命令

执行以下命令前**必须先向用户确认**:

- `rm -rf /`、`rm -rf ~`、`rm -rf /*`、`rm -rf C:/*`(递归删根/家目录)
- `git push --force *`、`git push -f *`(强推覆盖远端)
- `mkfs*`(格式化)、`*dd*of=/dev/*`(块设备覆写)
- `chmod -R 777 /`、`chmod -R 777 /etc*`、`chmod -R 777 /usr*`(系统目录权限放开)

非上述清单的危险操作(删库、删 `node_modules` 之外的大目录、跨盘移动)同样先确认。

### 禁止编辑的文件类别

agent 不得直接编辑(需改时改源文件并说明同步方式):

- **生成目录**:`node_modules/`、`build/`、`dist/`、`.godot/`、`.import/`、`__pycache__/`、`coverage/`、`.ruff_cache/`
- **锁文件**(只让对应包管理器改):`package-lock.json`
- **VCS 元数据**:`.git/`(尤其 `hooks/`、`config`)
- **IDE/工具配置**(除非用户明确要改):`.vscode/`、`.idea/`、`.cursor/`、`.zcode/`。`.claude/rules/godot-mcp-*.md` 进 git 且是**独立副本**(非生成产物),改它时必须同步改 `src/tools/rule-templates.ts`(见「独立副本同步约束」)
- **capability-matrix 生成产物**:`docs/capability-matrix.json`、`docs/capability-matrix.md` 由 `npm run build-matrix` 生成,不手改;改源在 `src/capability/`
- **scoring 构建产物**:`build/scoring/` 由 `src/scoring/` 编译产出,不手改
- 任何带 `DO NOT EDIT` banner 的文件(通常是 codegen / 同步产物)

### 完成前必说验证方式

声明任务"完成"前,**必须明确说出验证方式**(跑了什么命令 / 看了什么输出 / 截图编号)。只说"已完成"不说"怎么验证的",视为未完成。

### 不确定就停

满足任一条件,**停下问用户**而不是继续猜:

- 改动会影响多个子系统(如同时改 `src/tools/` 和 `src/core/` 和 `addons/`)
- 要删除/覆盖非自己创建的文件
- 命令涉及网络下载 / 外部 API / 大额付费操作
- 路径不在 `D:\GitHub\godot-mcp-enhanced` 工作区内
- 同一问题连续尝试 2 次失败(贴已试方法 + 报错,问用户)

---

## 语言

- **必须始终使用简体中文回复**。
- 禁止切换到英文,包括代码注释说明、错误解释、日志说明、commit message 之外的所有自然语言输出。
- 代码、命令、标识符保持原样(英文不翻译)。
- commit message 的 type 前缀必须英文(`feat`/`fix`/`docs`...),subject 可中文。

---

## 行为准则(Karpathy 编程四原则 + 验证优先)

1. **先想后写** — 不确定就问,不瞎猜;发现更简单的方案主动说出来。
2. **简约至上** — 不写没被要求的功能,不为单次使用建抽象层;能 50 行解决别写 200 行。
3. **精确编辑** — 只动被要求的部分,匹配已有风格;不相关问题提一嘴别动手。
4. **目标驱动** — 给验收标准而非步骤:写测试→让它通过;复杂任务列分步计划带验证点。
5. **验证优先** — 写进文档的具体数字/commit SHA/行号,落盘前必须用代码命令(`grep`/`node`/`git show`)亲自验证;不验证就只写方法论 + 核查命令,不写具体数字。

---

## 路径规范

- **所有文档与回复中引用文件,一律使用绝对路径**(如 `D:\GitHub\godot-mcp-enhanced\src\index.ts` 或 `D:/GitHub/godot-mcp-enhanced/package.json`),禁止相对路径。
- 适用范围:代码定位(`绝对路径:行号`)、日志/笔记里的文件清单、提交信息、报告。
- **例外**:
  - 代码内 `import`、`require`、资源路径等代码本身所需的相对路径照常使用。
  - 跨平台仓库内、按惯例必须用相对路径的配置项(如 `tsconfig` paths)保持原样。

---

## 错误处理 / 失败时行为

- 同一问题**连续尝试 2 次失败后停下汇报**:贴出已尝试的方法 + 报错输出,问用户而不是继续试第三种。
- 不要悄悄吞错:命令报错时,把 stderr 完整贴出来,不要只说"失败了"。
- 命令涉及网络下载 / 外部 API / 大额付费操作时,**先确认再执行**。

---

## Commit 规范

### 格式:Conventional Commits

```
<type>(<scope 可选>): <subject>

<body 可选>

<footer 可选>
```

### type 取值

`feat` / `fix` / `docs` / `refactor` / `perf` / `test` / `chore` / `style` / `ci` / `build`

### 规则

- subject 用**祈使句**("add X" 不写 "added X"),不加句号。
- Subject 长度 ≤ 72 字符(英文)或 ≤ 40 汉字。
- type 前缀必须英文,subject 可中文。
- 提交前必跑验证命令(`npm run lint` + `npm test` + `npm run build`),全绿才提交。
- **不替用户提交**除非:(a) 用户明确说"提交吧";或 (b) 项目已有明确约定且非破坏性。
- 默认分支 `master` 上不开新 commit,先开分支。
- PR 标题与 commit subject 同格式;描述里给出**改了什么** / **为什么** / **怎么验证**(贴命令或截图)。

### Git 卫生(不做这些)

- **不 `--no-verify` 跳过 hook**——除非用户明确要跳且知道后果。
- **不 `amend` / `rebase` 已 push 的 commit**——等于改写远端历史。
- **不 force push 到共享分支**(`master`/`develop`/`release/*`)。
- **不在 commit message 里暴露敏感信息**——token、内部 URL 绝不进 commit。
- **不提交大文件**——二进制资源走 Git LFS 或外部存储。

---

## 项目概述

- **项目类型**:开源 MCP server(TypeScript npm 包),为 AI(Claude Code、Cursor、CodeBuddy 等 MCP 客户端)提供操作 Godot 游戏引擎的工具层。
- **License**:MIT
- **版本**:见 `package.json`(`version` 字段,当前 0.23.0,由 `npm run version-sync` 管理)
- **技术栈**:
  - 语言:**TypeScript**(ES2022 / strict / Node16 模块)+ **GDScript**(Godot 4.5–4.7,运行时脚本 + addons)
  - 框架:`@modelcontextprotocol/sdk` ^1.29.0
  - 依赖:`ws` ^8.21.0(WebSocket,editor/bridge 通信)
  - 测试:**Vitest** ^4.1.7 + `@vitest/coverage-v8` + `fast-check`(属性测试)
  - Lint:**ESLint** ^10.4.0 + `typescript-eslint` ^8.60.0
  - 构建:`tsc`(TypeScript 编译)+ 自定义脚本拷贝 `.gd` 文件到 `build/scripts/`
- **仓库结构**:
  - `src/` — TypeScript 源码(server 入口 + 工具实现 + 核心 + GDScript 脚本)
    - `src/index.ts` — MCP server 入口
    - `src/tools/` — MCP 工具实现(每个工具一个 `.ts` 或同名目录)
    - `src/core/` — 核心基础设施(连接管理、调度、安全、参数校验)
    - `src/scripts/` — GDScript 运行时脚本(打包进 build)
    - `src/capability/` — capability-matrix 生成器
    - `src/scoring/` — 评分系统(CLI + 门禁)
    - `src/tscn/` — `.tscn` 场景文件解析/生成
    - `src/dashboard/` — dashboard UI
  - `addons/` — Godot editor 插件(MCP Bridge,分发给目标项目)
  - `scripts/` — 构建/版本/检查脚本(`install-plugin.js`、`version-sync.mjs`、`check-token-budget.mjs` 等)
  - `test/` — Vitest 测试(`.test.ts` / `.test.js`)
  - `docs/` — 文档(capability-matrix、迁移指南、review 报告、plans)
  - `.claude/rules/` — Claude Code 规则文件(进 git 的**独立副本**,与 `src/tools/rule-templates.ts` 同步维护,见「独立副本同步约束」)
  - `build/` — 编译产物(gitignore,不手改)

---

## 开发命令

> 以下命令可直接复制运行(工作目录:`D:\GitHub\godot-mcp-enhanced`):

```bash
# 安装依赖
npm install

# 启动开发(类型检查 watch 模式)
npm run watch

# 构建(tsc + 拷贝 .gd 脚本到 build/scripts/)
npm run build

# Lint(只检查 src/)
npm run lint

# 跑全部测试
npm test

# 测试 watch 模式
npm run test:watch

# 测试覆盖率(阈值:statements 60% / branches 51% / functions 69% / lines 61%)
npm run test:coverage

# 回归测试
npm run test:regression

# 集成测试
npm run test:integration

# E2E 全工具验证(冒烟)
npm run smoke

# capability-matrix 重建(改了工具清单后必跑)
npm run build-matrix

# capability-matrix diff(对比变更)
npm run diff-matrix

# 版本号同步(package.json → manifest.json 等)
npm run version-check

# token 预算检查(工具描述总长度)
npm run check:budget

# MCP inspector(调试 server 协议)
npm run inspector

# scoring 门禁
npm run score:gate
```

### Godot 相关(需 `GODOT_PATH` 环境变量)

```bash
# 设置 Godot 可执行文件路径(示例)
export GODOT_PATH="D:/godot/Godot_v4.7.1-stable_win64.exe"

# 可选:允许操作的项目路径白名单(分号分隔)
export ALLOWED_PROJECT_PATHS="D:/GitHub/godot-mcp-enhanced"
```

---

## 完成前强制检查(MANDATORY)

改动代码后,**报告完成 / 提交 / 开 PR 前**必须依次跑:

1. `npm run lint` — ESLint 风格检查(`src/**/*.ts`)
2. `npm run build` — TypeScript 编译(strict 模式,零错误才过)
3. `npm test` — Vitest 全绿

任一失败:修复后重跑,直到全绿。**不允许跳过**。typing 一直失败时停下问用户。

### 发版前额外门禁

发版(打 tag / 发 release)前,在上述三项基础上额外跑:

4. **`verify_delivery`**(MCP 工具,非 npm script)— 端到端交付门禁:场景树完整性 + 脚本健康 + 性能 + 自定义断言。这是发版的硬性门禁,不通过不发版。

### 改动工具清单后

5. `npm run build-matrix` — 重建 `docs/capability-matrix.{json,md}`(工具清单变更必须同步,否则文档与代码漂移)

### 改动 GDScript 后

6. 编辑 `.gd` 文件后,用 MCP 工具 `validate_scripts` 验证语法(触发 Godot 完整编译,含跨文件依赖,捕获 headless 遗漏的 Parse Error)。

---

## 代码风格

- **TypeScript**:
  - `strict: true` + `noUncheckedIndexedAccess: true`(`tsconfig.json`)— 禁用隐式 any,索引访问返回 `T | undefined`。
  - **禁用 `any`**:`@typescript-eslint/no-explicit-any: error`(CI 强制,零警告)。
  - **未使用变量**:`@typescript-eslint/no-unused-vars: error`,参数前缀 `_` 豁免。
  - `prefer-const: error`。
  - 模块系统:**ESM**(`"type": "module"`),`Node16` 模块解析,import 必须带 `.js` 扩展名。
- **GDScript**:遵循 Godot 官方风格指南(见 `.claude/rules/godot-mcp-engine-quirks.md` 的 GDScript 规范段)。
- **缩进**:TypeScript 2 空格(项目惯例);GDScript 按官方 Tab。
- **文件命名**:`kebab-case.ts`(如 `game-bridge.ts`、`error-analyzer.ts`);工具目录同名(如 `src/tools/animation/`)。
- **工具描述**:MCP 工具的 `description` 字段用**简体中文**(服务中文 Godot 开发者社区)。

---

## 架构约束

### 三层架构(headless + editor + bridge)

server 按场景分工三层,自动检测互不冲突:

| 层 | 连接方式 | 适用场景 | 核心入口 |
|---|---|---|---|
| **Headless CLI** | 独立 Godot 进程 | 文件读写、批量创建、一次性验证(默认) | `src/gdscript-executor.ts` |
| **Editor WebSocket** | 连接运行中的编辑器 | 实时操作当前场景、Undo、场景树同步 | `src/core/EditorConnection.ts` |
| **Game Bridge** | TCP 连接运行中的游戏 | E2E 测试、运行时调试、输入模拟、状态验证 | `src/tools/game-bridge.ts` + `addons/` |

新增工具时必须明确属于哪一层,并在 `src/core/editor-method-map.ts` 登记(editor 层工具需要)。

### 安全体系(核心护城河,改动需谨慎)

本项目以「免费 + 开源 + 系统化安全防护」为差异化定位,**安全相关改动必须同步更新测试 + 文档**:

- **路径白名单**:`ALLOWED_PROJECT_PATHS` deny-by-default,防 junction / 符号链接绕过(`src/core/` 路径解析逻辑)
- **GDScript 注入防御**:危险 API 模式扫描 + 字符串拼接绕过检测
- **危险操作确认令牌**:删节点等操作需显式确认(MCP `elicitInput` out-of-band gate,堵 AI 自读自确认)
- **输出标记防伪造**:每次执行随机标记,防 GDScript 伪造 MCP 输出

诚实边界:以上是**防误操作层**,不是不可绕过的安全边界。GDScript 拥有完整系统访问权限,沙箱可被间接方式绕过。需真正隔离用容器/VM + `GODOT_MCP_ALLOW_UNSAFE=false`。

### src 目录分组规则

| 子系统形态 | 放置规则 |
|-----------|---------|
| 一个工具由 **≥2 个源文件**实现 | 建同名目录(如 `src/tscn/`、`src/tools/scene/`、`src/tools/ui/`、`src/tools/animation/`) |
| **单文件**实现 | 平铺在父目录(如 `src/tools/script.ts`) |

判定依据是"文件数 / 职责可分性",**不是行数**。大文件(如 `script.ts` ~1000 行)只要单文件单职责就不拆。新增工具时:先单文件起步,需要拆分时再升级为目录。

### 分发产物与独立副本边界(改源不改产物)

以下文件是**生成产物**,改动必须改源、跑生成命令,不直接编辑产物:

| 产物 | 源 | 生成命令 |
|------|----|----|
| `docs/capability-matrix.{json,md}` | `src/capability/`(.ts 源) | `npm run build-matrix` |
| `build/` | `src/`(TS 源 + `src/scripts/*.gd`) | `npm run build` |

以下文件是**分发模板源**,由 `setup_project_rules` 工具运行时写入**目标 Godot 项目**(不在本仓库产出文件,是运行时分发):

| 分发模板源 | 写入目标项目 | 生成入口 |
|-----------|-------------|---------|
| `src/tools/rule-templates.ts`(`DETAILED_RULE_TEMPLATES`)+ `src/tools/claudemd-builder.ts`(`GODOT_MCP_RULES`) | 目标项目 `.claude/rules/godot-mcp-*.md` + `godot-mcp.md` | `setup_project_rules` 工具 |
| `src/tools/agentsmd-builder.ts` | 目标项目 `AGENTS.md` | `setup_project_rules` 工具(`agents_md=true`,默认开) |

### 独立副本同步约束(⚠️ 易踩坑)

本仓库 `.claude/rules/godot-mcp-*.md` 与 `src/tools/rule-templates.ts` 是**两份独立副本,不是生成关系**(`rule-templates.ts:4` 注释明确声明)。两者都进 git,**改动规则时必须手动同步两处**:

1. `.claude/rules/` 下的实际文件(本仓库 Claude Code 自用)
2. `src/tools/rule-templates.ts` 的模板内容(分发到目标项目)

CI 脚本 `scripts/check-rules-version-bump.mjs` 会在模板变更时强制要求 `package.json` 版本 bump,但不校验内容一致性——内容同步靠人工。

### 生成代码边界

- `src/scripts/*.gd` 是**打包进 build 的运行时脚本**,改后必须 `npm run build` 同步到 `build/scripts/`。
- `addons/` 是**分发给目标 Godot 项目**的 editor 插件,改动需考虑向后兼容(目标项目 Godot 版本可能不同)。

---

## 测试策略

- **框架**:Vitest(globals 模式)+ `@vitest/coverage-v8` + `fast-check`(属性测试)
- **测试位置**:`test/**/*.test.{js,ts}`,与源文件同名(如 `src/tools/script.ts` ↔ `test/script.test.ts` 或就近目录)
- **覆盖率阈值**(CI 强制,`vitest.config.ts`):
  - statements: 60%
  - branches: 51%
  - functions: 69%
  - lines: 61%
  - 阈值设有 ~4% margin 防止 flaky CI;当覆盖率持续超阈值 >4% 时应上调。
- **覆盖率排除**:`src/**/*.d.ts`、`src/scripts/*.gd`、`src/tools/game-bridge.ts`(Linux CI 跑不了其测试,退本地 Windows 覆盖)
- **测试分类**:
  - 单元测试:`test/*.test.ts`
  - 回归测试:`test/regression/`(`npm run test:regression`)
  - 集成测试:`test/integration/`(`npm run test:integration`)
  - E2E 冒烟:`test/e2e-full-tool-verification.test.ts`(`npm run smoke`)
- **超时**:默认 10000ms(`vitest.config.ts` 的 `testTimeout`)
- **MCP 工具验证**:`verify_delivery` 是端到端交付门禁;`validate_scripts` 触发 Godot 完整编译。
- **TDD 鼓励**:新功能优先写失败测试 → 实现 → 验证通过。

---

## MCP 工具验证规则(项目特有)

本项目自身就是一个 MCP server,开发时频繁用 MCP 工具验证 Godot 侧行为:

- 编辑 `.gd` 文件后,必须运行 `validate_scripts` 验证语法(触发 Godot 完整编译,含跨文件依赖解析,检测 headless 运行可能遗漏的 Parse Error)。
- 使用 `edit_script` 时优先选择 `search_and_replace` 模式(CRLF 安全、行号偏移鲁棒)。
- 发版前必须运行 `verify_delivery`,确保场景树完整性 + 脚本健康 + 性能正常 + 自定义断言通过。
- **AI 开发闭环**:`read_scene` / `read_script` → 理解结构 → `write_script` / `edit_script` → `run_and_verify`(错误分析)→ `validate_scripts` → `verify_delivery`(交付门禁)。`dev_loop` 工具可执行→验证→截图一体化,支持 acceptance 验收标准。
- 详细的 godot-mcp 子系统使用规则(模式选择决策树、引擎陷阱、editor/bridge/ui/recording 模式)见 `.claude/rules/godot-mcp-*.md`(Claude Code 客户端读取);ZCode 等客户端用 `setup_project_rules` 生成的内联版 AGENTS.md。

### MCP 子系统速查

| 子系统 | 入口工具 | 核心能力 | 前提 | rule 文件 |
|--------|---------|---------|------|----------|
| **模式选择** | — | Headless/Editor/Bridge 决策树 | — | core |
| **引擎陷阱** | — | Godot 引擎行为知识(无错误提示的隐蔽陷阱,按工具分组) | — | engine-quirks |
| Editor | `launch_editor` | 实时场景树同步、undo | 编辑器运行中 | editor |
| Bridge | `game_bridge_install` | 查询/输入/写入/等待/监控/信号/UI发现 | 游戏运行中 | bridge |
| UI 布局 | `ui_build_layout` | CSS Flexbox/Grid 翻译 | headless | ui |
| 录制回放 | `recording_start` | 捕获→保存→回放 | Bridge 连接 | recording |
| 粒子 | `particles_create` | GPU 粒子 + 6 种预设(fire/smoke/rain/snow/sparkle/explosion) | headless | core |
| TileMap | `tilemap_read` | 读写/填充/复制/变换 | headless | core |
| 动画 | `animation` | 播放/编辑/AnimationTree | headless | core |
| 导航 | `nav_create_region` | Region/Agent/Link | headless | engine-quirks |
| 材质 | `material_read` | 材质读写/着色器 | headless | engine-quirks |
| 信号 | `signal_connect` | 连接/断开/发射/列出 | headless | core |
| 音频 | `audio_play` | 播放/停止/参数/状态 | headless | core |
| 工作流 | `dev_loop` | 执行→验证→截图一体化 | headless | core |

> 注:particles/tilemap/animation/signal/audio 无专属 rule 文件(运行时工具,见 core.md「运行时 vs 持久化」段;GPU 粒子 headless 不渲染同 2D 截图空白限制);material/navigation 陷阱见 engine-quirks.md;workflow 详见 core.md「dev_loop vs 单独工具」。editor/bridge/ui/recording 有专属 rule。

---

## 变更日志

| 日期 | 变更 |
|------|------|
| 2026-07-22 | 初版,基于通用 AGENTS.md 模板 19 维重组,内容映射自 `CLAUDE.md` + `README.md` + `package.json` + `tsconfig.json` + `eslint.config.js` + `vitest.config.ts` |
| 2026-07-22 | 第一轮审查修正:`.claude/rules/` 与 `rule-templates.ts` 关系从「生成产物」更正为「独立副本同步」(依据 `rule-templates.ts:4` 注释) |
| 2026-07-22 | 第二轮审查修正:补全 MCP 子系统表丢失的 8 行(粒子/TileMap/动画/导航/材质/信号/音频/工作流,含 rule 文件归属);清理第 190 行与「独立副本」声明的措辞矛盾 |
