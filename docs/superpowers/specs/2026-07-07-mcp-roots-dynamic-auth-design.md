# MCP Roots 动态授权 Design

**Date:** 2026-07-07
**Status:** Design（待 plan）
**Base:** master `5f2e7de`
**Review artifact:** `D:\workspace\review\.claude\reviews\2026-07-07-godot-mcp-enhanced-mcp-roots-dynamic-auth-design-review.md`

## 1. 目标

接入 MCP Roots 协议，让支持 Roots 的客户端在运行时动态声明授权根，免去 `ALLOWED_PROJECT_PATHS` env 改后须重启 MCP 服务端的痛点（memory [[godot-mcp-bridge]] M5：env 进程级固化，改后须重启 MCP 服务端才生效）。

**非目标**：多实例 Roots 扩展、延迟支持、Roots+env 合并、应用层硬上限（见 §8）。

## 2. 信任模型（最重要——必读）

**MCP Roots 语义**：Roots 是 client 向 server 声明的"我授权你操作这些根"。一旦 client 提供（非空），server 将其视为授权源。

**关键声明（必须在 spec 显式，防埋雷）**：

- `ALLOWED_PROJECT_PATHS` env 是**不支持 Roots 的客户端的兜底授权源**，**不是安全硬上限**。
- 当 client 支持 Roots 且返回非空 → Roots **整体替换** env（env 在该会话内失效）。operator 设的 env 不再束缚 client 声明的范围。
- 若需**硬上限**（即使 client 声明也不超），必须靠 **OS 级沙箱/容器**（容器只读挂载、AppArmor、chroot 等），不能依赖应用层 env。
- 此设计与 MCP 语义一致（官方 filesystem 参考实现同模式），且是已决策方案（Roots 优先、env 兜底、替换式）。

**为什么替换而非合并**：合并（并集）会扩大攻击面（client 声明 + env 遗留），违背"client 是授权权威"语义。替换更严格。operator 若要保留 env 路径 → 在 client 不配 Roots（自动回落 env）或在 client Roots 里一并声明。

## 3. 架构

### 3.1 授权优先级（最高→最低）

| 级 | 来源 | 改动 |
|---|---|---|
| 1 | `GODOT_MCP_UNRESTRICTED=true` | 不变（最高，绕过一切） |
| 2 | **动态 Roots（client 提供，非空）** | **新增** |
| 3 | `ALLOWED_PROJECT_PATHS` env | 不变（Roots 缺失时兜底） |
| 4 | cwd 兜底（deny-by-default） | 不变 |

### 3.2 核心决策：单数据源 + check 零改

- **单数据源**：`getAllowedProjectPaths()` 是唯一授权根读取入口。改它一处，所有下游（`isPathInAllowedRoots`、`helpers.ts:104` 等）透明升级。
- **check 零改**：`isPathInAllowedRoots`（path-utils.ts:221）签名与 realpath 校验逻辑**完全不变**。Roots 注入只是给 `getAllowedProjectPaths` 增加一个"动态优先"数据源层。
- **realpath 防御统一**：无论授权根来自 env 还是 Roots，都经 `isPathInAllowedRoots` 的 `normalize(safeRealPath(...))` 归一（防 junction/symlink 绕过，C-1/C-SEC-1 既有防御）。Roots 不引入新绕过向量。

## 4. 组件改动

### 4.1 `src/core/path-utils.ts`

**(a) 加模块级动态授权源 + setter + 查询**（在 `getAllowedProjectPaths` :198 前）：

```ts
// 动态 Roots 授权源（client 经 MCP Roots 协议注入，GodotServer.oninitialized 调用）。
// null = 未注入 → getAllowedProjectPaths() 回落 env。
//
// 命中 DEFECT.module-level-mutable-state(open, ADVISORY) 形态（defects.ts:478，
// detect = countMatchesInDir('src', /^let _/gm)）。同步单线程访问无真实竞态，
// 参照 src/core/call-recorder.ts:30 先例（CallRecorder._instance 同模式，已标注）。
let _dynamicRoots: string[] | null = null;

/**
 * 注入 client Roots 授权源。非空 → 替换 env；null/空 → 清空回落 env。
 * 注入期只按 URI scheme 过滤（file://），不过滤路径存在性——存在性延迟到
 * isPathInAllowedRoots 的 safeRealPath（与 env 分支对齐，兼容"待创建新项目"）。
 */
export function setAllowedRootsFromClient(roots: string[] | null): void {
  _dynamicRoots = roots && roots.length > 0 ? roots : null;
}

/** 查询是否处于 client Roots 注入态（区别于 env 非空）。GodotServer re-fetch 决策用。 */
export function hasDynamicRoots(): boolean {
  return _dynamicRoots !== null;
}
```

**(b) 改 `getAllowedProjectPaths()`**（:198-202）——动态优先：

```ts
export function getAllowedProjectPaths(): string[] {
  if (_dynamicRoots !== null) return _dynamicRoots;  // 动态 Roots 优先（整体替换 env）
  const env = process.env.ALLOWED_PROJECT_PATHS;     // 兜底
  if (!env) return [];
  return env.split(';').filter(Boolean).map(p => resolvePath(p));
}
```

**不变**：`isPathInAllowedRoots`（:221）、`safeRealPath`、`resolveWithinRoot` 等所有 check 逻辑。

**语义升级影响**：`helpers.ts:104 allowOutsideProjectPaths()` 调 `getAllowedProjectPaths().length > 0`——Roots 注入后返回 true（确有显式授权），语义一致受益。（注：`allowOutsideProjectPaths` 已 `@deprecated since v0.18.0, removal in v0.20.0`，当前 v0.21.0 早该删——记入待办单独清理，非本设计关切。）

### 4.2 `src/GodotServer.ts`

**(a) import 加**（:3-11 区 import Schema 处加一项；:12 区加 node:url）：

```ts
RootsListChangedNotificationSchema,  // 加到 types.js 的 import 列表
// ...
import { fileURLToPath } from 'node:url';
import { setAllowedRootsFromClient, hasDynamicRoots } from './core/path-utils.js';
```

**(b) 加私有方法 `initRootsIntegration()`**（区分 initial-fetch vs re-fetch，见 §6）：

```ts
private async initRootsIntegration(): Promise<void> {
  const applyRoots = async (isRefetch: boolean): Promise<void> => {
    try {
      const resp = await this.server.listRoots();
      // 注入期只验 file:// scheme + fileURLToPath 解析；不过滤存在性（对齐 env，见 §6）
      const valid: string[] = [];
      for (const r of resp.roots ?? []) {
        if (!r.uri.startsWith('file://')) continue;  // 仅 file: 协议
        try { valid.push(fileURLToPath(r.uri)); } catch { /* 跳过非法 URI */ }
      }
      if (valid.length > 0) {
        setAllowedRootsFromClient(valid);
        getLogger().info('security', `Authorized ${valid.length} root(s) from MCP client`);
      } else {
        // 空/全无效：首次回落 env；re-fetch 已有 roots 则保留旧（不静默切作用域）
        if (isRefetch && hasDynamicRoots()) {
          getLogger().warn('security', 'Roots re-fetch returned empty/invalid — keeping previous roots');
        } else {
          setAllowedRootsFromClient(null);
          getLogger().info('security', 'No valid client roots — using ALLOWED_PROJECT_PATHS baseline');
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isRefetch && hasDynamicRoots()) {
        getLogger().warn('security', `Roots re-fetch failed — keeping previous roots: ${msg}`);
      } else {
        setAllowedRootsFromClient(null);
        getLogger().warn('security', `Initial roots fetch failed — using env baseline: ${msg}`);
      }
    }
  };

  this.server.oninitialized = async () => {
    const caps = this.server.getClientCapabilities();
    if (caps?.roots) {
      await applyRoots(false);  // initial-fetch
    } else {
      getLogger().info('security', 'Client does not support MCP Roots — using ALLOWED_PROJECT_PATHS baseline');
    }
  };

  this.server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
    await applyRoots(true);  // re-fetch
  });
}
```

**(c) 接线**：`setupHandlers()` 末尾调 `this.initRootsIntegration();`。

**(d) `close()` 清理**（与现有 close 逻辑并列）：

```ts
setAllowedRootsFromClient(null);  // 回落 env，干净关闭 + 测试隔离
```

## 5. 数据流

```
启动 → new GodotServer → setupHandlers → initRootsIntegration（注册钩子，不阻塞）
  → server.connect(transport)
  → client 发 initialized → server.oninitialized
  → 检测 clientCapabilities.roots
     ├─ 支持 → listRoots() → 注入期只验 file:// scheme（不过滤存在性，对齐 env）
     │         → 非空：setAllowedRootsFromClient(valid)（替换 env）
     │         → 空/全无效：setAllowedRootsFromClient(null)（回落 env）
     └─ 不支持 → 不注入（用 env baseline）
运行时 → client 发 roots/list_changed → handler re-fetch
     ├─ 成功非空 → 替换
     ├─ 成功空/无效 + 已有 roots → 保留旧 roots（不静默切）
     ├─ 成功空/无效 + 无旧 roots → 回落 env
     ├─ 失败 + 已有 roots → 保留旧 roots + warn（不静默切）
     └─ 失败 + 无旧 roots → 回落 env + warn
工具调用 → isPathInAllowedRoots（零改）→ getAllowedProjectPaths（动态优先）→ realpath 归一 → 判定
关闭 → setAllowedRootsFromClient(null) → 回落 env
```

## 6. 错误处理（fail-to-env-baseline + re-fetch 保留）

**核心原则**：Roots 任何异常都不崩溃。

| 场景 | initial-fetch | re-fetch（已有合法 roots） |
|---|---|---|
| client 不支持 Roots | info log，用 env（不注入） | n/a |
| `listRoots()` 抛错 | warn log，回落 env | **保留旧 roots + warn**（不静默切作用域） |
| Roots 返回空 / 全 URI 无效 | warn log，回落 env | **保留旧 roots + warn** |
| 部分 URI 无效（非 `file://` / `fileURLToPath` 抛错） | 跳过该项，有效项正常注入 | 同左 |

**为何 re-fetch 不回落 env**：若已在使用 client roots，re-fetch 失败时回落 env 会静默改作用域——env 比旧 roots 宽则扩张（安全放松），env 空则缩到 cwd。已知好状态（旧 roots）优于未知切换。

**措辞**："fail-to-env-baseline"（非"fail-closed"——env 非空时并非真 closed，仍允许 env 范围内访问）。

**注入期不过滤路径存在性**：与 env 分支（path-utils.ts:199-201）对齐——env 只 `filter(Boolean)+resolvePath`，存在性延迟到 `isPathInAllowedRoots` 的 `safeRealPath`（兼容"待创建新项目/文件"场景）。若注入期过滤存在性，client 声明一个待建 root 会被丢，而 env 配同路径却接受 → 两来源分叉。注入期只验 `file://` scheme，存在性交给 check 期统一处理。

## 7. 测试

### 7.1 path-utils 单测（test/core/path-utils*.test.ts）

- `setAllowedRootsFromClient` 非空 → `getAllowedProjectPaths` 返回 roots
- `setAllowedRootsFromClient(null)` → 回落 env
- **契约 1：roots 双向替换 env**（§2 信任模型可执行 spec）：
  - roots 非空且窄于 env → 仅 roots 生效（env 被忽略，作用域**缩**）
  - roots 非空且宽于 env → 仅 roots 生效（作用域**扩**，env 不束缚）
  - 缺此契约 → 未来 merge 式 refactor 会静默改安全模型
- **契约 2：dynamic roots 走 realpath 归一**（绑 path-sandbox-touctou 不复发）：
  - 含符号链接 / 非规范路径（`..` / 混合分隔符）的 root → `isPathInAllowedRoots` 归一后判定，无法绕 check
- 与 `GODOT_MCP_UNRESTRICTED` 优先级（unrestricted 仍最高）
- 与 cwd 兜底关系（无 roots 无 env → cwd）

### 7.2 GodotServer 集成 mock（test/core/GodotServer*.test.ts 或新文件）

mock `Server` 的 `getClientCapabilities` / `listRoots` / `setNotificationHandler` / `oninitialized`：

- client 支持 Roots + 返回非空 → `setAllowedRootsFromClient` 被调（spy）
- client 不支持 Roots → 不调，info log
- initial `listRoots` 抛错 → 回落 env（`setAllowedRootsFromClient(null)`）
- `list_changed` 触发 re-fetch 成功非空 → 替换
- **list_changed re-fetch 抛错且已有 roots → 保留旧 roots（不调 `setAllowedRootsFromClient(null)`）**
- **list_changed re-fetch 返回空且已有 roots → 保留旧 roots**
- `close()` → `setAllowedRootsFromClient(null)`

### 7.3 回归

现有 `isPathInAllowedRoots` 测试全绿（check 零改保证）。`module-level-mutable-state` detect baseline +1（见 §9）。

## 8. scope 边界（YAGNI）

- **不**扩展到多实例：InstanceManager 子实例是 server→server 通信，无 client Roots 语义
- **不**做延迟支持：client 初始不支持、运行时才支持 Roots（边缘场景）
- **不**做 Roots + env 合并：已定替换式（§2）
- **不**做硬上限：应用层无法对 client 声明设硬上限，需 OS 沙箱（§2）

## 9. DEFECT 关联

**module-level-mutable-state（open, ADVISORY）**：

- `test/regression/defects.ts:478`，detect = `countMatchesInDir('src', /^let _/gm, /\.ts$/)`
- 加 `let _dynamicRoots` 命中 detect 形态（+1）
- 先例：`src/core/call-recorder.ts:30`（CallRecorder._instance 单例同模式，已标注）
- 处理：
  1. `_dynamicRoots` 声明处加注释引 DEFECT + call-recorder.ts:30 先例（防下个 reviewer 复标为回归）
  2. plan 阶段 drift fix baseline（参照批 2 defects baseline 44→45 先例；本次 +1，需 master 实测确认当前值后调 baseline）
- 同步操作单线程无真实竞态，ADVISORY 合理设计（defects.ts:479-481 已述）

## 10. 参考实现

- **官方 filesystem**：`D:\GitHub\_research\servers\src\filesystem\index.ts:706-752`
  - `updateAllowedDirectoriesFromRoots`（:706）
  - `setNotificationHandler(RootsListChangedNotificationSchema, ...)`（:718）
  - `server.oninitialized` + `getClientCapabilities()?.roots` + `listRoots()`（:731-752）
- **MCP SDK**（node_modules/@modelcontextprotocol/sdk/，已核实承重表面）：
  - `Server.oninitialized` / `getClientCapabilities()` / `listRoots()` / `setNotificationHandler()`
  - `RootsListChangedNotificationSchema` / `ListRootsResultSchema` from types.js
