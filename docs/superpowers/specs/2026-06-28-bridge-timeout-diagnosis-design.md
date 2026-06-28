---
date: 2026-06-28
status: design（待用户审）
topic: Bridge 超时分层诊断
related:
  - ROADMAP.md M2 #5（已从 execute_gdscript 改归 Bridge）
  - 竞品源码深挖：godot-mcp-pro `addons/godot_mcp/commands/base_command.gd:345-379`（build_timeout_error）
  - src/tools/game-bridge.ts:733-737（自承缺口）
---

# Bridge 超时分层诊断 — 设计文档

## 1. 背景与目标

`game-bridge.ts` 的 Bridge（TCP 连接运行中游戏）错误处理当前把所有失败统一兜底为 `BRIDGE_ERROR`，丢失了「连不上」与「连上但卡住」的语义区分。agent 收到 `BRIDGE_ERROR` 后无法判断该「启动游戏 / 重装 bridge」还是「检查游戏报错 / 加大 timeout」，可能误判为连接问题去重启连接、误删 autoload。

**目标**：恢复 `BRIDGE_NOT_CONNECTED` 语义 + 新增 `BRIDGE_TIMEOUT`，让 agent 能精准自愈。借鉴竞品 godot-mcp-pro `build_timeout_error`（`base_command.gd:345-379`）的分层诊断思路，但适配本项目 headless / Bridge 架构——**不接编辑器 debugger，拿不到 runtime error 详情**，仅借鉴「区分未运行 vs 卡住」这一层。

**来源**：竞品源码深挖文档（2026-06-27）核实 + `game-bridge.ts:733-737` 自承缺口（注释原文：「游戏未运行与一般桥接错误同归 BRIDGE_ERROR，恢复 BRIDGE_NOT_CONNECTED 语义需改 sendToBridge 转译层，另开任务」）。

## 2. 现状核实（对注释判断的修正）

`game-bridge.ts:736` 注释称「恢复需改 sendToBridge 转译层让错误信号穿越」。**实测不准确**：

- `sendToBridge` 内部已通过不同 reject 路径区分了语义（ECONNREFUSED 走 `.catch:307` 转译、request timeout 走 `timer:255`、socket 故障走 `onError/onClose`）。
- 真正抹平区分的是**外层 `handleTool` catch（`game-bridge.ts:732-739`）**把所有 reject 一律 `opsErrorResult('BRIDGE_ERROR')`。

故改造方向：**让各 reject 路径抛带类型的 Error，外层 catch 按 `instanceof` 分类**，而非大改转译层。改动集中在 `game-bridge.ts` 单文件（Error 子类 + `_doConnect` + `sendToBridge` + 外层 catch + 测试都在此）。

## 3. 设计：三元分类 + Error 子类

新增两个 Error 子类（`game-bridge.ts` 同文件，无需跨文件 import）：

- `BridgeNotConnectedError` — 连不上 / bridge 没正常工作（agent 自愈：检查 bridge 安装 / 游戏运行）
- `BridgeTimeoutError` — 连上 + 认证成功后请求无响应（agent 自愈：检查游戏报错 / 加大 timeout）
- 其余普通 `Error` → `BRIDGE_ERROR`（连接在但异常 / 故障）

## 4. 完整归类表（12 个 reject/throw 点）

| # | 位置 | 触发条件 | 当前 message | 目标 |
|---|---|---|---|---|
| 1 | `_doConnect:128` throw | secret + 无 projectDir | `Bridge project directory not set...` | `BridgeNotConnectedError` |
| 2 | `_doConnect:133` throw | secret not found | `Bridge secret not found at...` | `BridgeNotConnectedError` |
| 3 | `_doConnect:147` reject | auth timeout | `Bridge auth timed out after Xms` | `BridgeNotConnectedError` |
| 4 | `_doConnect:182` reject | auth failed（resp.error） | `Bridge auth failed (code): msg` | `BridgeNotConnectedError` |
| 5 | `_doConnect:187` reject | invalid JSON | `Invalid JSON from bridge: line` | 普通 Error → `BRIDGE_ERROR` |
| 6 | `_doConnect:195` reject | `sock.on('error')` | `Bridge connection error: ...` | **`err.code==='ECONNREFUSED'` → `BridgeNotConnectedError`；其余 → 普通 Error** |
| 7 | `_doConnect:200` reject | close during auth | `Bridge connection closed during auth` | `BridgeNotConnectedError` |
| 8 | `_ensureConnection:214` throw | invalidated during setup | `Connection invalidated during setup` | 普通 Error → `BRIDGE_ERROR` |
| 9 | `sendToBridge:255` reject | request timeout | `Bridge request timed out after Xms` | **`BridgeTimeoutError`** |
| 10 | `sendToBridge:291` reject | onError（请求阶段） | `Bridge connection error: msg` | 普通 Error → `BRIDGE_ERROR` |
| 11 | `sendToBridge:296` reject | onClose（请求阶段） | `Bridge connection closed before response` | 普通 Error → `BRIDGE_ERROR` |
| 12 | `sendToBridge:305` .catch | ECONNREFUSED 转译（旧） | `Cannot connect to MCP Bridge...` | **路径 A 后删除字符串匹配**，子类从源头穿透 |

**归类汇总**：
- `BRIDGE_NOT_CONNECTED`：#1, 2, 3, 4, 7 + #6 的 ECONNREFUSED 分支（共 6 条路径 + 1 分支）—— 语义统一为「连不上 / bridge 没正常工作」
- `BRIDGE_TIMEOUT`：#9（1 条）—— 「连上 + 认证后请求无响应 = 游戏卡住」
- `BRIDGE_ERROR`：#5, 8, 10, 11 + #6 的非 ECONNREFUSED 分支（4 条 + 1 分支）—— 「连接在但异常 / 故障」

> **auth 超时（#3）归 NOT_CONNECTED 而非 TIMEOUT 的理由**：auth 超时 = bridge 接受 TCP 但不响应认证 = bridge 没正常工作（旧版 / 未装 / autoload 错），agent 自愈动作与 ECONNREFUSED 同（检查安装 / 游戏运行）。与 #9（已认证后请求无响应 = 游戏卡住）区分清晰。

## 5. 实现路径 A（源头分类，推荐）

### 5.1 `_doConnect:193-196` `sock.on('error')` 检测 `err.code`

ECONNREFUSED 的**源头**是 `_doConnect:195`（`err.message` 含 `ECONNREFUSED`，Node 的 ErrnoException）。在源头按 `code` 分流，比保留 `:307` 字符串匹配健壮（code 是结构化字段，不依赖 message 文本格式）：

```ts
sock.on('error', (err) => {
  clearTimeout(timer);
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'ECONNREFUSED') {
    reject(new BridgeNotConnectedError(
      'Cannot connect to MCP Bridge. Is the game running with the bridge autoload installed?'
    ));
  } else {
    reject(new Error(`Bridge connection error: ${err.message}`));
  }
});
```

### 5.2 `_doConnect` 其余 reject 改抛子类

- #1 `:128`、#2 `:133`、#3 `:147`、#4 `:182`、#7 `:200` 的 `reject/throw(new Error(...))` 改为对应 `BridgeNotConnectedError`（message 文本保留）
- #5 `:187`、#8 `:214` 保持普通 `Error`

### 5.3 `sendToBridge:255` 改抛 `BridgeTimeoutError`

`timer` 的 `doReject(new Error(...))` 改为 `new BridgeTimeoutError(...)`。`:291`/`:296` 保持普通 Error。

### 5.4 `sendToBridge:305` `.catch` 删 ECONNREFUSED 特判，纯透传

源头已抛子类，`:307` 的 `msg.includes('ECONNREFUSED')` 字符串匹配删除。所有子类 / Error 从源头定型后穿透：

```ts
}).catch(err => {
  // 子类（BridgeNotConnectedError / BridgeTimeoutError）从 _doConnect / sendToBridge 穿透，原样抛
  return Promise.reject(err);
});
```

> 保留 `.catch` 作为显式透传，表达「子类穿透」意图且不改 Promise 链形状（更稳）。它已是 no-op，可选直接删除整个 `.catch` 让错误自然穿透到外层 `:733`——不影响正确性，实施时定。

## 6. 外层 catch 改造（`handleTool` `game-bridge.ts:732-739`）

```ts
catch (err) {
  const msg = getErrorMessage(err);
  if (err instanceof BridgeNotConnectedError) {
    return opsErrorResult(ERROR_CODES.BRIDGE_NOT_CONNECTED, msg, {
      suggestion: '游戏未运行或 Bridge 未正确响应。先 run_project 启动游戏,确认 game_bridge_install 已执行',
    });
  }
  if (err instanceof BridgeTimeoutError) {
    return opsErrorResult(ERROR_CODES.BRIDGE_TIMEOUT, msg, {
      suggestion: '游戏在运行但无响应(可能被 runtime error 卡住)——这不是连接问题。检查游戏是否报错,或加大 timeout 重试',
    });
  }
  return opsErrorResult(ERROR_CODES.BRIDGE_ERROR, msg);
}
```

## 7. 局部 ERROR_CODES（DRY + 项目一致）

项目模式是每模块局部 `const ERROR_CODES`（`recording.ts:11`、`audio-ops`、`animtree` 等）。`game-bridge.ts` 顶部新增：

```ts
const ERROR_CODES = {
  BRIDGE_NOT_CONNECTED: 'BRIDGE_NOT_CONNECTED',
  BRIDGE_TIMEOUT: 'BRIDGE_TIMEOUT',
  BRIDGE_ERROR: 'BRIDGE_ERROR',
} as const;
```

外层 catch 用 `ERROR_CODES.*` 而非裸字面量，与项目一致。

## 8. 契约声明

- **ECONNREFUSED 路径**：`BRIDGE_ERROR` → `BRIDGE_NOT_CONNECTED` 是**有意的语义修正（契约变更 / 纠错）**。这是测试 `:154` 改断言的依据。
- **非 ECONNREFUSED socket 故障**：仍 `BRIDGE_ERROR`（测试 `:132` 不变，契约守护）。
- **`BRIDGE_NOT_CONNECTED`（其余 5 条路径：#1/2/3/4/7）+ `BRIDGE_TIMEOUT`（#9）**：同样是从 `BRIDGE_ERROR` 拆出的**有意语义修正**（之前全混在 `:737` 兜底，并非「纯增量」）。
- **真正不变**：#5/8/10/11 + 非 ECONNREFUSED 分支保持 `BRIDGE_ERROR`（`:132` 守护）。

> 严格说没有「纯增量」——所有从 `BRIDGE_ERROR` 拆出的场景都是 code 变更。但这些场景现有测试都是 isError 级别、不专门断言 code，故实施无破坏。spec 不用笼统的「不破契约」措辞——全部 code 变更都是显式语义修正。

## 9. 测试策略（`test/game-bridge.test.ts`，沿用现有 net mock 模式）

| 测试 | 改动 |
|---|---|
| `:132` 非 ECONNREFUSED → BRIDGE_ERROR | **不变**（守护契约） |
| `:154` ECONNREFUSED | 断言改 `BRIDGE_NOT_CONNECTED` + 验证 `suggestion`（替换注释「另开任务」TODO） |
| **新增** request timeout（#9） | stuckSocket：auth 成功但 method 请求不响应 → 触发 `sendToBridge:255` timer → 断言 `BRIDGE_TIMEOUT` + `suggestion` |
| **新增**（建议）secret not found（#2） | mock secret 缺失 → 断言 `BRIDGE_NOT_CONNECTED`（验证非 ECONNREFUSED 路径也归类正确） |
| **新增**（建议）auth timeout（#3） | stuckSocket：bridge 接受 TCP 但不响应 auth → `:147` timer → 断言 `BRIDGE_NOT_CONNECTED`（守护常见场景，复用 stuckSocket mock） |

> **MEMORY 约束**：`game-bridge.test.ts` 已为规避 vitest Linux mock 失效做过文件合并（`:1-9`），新测试沿用同文件同 mock 模式，Windows 验证即可。`game-bridge.ts` 在 coverage 排除名单（PR14），本改动不影响 coverage 策略。

## 10. YAGNI 边界 + follow-up

- **不改 `recording.ts`**：它有独立错误处理（局部 `ERROR_CODES` + `:421` secret not found → `BRIDGE_NOT_CONNECTED`）。虽可受益于 `instanceof`，属扩大范围，列 follow-up。
- **follow-up A-4**：`recording.ts:425` 的 `SCRIPT_EXEC_FAILED` 兜底语义错误（游戏未运行应 `BRIDGE_NOT_CONNECTED`），改 `recording.ts` 时一并修。
- **不引入五元分类**：auth_timeout / socket 细分对 agent 价值低（已否决）。

## 11. 验收标准

1. `game-bridge.ts` 新增 `BridgeNotConnectedError` / `BridgeTimeoutError` + 局部 `ERROR_CODES`
2. 12 个 reject/throw 点按归类表正确分流（路径 A：`:195` 按 `err.code` 分流，删 `:307` 字符串匹配）
3. 外层 catch 按 `instanceof` 返回 `BRIDGE_NOT_CONNECTED` / `BRIDGE_TIMEOUT` / `BRIDGE_ERROR`，前两者带 `suggestion`
4. 测试 `:132` 不变、`:154` 改断言、新增 timeout + secret-not-found 测试，全绿
5. `validate_scripts` / `tsc` / `eslint` 通过
6. ROADMAP M2 #5 状态 🟡→✅（实现后更新）
