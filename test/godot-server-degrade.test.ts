import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// 批次 B 可靠性：editor 降级链路字面量契约测试。
// B2/B6/B-T5 原在 GodotServer(集成层),2026-08-14 P1 抽取到 EditorConnectionManager。
// 单测 mock 成本高;按 recording-screen-drag F2 模式用源码字面量断言(对齐 brief Step 9 契约)。

describe('EditorConnectionManager 降级链路（B2+B6 字面量契约）', () => {
  const src = readFileSync('src/core/EditorConnectionManager.ts', 'utf8');

  it('B2: handleStall calls disconnect() before nulling conn', () => {
    const stallFn = src.match(/private handleStall\(\)[\s\S]*?^\s*}/m);
    expect(stallFn, 'handleStall 函数体未找到').toBeTruthy();
    // disconnect 必须出现在 conn = null 之前
    const body = stallFn![0];
    const discIdx = body.indexOf('this.conn?.disconnect()');
    const nullIdx = body.indexOf('this.conn = null');
    expect(discIdx, 'handleStall 缺少 this.conn?.disconnect()').toBeGreaterThan(-1);
    expect(nullIdx, 'handleStall 缺少 this.conn = null').toBeGreaterThan(-1);
    expect(nullIdx, 'disconnect() 必须在 conn = null 之前').toBeGreaterThan(discIdx);
  });

  it('B6: establish 复位 hm 状态为 connected（重建恢复）', () => {
    // establish 函数体内有嵌套块(if/try)致正则 `^\s*}` 提前闭合,
    // 故改用位置契约:hm.setState('connected') 必须落在 establish
    // 函数体范围内(起点 < setState 位置 < 下一个方法 handleStall 起点)。
    const establishStart = src.indexOf('private async establish(');
    expect(establishStart, '未找到 establish 方法').toBeGreaterThan(-1);
    const handleStallStart = src.indexOf('private handleStall(', establishStart);
    expect(handleStallStart, '未找到 handleStall(应紧跟 establish 之后)').toBeGreaterThan(establishStart);
    const slice = src.slice(establishStart, handleStallStart);
    expect(
      slice.indexOf("hm.setState('connected')"),
      'establish 缺少 hm.setState("connected")（B6 重建复位）',
    ).toBeGreaterThan(-1);
  });
});

// ─── B-T5（心跳降级区分 timeout/refused 不抢占重连）──────────────────────────
// bug: pingFn catch 毯式 `() => false` 丢 err.code,两种失败都 recordFailure
// → reconnecting → handleStall → disconnect() 杀 EditorConnection 20 次退避
// 自动重连。编辑器重启/瞬时不可达也强制降级须手动 reconnect。
// fix: catch 保留 err.code;onStateChange 分流 REQUEST_TIMEOUT(卡死→降级)
// vs NOT_CONNECTED/CONNECTION_LOST(下线→让自动重连兜底,不抢占)。

describe('EditorConnectionManager 心跳降级分流（B-T5 字面量契约）', () => {
  const src = readFileSync('src/core/EditorConnectionManager.ts', 'utf8');

  // 定位 establish 函数体切片（避开 B6 嵌套块陷阱）
  function establishSlice(): string {
    const start = src.indexOf('private async establish');
    expect(start, '未找到 establish 方法').toBeGreaterThan(-1);
    const nextPrivate = src.indexOf('\n  private ', start + 10);
    return nextPrivate > 0 ? src.slice(start, nextPrivate) : src.slice(start, start + 4000);
  }

  it('B-T5a: EditorConnectionManager 声明 _lastPingErrCode 字段（pingFn catch 保留 err.code）', () => {
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

  it('B-T5c: onStateChange 分流 REQUEST_TIMEOUT→handleStall（降级）', () => {
    const body = establishSlice();
    const stateIdx = body.indexOf('hm.onStateChange(');
    expect(stateIdx, '未找到 hm.onStateChange 调用').toBeGreaterThan(-1);
    const slice = body.slice(stateIdx, stateIdx + 1200);
    // REQUEST_TIMEOUT 分支必须存在并调 handleStall
    expect(
      /REQUEST_TIMEOUT/.test(slice),
      'onStateChange 未区分 REQUEST_TIMEOUT（TCP OPEN 主线程卡死须降级）',
    ).toBe(true);
    expect(
      /this\.handleStall\(\)/.test(slice),
      'onStateChange REQUEST_TIMEOUT 分支未调 handleStall',
    ).toBe(true);
  });

  it('B-T5d: onStateChange 分流 非 REQUEST_TIMEOUT→不抢占（let auto-reconnect 兜底）', () => {
    const body = establishSlice();
    const stateIdx = body.indexOf('hm.onStateChange(');
    const slice = body.slice(stateIdx, stateIdx + 1500);
    // 反向断言:旧实现无差别调 handleStall 复发即红
    expect(
      /else/.test(slice),
      'onStateChange 缺少 else 分支——非 REQUEST_TIMEOUT 也降级,抢占自动重连（B-T5 复发）',
    ).toBe(true);
    expect(
      /not degrading|auto-reconnect|letting/.test(slice),
      '非 REQUEST_TIMEOUT 分支缺少"不降级"语义日志（运维混淆）',
    ).toBe(true);
  });

  it('B-T5e: addOnReconnectHandler 接线 hm.reset()——重连成功即时复位(状态机链关键节点)', () => {
    const body = establishSlice();
    const recIdx = body.indexOf('addOnReconnectHandler(');
    expect(recIdx, '未找到 addOnReconnectHandler 接线').toBeGreaterThan(-1);
    const slice = body.slice(recIdx, recIdx + 400);
    expect(
      /hm\.reset\(\)/.test(slice),
      'addOnReconnectHandler 未调 hm.reset()——重连成功后 hm 卡 reconnecting(B-T5 状态机链断)',
    ).toBe(true);
  });

  it('B-T5f: reconnectExhausted handler 仍接线 handleStall(最终兜底降级,链完整)', () => {
    const body = establishSlice();
    const exhIdx = body.indexOf('addOnReconnectExhaustedHandler(');
    expect(exhIdx, '未找到 addOnReconnectExhaustedHandler 接线').toBeGreaterThan(-1);
    const slice = body.slice(exhIdx, exhIdx + 400);
    expect(
      /this\.handleStall\(\)/.test(slice),
      'reconnectExhausted handler 未调 handleStall——重连耗尽无降级兜底(B-T5 链断,死锁)',
    ).toBe(true);
  });
});

// ─── B-T5 状态机链完整性(集成层契约)──────────────────────────────────────────
describe('HealthMonitor.reset() 接口存在（B-T5 链节点契约）', () => {
  it('B-T5g: HealthMonitor 暴露公共 reset() 方法', () => {
    const src = readFileSync('src/core/health-monitor.ts', 'utf8');
    expect(
      /^\s*reset\(\)/m.test(src),
      'HealthMonitor 缺少公共 reset() 方法——B-T5 重连复位链断',
    ).toBe(true);
  });
});
