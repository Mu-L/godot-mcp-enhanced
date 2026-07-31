import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// 批次 B 可靠性：GodotServer 降级链路字面量契约测试。
// B2/B6/B-T5 在 GodotServer（集成层），单测 mock 成本高；按 recording-screen-drag F2
// 模式用源码字面量断言（对齐 brief Step 9 契约）。

describe('GodotServer 降级链路（B2+B6 字面量契约）', () => {
  const src = readFileSync('src/GodotServer.ts', 'utf8');

  it('B2: handleEditorStall calls disconnect() before nulling editorConn', () => {
    const stallFn = src.match(/private handleEditorStall\(\)[\s\S]*?^\s*}/m);
    expect(stallFn, 'handleEditorStall 函数体未找到').toBeTruthy();
    // disconnect 必须出现在 editorConn = null 之前
    const body = stallFn![0];
    const discIdx = body.indexOf('this.editorConn?.disconnect()');
    const nullIdx = body.indexOf('this.editorConn = null');
    expect(discIdx, 'handleEditorStall 缺少 this.editorConn?.disconnect()').toBeGreaterThan(-1);
    expect(nullIdx, 'handleEditorStall 缺少 this.editorConn = null').toBeGreaterThan(-1);
    expect(nullIdx, 'disconnect() 必须在 editorConn = null 之前').toBeGreaterThan(discIdx);
  });

  it('B6: establishEditorConnection 复位 hm 状态为 connected（重建恢复）', () => {
    // establishEditorConnection 函数体内有嵌套块(if/try)致正则 `^\s*}` 提前闭合,
    // 故改用位置契约:hm.setState('connected') 必须落在 establishEditorConnection
    // 函数体范围内(起点 < setState 位置 < 下一个方法 rebuildEditorConnection 起点)。
    const establishStart = src.indexOf('establishEditorConnection(');
    expect(establishStart, '未找到 establishEditorConnection 方法').toBeGreaterThan(-1);
    const rebuildStart = src.indexOf('rebuildEditorConnection(', establishStart);
    expect(rebuildStart, '未找到 rebuildEditorConnection(应紧跟 establishEditorConnection 之后)').toBeGreaterThan(establishStart);
    const slice = src.slice(establishStart, rebuildStart);
    expect(
      slice.indexOf("hm.setState('connected')"),
      'establishEditorConnection 缺少 hm.setState("connected")（B6 重建复位）',
    ).toBeGreaterThan(-1);
  });
});

// ─── B-T5（心跳降级区分 timeout/refused 不抢占重连）──────────────────────────
// bug: pingFn catch 毯式 `() => false` 丢 err.code,两种失败都 recordFailure
// → reconnecting → handleEditorStall → disconnect() 杀 EditorConnection 20 次退避
// 自动重连。编辑器重启/瞬时不可达也强制降级须手动 reconnect。
// fix: catch 保留 err.code;onStateChange 分流 REQUEST_TIMEOUT(卡死→降级)
// vs NOT_CONNECTED/CONNECTION_LOST(下线→让自动重连兜底,不抢占)。
// 状态机链:refused→EditorConnection 自动重连→重连成功复位 hm connected
// (EditorToolExecutor._reconnectHandler) → 自动恢复;重连耗尽→reconnectExhausted
// handler→handleEditorStall 降级(最终兜底,正确)。

describe('GodotServer 心跳降级分流（B-T5 字面量契约）', () => {
  const src = readFileSync('src/GodotServer.ts', 'utf8');

  // 定位 establishEditorConnection 函数体切片（避开 B6 嵌套块陷阱）
  function establishSlice(): string {
    const start = src.indexOf('private async establishEditorConnection');
    expect(start, '未找到 establishEditorConnection 方法').toBeGreaterThan(-1);
    const nextPrivate = src.indexOf('\n  private ', start + 10);
    return nextPrivate > 0 ? src.slice(start, nextPrivate) : src.slice(start, start + 4000);
  }

  it('B-T5a: GodotServer 声明 _lastPingErrCode 字段（pingFn catch 保留 err.code）', () => {
    // 反向断言:旧实现毯式 catch 不需此字段;修复后必须声明供 onStateChange 读取
    expect(
      /private\s+_lastPingErrCode\s*:\s*string\s*\|\s*undefined/.test(src),
      '_lastPingErrCode 字段缺失——pingFn catch 无处保存 err.code（B-T5 毯式 catch 复发）',
    ).toBe(true);
  });

  it('B-T5b: pingFn catch 保留 err.code 到 _lastPingErrCode（非毯式 () => false）', () => {
    const body = establishSlice();
    // 定位 startHeartbeat 调用内的 catch
    const hbStart = body.indexOf('hm.startHeartbeat(');
    expect(hbStart, '未找到 hm.startHeartbeat 调用').toBeGreaterThan(-1);
    const hbSlice = body.slice(hbStart, hbStart + 600);
    // 反向断言:毯式 catch () => false 复发即红
    expect(
      /\.catch\(\s*\(\)\s*=>\s*false\s*\)/.test(hbSlice),
      'pingFn 仍用毯式 .catch(() => false)——丢 err.code 致 onStateChange 无法分流（B-T5 复发）',
    ).toBe(false);
    // 正向断言:catch 保存 err.code 到 _lastPingErrCode
    expect(
      /_lastPingErrCode\s*=\s*(?:err|e)\??\.code/.test(hbSlice),
      'pingFn catch 未将 err.code 保存到 _lastPingErrCode（B-T5 分流失效）',
    ).toBe(true);
    // pingFn 成功路径复位 _lastPingErrCode=undefined（避免上次错误码泄漏影响下次分流）
    expect(
      /_lastPingErrCode\s*=\s*undefined/.test(hbSlice),
      'pingFn 成功路径未复位 _lastPingErrCode=undefined（旧错误码污染下次分流）',
    ).toBe(true);
  });

  it('B-T5c: onStateChange 分流 REQUEST_TIMEOUT→handleEditorStall（降级）', () => {
    const body = establishSlice();
    const stateIdx = body.indexOf('hm.onStateChange(');
    expect(stateIdx, '未找到 hm.onStateChange 调用').toBeGreaterThan(-1);
    const slice = body.slice(stateIdx, stateIdx + 1200);
    // REQUEST_TIMEOUT 分支必须存在并调 handleEditorStall
    expect(
      /REQUEST_TIMEOUT/.test(slice),
      'onStateChange 未区分 REQUEST_TIMEOUT（TCP OPEN 主线程卡死须降级）',
    ).toBe(true);
    expect(
      /this\.handleEditorStall\(\)/.test(slice),
      'onStateChange REQUEST_TIMEOUT 分支未调 handleEditorStall',
    ).toBe(true);
  });

  it('B-T5d: onStateChange 分流 非 REQUEST_TIMEOUT→不抢占（let auto-reconnect 兜底）', () => {
    const body = establishSlice();
    const stateIdx = body.indexOf('hm.onStateChange(');
    const slice = body.slice(stateIdx, stateIdx + 1500);
    // 反向断言:旧实现无差别调 handleEditorStall 复发即红
    // 旧:if (to === 'reconnecting') { handleEditorStall(); }——只有一条路径
    // 新:必须含 else / 非 REQUEST_TIMEOUT 分支不调 handleEditorStall
    expect(
      /else/.test(slice),
      'onStateChange 缺少 else 分支——非 REQUEST_TIMEOUT 也降级,抢占自动重连（B-T5 复发）',
    ).toBe(true);
    // 非 REQUEST_TIMEOUT 分支应含 "not degrading" / "auto-reconnect" 等语义提示日志
    expect(
      /not degrading|auto-reconnect|letting/.test(slice),
      '非 REQUEST_TIMEOUT 分支缺少"不降级"语义日志（运维混淆）',
    ).toBe(true);
  });

  it('B-T5e: addOnReconnectHandler 接线 hm.reset()——重连成功即时复位(状态机链关键节点)', () => {
    // 状态机链:refused→hm reconnecting 不降级→EditorConnection 自动重连→成功→
    // 本 handler hm.reset()→connected + 清计数→恢复;耗尽→reconnectExhausted 兜底降级。
    // 无此接线:refused 后 hm 卡 reconnecting,下次 ping 要等 probeIntervalMs(60s),
    // 期间 B-T3 半开 HOL 预检拦所有 editor 工具(_executeInner getState===reconnecting)。
    const body = establishSlice();
    const recIdx = body.indexOf('addOnReconnectHandler(');
    expect(recIdx, '未找到 addOnReconnectHandler 接线').toBeGreaterThan(-1);
    const slice = body.slice(recIdx, recIdx + 400);
    expect(
      /hm\.reset\(\)/.test(slice),
      'addOnReconnectHandler 未调 hm.reset()——重连成功后 hm 卡 reconnecting(B-T5 状态机链断)',
    ).toBe(true);
  });

  it('B-T5f: reconnectExhausted handler 仍接线 handleEditorStall(最终兜底降级,链完整)', () => {
    // 反向断言链完整性:refused 不抢占但最终有兜底。
    // 若 20 次重连耗尽,必须走 reconnectExhausted → handleEditorStall 降级,
    // 否则 refused 后既不复位也不降级,永久卡 reconnecting(死锁)。
    const body = establishSlice();
    const exhIdx = body.indexOf('addOnReconnectExhaustedHandler(');
    expect(exhIdx, '未找到 addOnReconnectExhaustedHandler 接线').toBeGreaterThan(-1);
    const slice = body.slice(exhIdx, exhIdx + 400);
    expect(
      /this\.handleEditorStall\(\)/.test(slice),
      'reconnectExhausted handler 未调 handleEditorStall——重连耗尽无降级兜底(B-T5 链断,死锁)',
    ).toBe(true);
  });
});

// ─── B-T5 状态机链完整性(集成层契约)──────────────────────────────────────────
// 反向断言链完整:catch 分流(detect err.code)+ reset 方法存在 + 分流后仍走 reconnectExhausted 兜底。
describe('HealthMonitor.reset() 接口存在（B-T5 链节点契约）', () => {
  it('B-T5g: HealthMonitor 暴露公共 reset() 方法', () => {
    const src = readFileSync('src/core/health-monitor.ts', 'utf8');
    expect(
      /^\s*reset\(\)/m.test(src),
      'HealthMonitor 缺少公共 reset() 方法——B-T5 重连复位链断(GodotServer addOnReconnectHandler 无方法可调)',
    ).toBe(true);
  });
});
