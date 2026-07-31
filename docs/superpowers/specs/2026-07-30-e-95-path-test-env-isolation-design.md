# E-95 路径测试 env 隔离四件套（报告4 :95）

> 继承总 spec `docs/superpowers/specs/2026-07-29-审查修复批次设计.md` batch E :95。报告4 :95（P1 路径测试 env 隔离四件套）独立子批。同 batch 已闭环：:93/:94/:96/:97a（E-P1）/ :98（E-P2）。

## Goal

提取路径安全测试的 env 隔离四件套（清 UNRESTRICTED + 控 ALLOWED_PROJECT_PATHS + chdir + `_resetPathAllowWarned` + deny 断言）为统一 helper，重构现有典范测试文件改用 helper，降低新测试手写隔离的出错成本，防 screenshot-leak 类假绿（deny-by-default 分支因全局 UNRESTRICTED=true 永不触发）复发。**不做检测器**（边界天然复杂，YAGNI，见 brainstorming 核实段）。

## 背景：deny-by-default 机制（path-utils.ts:258-306 实测）

`isPathInAllowedRoots` 三级优先级：① `GODOT_MCP_UNRESTRICTED=true` → allow all（短路，:259）；② `ALLOWED_PROJECT_PATHS` → allow listed（:294）；③ 无配置 → restrict to cwd（:280）。`test/setup.js:6` 全局设 `UNRESTRICTED=true` → 短路返 true → :280 deny 分支永不触发 = 假绿根源。

## brainstorming 核实（驱动设计，含两轮外部审阅独立核实）

### 现状（grep 实测，不照 07-29 待办旧判断）

- 核心路径测试**已隔离**（07-29 "多数假绿"判断已过时，后续会话补过）：path-utils-roots/helpers.test.js/security-paths/addon-version/screenshot-leak 均有 beforeEach 清 UNRESTRICTED + deny 断言。
- **但"已扎实隔离"对部分文件偏乐观**（spec 审阅一轮偏差1 核实）：`path-utils-roots`、`path-security` 的 `_resetPathAllowWarned` 调用计数 = **0**（对比 helpers/security-paths/addon/screenshot 的 4-7 次），warn 去重缓存可能跨用例污染。helper 重构后统一补 reset。
- **真实痛点 = 隔离手法碎片化**：5+ 文件各自实现（`vi.stubEnv` / `process.env` save-restore / `delete` 混用），`_resetPathAllowWarned` 手动各处调。新测试易遗漏 → screenshot-leak 复发模式。

### 路径校验函数边界（源码核实，澄清 ZCode 评审）

- **真正做 allow/deny 判定**：`isPathInAllowedRoots`（path-utils.ts:258）、`resolveWithinRoot`（:154）
- **不做校验**：`resolvePath`（:37 注释明说 "Does NOT validate security"）、`validatePath`（:43 = `resolvePath` 别名，名误导）
- **内嵌校验的高层入口**：`requireProjectPath`（helpers.ts:110 调 isPathInAllowedRoots）、`readAddonVersion`/`updateAddon`（addon-version.ts:16/32 直接调 isPathInAllowedRoots）

### ZCode 评审（设计阶段，receiving-code-review）

- ✅ **函数名锚点漏判指控成立**：addon-version.test.ts:71/99/147 通过 `readAddonVersion` 测 throw deny，原"直接调 isPathInAllowedRoots"锚点抓不到它
- ❌ **"锚点扩到 requireProjectPath/resolvePath"修正被反驳**：`resolvePath` 不做校验（误伤功能测试）；`requireProjectPath` 不覆盖 `readAddonVersion`；**入口是开放集合，枚举函数名永远漏**
- **独立修正**：语义锚点（"断言路径拒绝"= toThrow 路径拒绝词 ∪ 直接断言 isPathInAllowedRoots 返值）能抓全，但规则需 4 层（deny 断言 + 排除 `disallowed` + 返值断言 + mock 排除 + `.test.` 限定）
- **结论**：:95 的"路径测试该不该隔离"边界天然模糊（对比 E-P2 三检测器清晰边界），检测器规则复杂 → 自身可信度存疑 → **YAGNI 放弃检测器**，用户确认选纯 helper

### Spec 审阅一轮（receiving-code-review，已据此修正本 spec）

- **偏差2 采纳**：`path-security.test.ts` 从重构集移除。实测该文件混两套路径系统——`sanitizePath` describe（11 用例）操作 `GODOT_MCP_ALLOWED_ROOTS`（仅 `path-security.ts:46` 读取，`getAllowedProjectPaths` 完全不读），与 helper（操作 `ALLOWED_PROJECT_PATHS`）无关；G2 describe 仅 1 用例且已 try/finally 正确，ROI 低。重构集 6→5 文件。
- **偏差1 采纳**：见现状段 reset 缺失补充。
- **设计隐患采纳**：helper 模块级 `_stash` 单例在多 describe 嵌套下 cwd 竞态 → 改 `isolatePathEnv` 闭包内 `origCwd` 局部变量，消除共享状态。

## 设计

### helper（`test/helpers/path-isolation.ts`，新建）

对齐 `test/helpers/` 现有 `fixtures.js` / `tool-context.js` 结构。三件套 + 内部注册 afterEach 自动恢复（零冗余，调用即注册 teardown）；cwd 用闭包捕获（非模块级单例，多 describe 嵌套安全）：

```ts
import { afterEach } from 'vitest';
import { _resetPathAllowWarned } from '../../src/core/path-utils.js';

/** 姿态A 隔离（deny-by-default）：清 UNRESTRICTED + 可选 ALLOWED + 可选 chdir + reset。
 *  约定在 beforeEach 内调用（vitest afterEach 注册依赖活跃 test scope）。
 *  内部注册 afterEach 自动恢复（unstubAllEnvs + chdir 回 origCwd + 删 ALLOWED + reset）。 */
export function isolatePathEnv(opts: { allowed?: string[]; cwd?: string } = {}) {
  vi.stubEnv('GODOT_MCP_UNRESTRICTED', '');
  const origCwd = opts.cwd ? process.cwd() : undefined;   // 闭包捕获，消除模块级共享状态竞态
  if (opts.allowed !== undefined) {
    if (opts.allowed.length) process.env.ALLOWED_PROJECT_PATHS = opts.allowed.join(';');
    else delete process.env.ALLOWED_PROJECT_PATHS;
  }
  if (opts.cwd) process.chdir(opts.cwd);
  _resetPathAllowWarned();
  afterEach(() => {
    vi.unstubAllEnvs();
    if (origCwd !== undefined) process.chdir(origCwd);
    delete process.env.ALLOWED_PROJECT_PATHS;
    _resetPathAllowWarned();
  });
}

/** 姿态B 刻意 unrestricted：测 bypass 行为（如 path-utils-roots 测 allow-all）。约定在 beforeEach 调用。 */
export function asUnrestrictedPath() {
  vi.stubEnv('GODOT_MCP_UNRESTRICTED', 'true');
  _resetPathAllowWarned();
  afterEach(() => { vi.unstubAllEnvs(); _resetPathAllowWarned(); });
}

/** deny 断言：防 includes 恒真 / length>0 假绿，必须匹配路径拒绝错误（中英文 + PATH_NOT_ALLOWED）。 */
export function expectPathDenied(fn: () => unknown) {
  expect(fn).toThrow(/PATH_NOT_ALLOWED|ALLOWED_PROJECT_PATHS|outside allowed|escapes allowed|不在.*ALLOWED|越界/i);
}
```

**实现不确定性（plan TDD 确认）**：
- `vi` 全局：`vitest.config.ts:6 globals: true` 已确认，`vi` 全局可用，helper 不需显式 `import { vi }`（是否加 import 跟随项目多数风格 / ESLint `no-undef` 配置，plan 定）。
- **afterEach 注册 scope**：vitest `afterEach` 在普通函数内调用依赖活跃 test scope——约定 `isolatePathEnv`/`asUnrestrictedPath` 在 `beforeEach` 内调。若 TDD 暴露 scope 限制，fallback 改为返回 `restore()` 函数由调用方在 afterEach 显式调（更显式但要求调用方手写一行）。**不预设，TDD 决定**。
- **env stub 嵌套交互**：`vi.unstubAllEnvs()` 恢复所有 stubEnv——若未来出现嵌套 describe 各自 isolatePathEnv，内层 afterEach 的 unstubAllEnvs 会清外层 stub。当前目标文件 helpers.test.js 8 个 describe 全平级（grep 确认无嵌套）不触发；plan TDD 验证，若需可改 per-call 精细恢复。

### 重构（5 典范文件改用 helper，行为不变只换手法）

| 文件 | 现状手法（实测） | 改用 |
|---|---|---|
| `test/core/path-utils-roots.test.ts` | process.env save/delete + restore（多 describe，含测 allow-all）；**缺 `_resetPathAllowWarned`** | `isolatePathEnv` / `asUnrestrictedPath`（补 reset） |
| `test/helpers.test.js` | process.env delete/set + `_resetPathAllowWarned` 手动（8 平级 describe） | `isolatePathEnv` / `asUnrestrictedPath` |
| `test/security-paths.test.js` | process.env save/delete + afterEach restore | `isolatePathEnv` + `expectPathDenied` |
| `test/addon-version.test.ts` | process.env save/restore + vi.stubEnv 混用（含测 bypass 的 beforeEach=true） | `isolatePathEnv` / `asUnrestrictedPath` + `expectPathDenied` |
| `test/screenshot-analyze-path-leak.test.ts` | vi.stubEnv + 手动 afterEach | `isolatePathEnv` + `expectPathDenied` |

**移除（spec 审阅偏差2）**：`test/core/path-security.test.ts` 不进重构集——`sanitizePath` describe（11 用例）操作 `GODOT_MCP_ALLOWED_ROOTS`（path-security.ts:46 专用，与 helper 操作的 `ALLOWED_PROJECT_PATHS` 是两套无关系统），G2 describe（1 用例）已 try/finally 正确、ROI 低。

**原则**：纯手法替换，测试用例/断言/覆盖不变。重构前后该文件测试计数 + 全量 vitest 必须一致绿。

## 集成

- **不改** package.json / ci.yml（无门禁脚本变更，纯测试内部重构）。
- helper 放 `test/helpers/`（git 跟踪，随测试分发）。

## Global Constraints（继承总 spec）

- 工作仓库 `D:\GitHub\godot-mcp-enhanced`；master 本地 commit 不 push。
- helper 语言：`test/helpers/` 现有 `.js`（fixtures/tool-context），但新增用 `.ts` 对齐多数 `test/*.test.ts`——plan 核实 vitest 对 `test/helpers/*.ts` 的编译处理（tsconfig include / vitest server.deps）。
- TDD：重构行为不变——先跑 5 文件测试绿（基线计数）→ 换 helper → 仍绿（计数一致）→ 全量 vitest 绿。
- 核实驱动：deny 机制 / 校验函数边界 / 重构集全实测（[[plan-baseline-verify-grep]][[verify-implementation-by-source]]）。

## Defer 清单

- **检测器**（语义锚点 4 层规则复杂，:95 边界天然模糊；未来真有 screenshot-leak 复发，基于真实模式设计更准）
- 集成层（handleTool 真实路径链）假绿排查（纯 helper 不强制集成层，未来按需）
- :97b 23 vi.mock 补 failure 变体 / :99 弱断言精确化 / :100 mutation testing（报告4 其他 defer 项）

## 验收

- helper 三件套实现（`test/helpers/path-isolation.ts`）+ 5 典范文件重构改用
- 全量 vitest 绿（行为不变）+ tsc 0 / eslint 0
- 重构前后 5 文件测试计数一致（无丢失/行为变化）
- final review opus（整支）
- 项目待办.md 报告4 :95 回标
- master 本地不 push

## Self-Review

- **Spec 覆盖**：helper API（三姿态）+ 5 文件重构逐表 + 不做检测器理由全设计；两轮审阅反馈处置明列；defer 项明列。无遗漏。
- **占位符**：helper 有精确实现（origCwd 闭包 + afterEach 注册 + 三函数）；重构有逐文件现状→目标表。无 TBD（helper `.ts`/`.js` + afterEach scope 标注为 plan TDD 核实，属实现细节非设计占位）。
- **一致性**：deny 机制（三级优先级）与 helper 设计（清 UNRESTRICTED 触发 :280 deny 分支）一致；ZCode 核实段（函数名锚点漏判 + 语义锚点 4 层复杂）与"放弃检测器 YAGNI"结论一致；偏差2（path-security 两套系统）与重构集移除一致。
- **范围**：单一 helper + 5 文件重构，一个 plan 可覆盖。检测器/集成层 defer 明列。
- **边界**：明确不做检测器（YAGNI + 边界天然模糊）+ 不碰集成层 + path-security 不进重构集（两套无关系统），避免 scope 蔓延。
