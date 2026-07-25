---
date: 2026-07-25
project: godot-mcp-enhanced
topic: self-update 机制（Godot AI 追赶子项目 3/3）
status: spec（待 writing-plans）
systems:
  - "[[M2-defect-regression]]"
  - "[[ROADMAP]]"
---

# self-update 机制设计

> brainstorming 产物（2026-07-25）。4 节设计全部经实仓行号级核实，无空中楼阁。本 spec 的所有 `file:line` 引用在写作时均已 grep/read 实测（防 [[changelog-fresh-read-pitfall]]）。

## 1. 概述

### 目标

为 enhanced 增加双组件自更新能力，对标 Godot AI 工程化：

1. **npm 包更新提示**：MCP 服务端启动时异步查 npm registry，有新版提示用户 `npm update`
2. **addon 版本检查/更新**：AI 经 MCP 工具检查各 Godot 项目内 addon 版本是否与包漂移，并按需更新（走确认门）

### 范围

- 新增 1 个 MCP 工具（`self_update`，聚合 check/update 两 action）
- 新增 2 个 core 模块（update-checker / addon-version）
- index.ts 启动挂载 + tool-registry/module-loader 注册

### 非目标（YAGNI）

- ❌ CLI 自更新命令（addon 更新只走 MCP 工具，AI 驱动；用户确认决策）
- ❌ scripts/install-plugin.js 瘦身复用 TS 模块（CLI 保持独立，TS/JS 边界不强求代码级共享，靠测试+注释保一致）
- ❌ cpSync 原子化（见 §8 风险权衡，可自愈）
- ❌ 预发布版本号解析（enhanced 未发过 pre-release，compareVersion 假设纯数字 x.y.z）
- ❌ Asset Library 渠道的版本检查（Godot 引擎自带，enhanced 不重复实现）

## 2. 背景与痛点

enhanced 是**双组件**：npm 包（MCP 服务端 TS）+ editor addon（GDScript）。addon 有 3 个分发渠道：

| 渠道 | 装在哪 | 更新机制 | enhanced 要管吗 |
|------|--------|---------|----------------|
| Godot Asset Library | Godot 项目 | **引擎自带版本检查**（编辑器提示 Update） | 否（引擎覆盖） |
| npm + `install-plugin` | Godot 项目 | **装一次固定，不跟包升级** | ← 真空（本 spec 目标） |
| GitHub Release | 源码 | 手动下载 | 否 |

**核心痛点**：用户 `npm update` 把 MCP 服务端升到新版（如 0.23.0→0.24.0），但项目里 `npx install-plugin` 装的 addon 还是旧版 → 服务端（新）与项目 addon（旧）协议漂移，新工具/新协议字段在旧 addon 上不工作。

现存基础（复用，不重写）：
- `scripts/version-sync.mjs`：package.json version 是单一真相源，CI 门禁保证 5 文件版本一致（含 `addons/godot_mcp_server/plugin.cfg`）
- `scripts/install-plugin.js`：CLI addon 安装（`cpSync` + `realpathSync` 防 symlink + `--verify` 后置校验）

## 3. 架构

### 5 组件

| # | 组件 | 位置 | 职责 |
|---|------|------|------|
| ① | npm 检查器 | `src/core/update-checker.ts`（新） | 异步查 npm registry + 24h 缓存 + 网络容错 |
| ② | addon 版本/更新 helper | `src/core/addon-version.ts`（新） | 读 plugin.cfg 版本 + cp+verify addon |
| ③ | MCP 工具 | `src/tools/self-update.ts`（新，平铺） | 单工具聚合 check/update 两 action |
| ④ | 启动挂载 | `src/index.ts`（改） | `import().then().catch()` 异步触发 npm 检查 |
| ⑤ | 工具注册 | `src/core/tool-registry.ts` + `src/core/module-loader.ts`（改） | TOOL_GROUPS 加 `selfupdate` 组 + 模块登记 |

### 数据流（两通道独立，互不依赖）

```
[通道 A：启动被动提示]                [通道 B：AI 按需检查/更新]
index.ts 启动                         AI/用户调 MCP self_update 工具
  └─ import(update-checker)             ├─ action=check ──┐
      .then(checkForUpdateCached)       │   ├─ npm: update-checker (latest, force:true)
      .then(r => 提示 if 更新可用)       │   └─ addon: addon-version.readAddonVersion (各白名单项目)
      .catch(()=>{})  // 静默           ├─ action=update (project_path) ── 确认门
                                        │   └─ addon-version.updateAddon (cp+verify)
                                        └─ 返回 {npm, addons[]} / {updated_from→to}
```

**关键边界**：通道 A 只负责 npm 包被动提示（stderr 一行，失败静默）；addon 更新只在通道 B 由 AI 经确认门触发。两通道共享 update-checker 的 npm 查询逻辑（不重复实现）。

## 4. 组件详设

### 4.1 `src/core/update-checker.ts`

| 项 | 设计 | 实仓依据 |
|----|------|---------|
| 包名 | `godot-mcp-enhanced` | package.json:2 |
| 查询 | `fetch('https://registry.npmjs.org/godot-mcp-enhanced/latest')` → `.version` | 全局 fetch（engines `>=18.0.0`，package.json:70-72，无额外依赖） |
| 当前版本 | `createRequire(import.meta.url)('../package.json').version` | 照搬 GodotServer.ts:32-34 ESM 读 JSON 先例 |
| 版本比较 | 手写 `compareVersion(a,b)`：`split('.').map(Number)` 逐段比；零依赖（deps 仅 sdk+ws） | package.json:55-58 |
| 缓存位置 | `~/.godot-mcp/update-cache.json`（机器级，非项目级） | 复用 instance-manager.ts:71-72 同根目录惯例 |
| 缓存结构 | `{ lastCheck: number(ms), latest: string }` | — |
| 缓存命中 | `Date.now() - lastCheck < 24h` → 用 latest，不查网 | TTL 24h 匹配发版节奏 |
| 缓存写入 | 原子写（tmp+rename）；目录缺失 `mkdir recursive`；损坏/读失败当 miss | — |
| 网络容错 | `AbortController` 5s 超时；网络错/非 200/解析失败 → 静默返 `{latest:current, updateAvailable:false, fromCache:false}`，**绝不抛** | — |
| 导出 | `checkForUpdateCached(opts?: {force?: boolean}): Promise<{current, latest, updateAvailable, fromCache}>` | `force:true` 供 check action 绕缓存拿实时 |

**缓存 current 变化语义**：缓存存 `latest`，`current` 每次实时读 package.json。用户 `npm update` 后 current 追上 latest → `updateAvailable=false` 自动消除提示（即使 24h 缓存未过期）。npm 再发新版时 24h 内漏报是 TTL 固有权衡，`force:true` 兜底。

**启动挂载**（index.ts:115-123 Dashboard launcher 区段，对齐其异步非阻塞模式）：

```ts
import('./core/update-checker.js')
  .then(({ checkForUpdateCached }) => checkForUpdateCached())
  .then(r => {
    if (r.updateAvailable) {
      getLogger().warn('godot-mcp',
        `Update available: ${r.current} → ${r.latest}. Run: npm i -g godot-mcp-enhanced`);
    }
  })
  .catch(() => {});  // 网络失败静默，不阻塞 stdio 握手
```

> `getLogger().warn()` → `writeEntry` → `process.stderr.write(formatStderr(entry))`（logger.ts:263-268）。stderr 是 MCP 日志通道，客户端未必显示——通道 B 的 check action 是可诊断性兜底。

### 4.2 `src/core/addon-version.ts`

复刻 `scripts/version-sync.mjs:56-60`（读版本正则）+ `scripts/install-plugin.js:17-65`（cp+verify），改进：MCP 场景加 deny-by-default 白名单门（CLI 是用户主动信任，MCP 是 AI 调用）。

```ts
import { readFileSync, existsSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { validateProjectRoot, isPathInAllowedRoots, safeRealPath } from './path-utils.js';

const ADDON_REL = ['addons', 'godot_mcp_server'] as const;
// build/core/addon-version.js → 上两级包根 → addons/godot_mcp_server
// tsconfig outDir=build/rootDir=src；package.json files 含 "addons"
const addonSource = join(dirname(fileURLToPath(import.meta.url)), '..', '..', ...ADDON_REL);

/** 读目标项目 addon 版本。正则复刻 version-sync.mjs:57 */
export function readAddonVersion(projectPath: string): { version: string | null; installed: boolean } {
  if (!isPathInAllowedRoots(projectPath)) throw new Error('projectPath 不在 ALLOWED_PROJECT_PATHS (deny-by-default)');
  const cfg = join(projectPath, ...ADDON_REL, 'plugin.cfg');
  if (!existsSync(cfg)) return { version: null, installed: false };
  const m = readFileSync(cfg, 'utf-8').match(/^version="([^"\r]*)"/m);  // version-sync.mjs:57
  return { version: m?.[1] ?? null, installed: true };
}

/** 包内 addon 源 cp 到目标项目。复刻 install-plugin.js:17-65 + 加门 */
export function updateAddon(projectPath: string): { dest: string; verifyOk: boolean } {
  if (!isPathInAllowedRoots(projectPath)) throw new Error('projectPath 不在 ALLOWED_PROJECT_PATHS (deny-by-default)');
  const real = safeRealPath(validateProjectRoot(projectPath));  // project.godot 检查 + symlink 归一
  const dest = join(real, ...ADDON_REL);
  cpSync(addonSource, dest, { recursive: true });                // install-plugin.js:58
  const content = readFileSync(join(dest, 'plugin.cfg'), 'utf-8');
  const verifyOk = content.includes('[plugin]') && content.includes('script="plugin.gd"');  // install-plugin.js:44
  return { dest, verifyOk };
}
```

**路径校验三层**（比 CLI 严）：

| 层 | 函数 | 作用 | 行号 |
|----|------|------|------|
| 白名单门 | `isPathInAllowedRoots` | deny-by-default，AI 调用必需 | path-utils.ts:258 |
| project.godot 检查 | `validateProjectRoot` | 确认是 Godot 项目 | path-utils.ts:46 |
| symlink 归一 | `safeRealPath` | 防 junction/symlink 穿越 | path-utils.ts:118 |

> 不碰 `path-security.ts` 的 `sanitizePath`——其为 UNWIRED 预留原语（path-security.ts:4-7 注释明说生产未调用，实际防护由 path-utils.ts `resolveWithinRoot` 承担）。

**关键决策**：
- `readAddonVersion` 返回 `{version, installed}`：区分「未安装」（无 plugin.cfg → installed:false）vs「已安装 malformed」（有 cfg 但 version 正则不匹配 → installed:true, version:null）
- `verifyOk=false` 不 throw，返回结构让工具层决定（节 4.3 报错给 AI）—— helper 保持纯
- 原子写/回滚**不做**（YAGNI，见 §8）
- verify 强度仅 `[plugin]` + `script="plugin.gd"`（照搬 install-plugin.js:44，不加强）

### 4.3 `src/tools/self-update.ts`

**⚠️ 工具粒度：单工具 + action enum（不是两个独立工具）**。这是 brainstorming 核实发现的关键约束（见 §5 安全-两道门）：`guard.ts:65` 在 `action==null` 时直接 return false 不确认，若 update 功能做成无 action 参数的独立工具，confirm 门静默失效。

```ts
export const TOOL_META = {
  self_update: {
    actionRisks: {
      check: 'read' as const,     // 只读，免确认
      update: 'write' as const,   // 破坏性（覆盖安装），需确认
    }
  }
};
```

**inputSchema**：`action` enum=`['check','update']`；`project_path`（update 时 required）。

**action=check**（只读，免确认）：
- `project_path` 可选（指定则只查该项目，缺省扫 ALLOWED_PROJECT_PATHS 全部）
- 调 `checkForUpdateCached({force:true})`（用户主动查，绕 24h 缓存拿实时 npm latest）+ 各项目 `readAddonVersion`
- `expected_version` = `pkgVersion`（version-sync 保证 plugin.cfg==package.json）
- 返回：
  ```json
  {
    "npm": {"current":"0.23.0","latest":"0.24.0","updateAvailable":true},
    "addons":[
      {"project_path":"/A","installed_version":"0.22.0","expected_version":"0.23.0","matches":false,"installed":true},
      {"project_path":"/B","installed_version":null,"installed":false}
    ]
  }
  ```
- **两个独立信号**：`npm.updateAvailable`=「npm 包有新版，提示用户 npm update」；`addons[].matches`=「项目 addon 漂移，AI 可 action=update」
- **未配置白名单**：`getAllowedProjectPaths()===[]` → `addons:[]` + 提示「配置 ALLOWED_PROJECT_PATHS 以启用 addon 检查」

**action=update**（破坏性，确认门）：
- 参数：`project_path`（required）
- 流程：`isPathInAllowedRoots` → `validateProjectRoot` → 读 `installed_version` → **降级保护** → `updateAddon`（cp+verify）→ 返回
- 返回：`{"project_path":"/A","updated_from":"0.22.0","updated_to":"0.23.0","verifyOk":true,"dest":"/A/addons/godot_mcp_server"}`
- `verifyOk=false` 时返回 error 给 AI（helper 不 throw，工具层包装）

**降级保护（null 分支必写）**：
```
installed_version == null              → 直接 cp（首次安装/修复 malformed，不拒绝）
installed_version != null
  && compareVersion(installed, expected) > 0  → 拒绝（return error「项目 addon 版本 X 比包版本 Y 新，疑似降级，拒绝」）
否则                                    → cp 更新
```

### 4.4 `src/index.ts` 挂载

见 §4.1 末「启动挂载」代码块。挂载点 L115-123（Dashboard launcher 区段），模式对齐 `import('./dashboard/launcher.js').then().catch()`。

### 4.5 工具注册（batch D D1 教训：不登记→游离）

**`src/core/tool-registry.ts`** TOOL_GROUPS 加组（ToolGroupDef 结构 `{description, tools, requires, protected?}`，L159-162）：

```ts
selfupdate: { description: '自更新', tools: ['self_update'], requires: [] },
```

> core 类（`requires:[]`，无连接依赖）。`protected` 不设（非核心保护组）。

**`src/core/module-loader.ts`**（L13-77 登记两步模式）：
```ts
import * as selfUpdate from '../tools/self-update.js';
// 加入 ALL_MODULES 数组
```

## 5. 安全

### 两道门（必须分写，不是一道）

| 门 | 位置 | 性质 | self_update 要做什么 |
|----|------|------|---------------------|
| (a) 运行时 confirm 门 | guard.ts:63-68 `requiresConfirmation` | **声明式自动生效，但有前提** | 声明 `actionRisks.update:'write'` + **工具必须有 action 参数**（见下） |
| (b) 测试不变量门 | risk-coverage.test.ts:17 `GUARDED_KEYS` | 手动加 | `GUARDED_KEYS` Set 加 `'self_update'`，否则「非 GUARDED 工具所有 action 须 read」测试失败 |

**(a) 门的前提（brainstorming 关键发现，已记 [[mcp-confirm-gate-action-null-bypass]]）**：

```ts
// guard.ts:63-68
export function requiresConfirmation(toolName, args): boolean {
  const action = (args?.action ?? args?.method) as string | undefined;
  if (action == null) return false;   // ⚠️ 无 action 参数 → 直接放行，不确认
  const risk = getActionRisk(toolName, action);
  return risk !== undefined && risk !== 'read';
}
```

`action==null` 时 `return false`——若 update 功能做成无 action 参数的独立工具（参数仅 project_path），confirm 门**永不触发**。故 §4.3 采用「单工具 self_update + action enum=[check,update]」粒度，让 `args.action='update'` 命中确认门。范本 get-context.ts:257 的 `'_'` key 是给无 action 参数的 readonly 工具占位的（risk-coverage 也 skip 无 enum 的工具），声明了也无人消费——update 功能不能用 '_' key。

> 遵循 [[register-tool-requires-toolmeta-risk]]：注册新工具必须声明 TOOL_META，否则 risk-coverage 默认 read=免确认漏洞。

### readOnly 代价（必须注明）

self_update 工具级 `readonly=false`（因 update action 非 read）→ `GODOT_MCP_READ_ONLY=true` 模式下 ReadOnlyGuard **拒整个 self_update 工具——check 和 update action 都不可用**。

ReadOnlyGuard 是**工具级判定**，非 action 级：`check(toolName)` 签名只收工具名、无 action 参数（ReadOnlyGuard.ts:17），`isReadOnly(toolName)` 工具级（:27），ToolDispatcher.ts:146 列表过滤 + :274 调用 guard 均传工具名。它物理上看不到 action，做不到「放行 check / 拒 update」的 action 级区分。readOnly 模式下客户端经 L146 列表过滤根本看不到 self_update 工具。

self_update 的 TOOL_META **不能设 `readonly:true`**（否则 update action 在 readOnly 模式放行，绕过 readOnly 保护）——`readonly` 须为 false 或省略，`isReadOnly('self_update')===false` 是实现期测试锚点。

**粒度合并的代价**：因采用单工具而非两独立工具，readOnly 模式下「整工具 self_update 不可用（含 check）」。这是让 guard.ts 确认门天然工作的必要代价；若要 readOnly 下 check 可用，须 ReadOnlyGuard 改 action 级判定（超范围，不做）。readOnly 模式下 AI 应提示用户退出 readOnly 再用自更新。

### 其他安全

- **路径校验三层**（见 §4.2）：isPathInAllowedRoots + validateProjectRoot + safeRealPath
- **白名单不热重载**（M5 同族）：`ALLOWED_PROJECT_PATHS` 进程级固化（env 启动时注入）。update action 要求目标项目在白名单；改白名单须**重启 MCP 服务端**；本地测试 `GODOT_MCP_UNRESTRICTED=true` 绕过
- **降级保护**（见 §4.3 null 分支）
- **npm registry 查询**：HTTPS（registry.npmjs.org），无认证，只读 GET，5s 超时，失败静默——无安全面

## 6. 测试策略

### 单元

**update-checker**（`test/update-checker.test.ts`）：
- `compareVersion` 边界：`0.23` vs `0.23.0`（补零）/ 不同段数 / 相等 / 非数字段 fallback 字符串比较
- 缓存命中（<24h 用 latest 不查网）/ miss（>24h 查网）/ 损坏文件当 miss
- 网络容错：超时 / 非 200 / JSON 解析失败 → 静默返 `updateAvailable:false`
- `force:true` 绕缓存
- 缓存 current 变化语义（用户升级后 updateAvailable 自动 false）

**addon-version**（`test/addon-version.test.ts`）：
- `readAddonVersion` 三态：已安装（version 正确）/ 未安装（installed:false）/ malformed（installed:true, version:null）
- `updateAddon` verifyOk（用 tmp fixture 项目，mock addonSource 或用真实仓库根）
- `isPathInAllowedRoots` 拒绝未授权路径（throw）
- `validateProjectRoot` 拒绝非 Godot 项目

### 集成

**self_update 工具**（`test/self-update.test.ts`）：
- check 返回结构（npm + addons[]）
- check 未配置白名单 → `addons:[]` + 提示
- update 降级拒绝（installed > expected）
- update null 分支（installed_version==null 直 cp 修复）
- update verifyOk=false 返回 error

### 测试不变量门（必改项）

**`test/risk-coverage.test.ts`** GUARDED_KEYS（L17-22）加 `'self_update'`：
```ts
const GUARDED_KEYS = new Set([
  ..., 'blender',
  'self_update',   // 新增
]);
```
否则「非 GUARDED 工具所有 action 须 read」测试失败（update action 是 write）。

### readOnly

- `GODOT_MCP_READ_ONLY=true` 下 self_update **整工具被拒**：check 与 update action 均不可用（ReadOnlyGuard 工具级判定，经 ToolDispatcher.ts:146 列表过滤，客户端看不到该工具）
- 实现期锚点：`isReadOnly('self_update')===false`（验证未误标 `readonly:true` 致 update 绕过 readOnly 保护）

### 启动检查

- index.ts `import().then().catch()` 异步非阻塞（不阻塞 stdio 握手）
- stderr 提示格式：`Update available: X → Y. Run: npm i -g godot-mcp-enhanced`
- 网络失败静默（.catch(()=>{})）

## 7. 实仓依据索引（写作时已核实）

| 引用 | 行号 | 核实内容 |
|------|------|---------|
| GodotServer.ts | 32-34 | `createRequire(import.meta.url)` + `require('../package.json').version` ESM 读 JSON 先例 |
| instance-manager.ts | 71-72 | `join(homedir(), '.godot-mcp', 'instances')` 机器级目录 |
| index.ts | 115-123 | Dashboard launcher `import().then().catch()` 异步挂载点 |
| logger.ts | 263-268 | `writeEntry` → `process.stderr.write(formatStderr(entry))` |
| path-utils.ts | 46 / 118 / 258 | `validateProjectRoot` / `safeRealPath` / `isPathInAllowedRoots` 三导出 |
| path-security.ts | 4-7 | `sanitizePath` UNWIRED 注释（不碰） |
| tsconfig.json | 6-7 | `outDir=./build` / `rootDir=./src` |
| tool-registry.ts | 9 / 11-16 / 20-28 / 159-162 / 166-194 | RiskLevel / ToolMeta / ToolModule / ToolGroupDef / TOOL_GROUPS |
| get-context.ts | 257 | TOOL_META 范本 `{ readonly:true, long_running:false, actionRisks:{_:'read'} }` |
| guard.ts | 63-68 | `requiresConfirmation`，`action==null → return false` |
| risk-coverage.test.ts | 17-22 | GUARDED_KEYS Set（工具名） |
| module-loader.ts | 13-77 | `import * as X` + ALL_MODULES 数组两步登记 |
| install-plugin.js | 17-65 | cpSync + realpathSync + verify 逻辑（复刻源） |
| version-sync.mjs | 56-60 | plugin.cfg `version="..."` 正则（复刻源） |
| package.json | 2 / 3 / 55-58 / 70-72 | name / version / deps(sdk+ws) / engines>=18 |

## 8. 风险与权衡

### cpSync 原子性（YAGNI + 自愈）

update 的 `cpSync(addonSource, dest, {recursive:true})` 若被 MCP 超时 kill，dest 留半截 addon → Godot 加载 addon 报错。

**决策：不做原子化**。分析：
- 替代方案 cp-to-tmp + rename：Windows 上 rename 目录需 dest 不存在（先 rm(dest) 再 rename），rm 后 rename 前失败反致 addon 完全丢失——比半截更糟
- 直接 cpSync 覆盖至少 dest 总有内容（哪怕半截）
- **可自愈**：重跑 update action 再覆盖修复
- 频率极低（版本更新才跑）+ 源固定（包内 addon）+ 用户主动触发

对齐 install-plugin.js:17-20 注释「危害收窄：源固定、用户主动」。留 follow-up：若实测被 kill 留半截且用户困惑，再评估 cp-to-tmp+rename+回滚。

### 缓存 24h TTL

npm 再发新版时 24h 内启动检查漏报。`force:true`（check action）兜底拿实时。npm 包发版频率低，24h 可接受。

### actionRisks 值 'write' vs 'destructive'

取 `'write'`。Node `cpSync` recursive 默认不删 dest 独有文件（覆盖安装语义，同 install-plugin），可逆（重装旧版），非不可逆删除。`'destructive'` 过重。

## 9. 与 Godot AI 追赶计划的关系

本 spec 是「Godot AI 工程化追赶持久战」子项目 **3/3**（self-update 机制）：
- 1/3 CI Godot 版本矩阵 ✅ 已闭环（master `45f980b`+`c7276cd`）
- 2/3 测试规模追赶（549→2128）— batch E 测试质量加固已 10/10 闭环，规模追赶另行规划
- 3/3 self-update 机制 — **本 spec**

## 10. 变更清单

| 文件 | 操作 |
|------|------|
| `src/core/update-checker.ts` | 新建 |
| `src/core/addon-version.ts` | 新建 |
| `src/tools/self-update.ts` | 新建 |
| `src/index.ts` | 改（L115-123 区段加启动检查 import） |
| `src/core/tool-registry.ts` | 改（TOOL_GROUPS 加 selfupdate 组） |
| `src/core/module-loader.ts` | 改（import + ALL_MODULES 登记） |
| `test/update-checker.test.ts` | 新建 |
| `test/addon-version.test.ts` | 新建 |
| `test/self-update.test.ts` | 新建 |
| `test/risk-coverage.test.ts` | 改（GUARDED_KEYS 加 'self_update'） |
| `CHANGELOG.md` | 改（[Unreleased] 加 Added 条目） |
| `test/regression/defects.ts` | 可选（加 detect 防复发，对齐 batch 惯例） |
