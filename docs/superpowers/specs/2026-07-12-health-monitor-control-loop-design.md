# HealthMonitor 控制回路修复设计

**日期**：2026-07-12
**类型**：进程通信 P0（可靠性）
**来源**：任务看板第 6 条（进程通信第二轮 P0×1）+ 全维度审查（health-monitor silently-drop 225s 升级）
**HEAD**：`6406de4`（承接 RCE 链修复）

## 背景

systematic-debugging Phase 1 独立核实（含子代理建图）确认：

- `GodotServer.ts:446` 注释承诺"心跳超时→降级"，但 `:448-450` startHeartbeat 仅传 pingFn，未传状态回调
- `health-monitor.ts:198-243` evaluateState 进 reconnecting（`:203-207`）/ degraded（`:215-216`）时**仅 setState**
- `setState`（`:146-151`）只 `getLogger().info` + 改 `this.state` 字段，无 emit / 无外部调用
- 全 src 零消费者注册 HealthMonitor 回调（HealthMonitor 根本没提供回调机制）
- 双侧超时依赖编辑器主线程：TS 侧 `editorConn.request('ping')`（`GodotServer.ts:449`）依赖对端响应；编辑器侧 `_heartbeat.tick` / `peer.poll()` / ping 收发 / `timeout_detected` 全在 `websocket_server.gd:210 _process`（主线程）

**后果**：编辑器主线程卡死（断点/死循环/大 import）但 TCP OPEN 时 → WS 不 close → EditorConnection reconnect 不启动 → HealthMonitor 心跳 ping 永不回包但只改内部 state → 系统瘫痪至 OS TCP keepalive（~2h）。

**唯一自动降级回路**：`GodotServer.ts:438-445` `addOnReconnectExhaustedHandler`，依赖 WS close 事件。编辑器卡死但 TCP OPEN 时此回路不触发。

## 修复方案（最小闭环，用户已选）

### 修复点 1：`health-monitor.ts` 加状态变化回调机制

HealthMonitor 加 `onStateChange` 回调字段 + setter，`setState` 在状态实际变化时触发回调。

```typescript
// 新增字段
private stateChangeListener: ((from: ConnectionState, to: ConnectionState) => void) | null = null;

// 新增 setter
onStateChange(listener: (from: ConnectionState, to: ConnectionState) => void | Promise<void>): void {
  this.stateChangeListener = listener;
}

// 修改 setState（:146-151）— 状态变化时触发监听器
setState(newState: ConnectionState): void {
  if (this.state !== newState) {
    const from = this.state;
    getLogger().info('health', `State changed: ${from} → ${newState}`);
    this.state = newState;
    // 2026-07-12: 状态变化通知外部消费者（控制回路接线点）
    try {
      this.stateChangeListener?.(from, newState);
    } catch (err) {
      getLogger().warn('health', `State change listener threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
```

**设计要点**：
- `try/catch` 包裹监听器调用——监听器异常不影响 HealthMonitor 自身状态机
- 回调签名为 `(from, to)`——消费者可区分升级（connected→degraded）与降级（degraded→connected）
- `void | Promise<void>` 返回类型——消费者可异步处理，但 HealthMonitor 不 await（fire-and-forget，避免阻塞状态机）

### 修复点 2：`GodotServer.ts:448-450` startHeartbeat 注册状态回调

```typescript
const hm = this.dispatcher?.getHealthMonitor();
hm.startHeartbeat(
  () => (this.editorConn ? this.editorConn.request('ping').then(() => true).catch(() => false) : Promise.resolve(false)),
);
// 2026-07-12: 接线控制回路 — 心跳检测到编辑器卡死（连续 ping 失败进 reconnecting）时
// 主动降级 headless，复用 reconnectExhausted handler 的降级动作。堵 HealthMonitor 纯仪表盘缺口：
// 编辑器主线程卡死但 TCP OPEN 时 WS 不 close → reconnectExhausted 不触发 → 此回路兜底。
hm.onStateChange((_from, to) => {
  if (to === 'reconnecting' && this.connectionMode === 'editor') {
    getLogger().warn('godot-mcp', 'Heartbeat detected editor stall (TCP open but main thread blocked) — degrading to headless.');
    this.handleEditorStall();
  }
});
```

### 修复点 3：抽 `handleEditorStall` 复用降级逻辑

`reconnectExhausted` handler（`:438-445`）和心跳 stall 触发的降级动作完全一致，抽私有方法复用：

```typescript
/** 编辑器不可用时的统一降级动作（WS 重连耗尽 / 心跳检测卡死 共用）。 */
private handleEditorStall(): void {
  this.dispatcher?.markEditorFallback();
  this.connectionMode = 'headless';
  this.dispatcher?.degradeToHeadless();
  this.dispatcher?.getHealthMonitor().stopHeartbeat(); // 降级后停心跳（editorConn=null，ping 必返 false）
  this.editorConn = null;
}
```

`reconnectExhausted` handler 简化为：
```typescript
this.editorConn.addOnReconnectExhaustedHandler(() => {
  getLogger().warn('godot-mcp', 'Editor reconnect attempts exhausted — degrading to headless mode.');
  this.handleEditorStall();
});
```

**降级后停心跳的理由**：`handleEditorStall` 把 `editorConn = null`，pingFn（`:449`）ternary 会 `Promise.resolve(false)`，心跳继续 recordFailure 但已无意义（已降级）。停心跳避免无谓的 recordFailure 噪声 + timer 泄漏。rebuild 成功后 `establishEditorConnection` 会重新 `startHeartbeat`。

## 验收标准

1. `HealthMonitor.setState` 状态变化时调用 `onStateChange` 注册的监听器
2. 监听器抛异常不破坏 HealthMonitor 状态机（try/catch）
3. `GodotServer` 注册回调后，HealthMonitor 进 reconnecting 时触发 `handleEditorStall`（降级 headless + 停心跳 + editorConn=null）
4. 既有 `reconnectExhausted` handler 行为不变（WS close 仍触发降级）
5. 合法场景不回归：心跳 ping 成功（编辑器正常）不触发降级；rebuild 成功后心跳正常重启
6. 全量测试绿（vitest + tsc + lint）

## 测试计划（TDD）

- **RED 1**：health-monitor 测试——`setState` 变化时 onStateChange 监听器被调用（当前无回调机制，失败）
- **RED 2**：health-monitor 测试——监听器抛异常不影响后续 setState（当前无 try/catch，但无监听器机制所以需先加机制）
- **GREEN**：实施修复点 1（health-monitor 加回调）
- **集成验证**：GodotServer 接线（修复点 2/3）通过现有 e2e + 新单元测试验证状态转移触发降级
- **回归**：全量 vitest 确认既有 health-monitor / reconnect / degrade 测试不回归

## 不修的项

- 不改编辑器侧 GDScript（`heartbeat.gd` / `websocket_server.gd`）——主线程依赖是 Godot 架构本质，无法从插件侧解决
- 不加工具调用前 `getState()` 检查（用户选最小闭环方案，非闭环+工具前检查方案）
- 不改 HealthMonitor 的状态转移阈值（maxConsecutiveFailures=5 等）——阈值合理，缺的是控制回路
- 不加 OS 级 TCP keepalive 调优——跨平台差异大，且本修复后 15s*5=75s 即降级，远快于 keepalive

## 影响文件

- `src\core\health-monitor.ts`（加 onStateChange 字段 + setter + setState 触发）
- `src\GodotServer.ts`（startHeartbeat 注册回调 + 抽 handleEditorStall + reconnectExhausted 简化）
- 测试文件（health-monitor.test / godot-server 相关）
- `test\regression\defects.ts`（登记新 defect + baseline bump）
