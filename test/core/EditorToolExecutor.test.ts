// test/core/EditorToolExecutor.test.ts
// Task 5 (§7): nav bake 长操作接线 operation_start/end 暂停心跳
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EditorToolExecutor } from '../../src/core/EditorToolExecutor.js';
import { clearRegistry, registerTools } from '../../src/core/tool-registry.js';

interface MockConn {
  request: ReturnType<typeof vi.fn>;
  startOperation: ReturnType<typeof vi.fn>;
  endOperation: ReturnType<typeof vi.fn>;
  onNotification: ReturnType<typeof vi.fn>;
  offNotification: ReturnType<typeof vi.fn>;
  addOnDisconnectHandler: ReturnType<typeof vi.fn>;
  addOnReconnectHandler: ReturnType<typeof vi.fn>;
  removeOnDisconnectHandler: ReturnType<typeof vi.fn>;
  removeOnReconnectHandler: ReturnType<typeof vi.fn>;
}

function makeMockConn(): MockConn {
  return {
    request: vi.fn().mockResolvedValue({ status: 'ok' }),
    startOperation: vi.fn().mockResolvedValue(undefined),
    endOperation: vi.fn().mockResolvedValue(undefined),
    onNotification: vi.fn(),
    offNotification: vi.fn(),
    addOnDisconnectHandler: vi.fn(),
    addOnReconnectHandler: vi.fn(),
    removeOnDisconnectHandler: vi.fn(),
    removeOnReconnectHandler: vi.fn(),
  };
}

describe('EditorToolExecutor nav bake operation (§7)', () => {
  let mockConn: MockConn;
  let executor: EditorToolExecutor;

  beforeEach(() => {
    clearRegistry();
    registerTools([{ name: 'nav', readonly: false, long_running: false }]);
    mockConn = makeMockConn();
    executor = new EditorToolExecutor(mockConn as unknown as ConstructorParameters<typeof EditorToolExecutor>[0]);
  });

  afterEach(() => {
    clearRegistry();
  });

  it('nav bake_mesh: calls startOperation before request and endOperation after (ordered)', async () => {
    const callOrder: string[] = [];
    mockConn.startOperation.mockImplementation(async () => { callOrder.push('startOperation'); });
    mockConn.request.mockImplementation(async () => { callOrder.push('request'); return { baked: true }; });
    mockConn.endOperation.mockImplementation(async () => { callOrder.push('endOperation'); });

    await executor.execute('nav', { action: 'bake_mesh', region_path: '/root/Nav' });

    expect(mockConn.startOperation).toHaveBeenCalledTimes(1);
    expect(mockConn.startOperation).toHaveBeenCalledWith(expect.any(Number));
    expect(mockConn.endOperation).toHaveBeenCalledTimes(1);
    expect(mockConn.request).toHaveBeenCalledWith(
      'nav_bake_mesh',
      expect.objectContaining({ action: 'bake_mesh' }),
      { timeoutMs: 110000 }
    );
    expect(callOrder).toEqual(['startOperation', 'request', 'endOperation']);
  });

  it('nav create_region with bake=true: wraps with start/endOperation', async () => {
    await executor.execute('nav', { action: 'create_region', bake: true });

    expect(mockConn.startOperation).toHaveBeenCalledTimes(1);
    expect(mockConn.endOperation).toHaveBeenCalledTimes(1);
    expect(mockConn.request).toHaveBeenCalledWith(
      'nav_create_region',
      expect.objectContaining({ bake: true }),
      { timeoutMs: 110000 }
    );
  });

  it('nav create_region with bake=false: does NOT call start/endOperation', async () => {
    await executor.execute('nav', { action: 'create_region', bake: false });

    expect(mockConn.startOperation).not.toHaveBeenCalled();
    expect(mockConn.endOperation).not.toHaveBeenCalled();
    expect(mockConn.request).toHaveBeenCalledWith('nav_create_region', expect.objectContaining({ bake: false }));
  });

  it('nav create_region without bake flag: does NOT call start/endOperation', async () => {
    await executor.execute('nav', { action: 'create_region' });

    expect(mockConn.startOperation).not.toHaveBeenCalled();
    expect(mockConn.endOperation).not.toHaveBeenCalled();
  });

  it('nav create_agent: does NOT call start/endOperation', async () => {
    await executor.execute('nav', { action: 'create_agent' });

    expect(mockConn.startOperation).not.toHaveBeenCalled();
    expect(mockConn.endOperation).not.toHaveBeenCalled();
    expect(mockConn.request).toHaveBeenCalledWith('nav_create_agent', expect.anything());
  });

  it('nav set_params: does NOT call start/endOperation', async () => {
    await executor.execute('nav', { action: 'set_params' });

    expect(mockConn.startOperation).not.toHaveBeenCalled();
    expect(mockConn.endOperation).not.toHaveBeenCalled();
  });

  it('nav create_link: does NOT call start/endOperation', async () => {
    await executor.execute('nav', { action: 'create_link' });

    expect(mockConn.startOperation).not.toHaveBeenCalled();
    expect(mockConn.endOperation).not.toHaveBeenCalled();
  });

  it('startOperation timeout ≤ 600 (GD clamp) and > BAKE_WAIT_TIMEOUT_MS (110)', async () => {
    await executor.execute('nav', { action: 'bake_mesh' });

    const t = mockConn.startOperation.mock.calls[0]![0] as number;
    expect(t).toBeLessThanOrEqual(600);
    expect(t).toBeGreaterThan(100);
  });

  it('finally: endOperation called even when request throws', async () => {
    mockConn.request.mockRejectedValueOnce(new Error('Plugin bake failed'));

    await executor.execute('nav', { action: 'bake_mesh' });

    expect(mockConn.startOperation).toHaveBeenCalledTimes(1);
    expect(mockConn.endOperation).toHaveBeenCalledTimes(1);
  });

  it('non-nav tool: does NOT call start/endOperation', async () => {
    registerTools([{ name: 'add_node', readonly: false, long_running: false }]);
    await executor.execute('add_node', { project_path: '/p', node_type: 'Node', node_name: 'X' });

    expect(mockConn.startOperation).not.toHaveBeenCalled();
    expect(mockConn.endOperation).not.toHaveBeenCalled();
  });

  // B-T1: nav bake 请求超时对齐
  it('nav bake_mesh: request includes timeoutMs 110000 (110s)', async () => {
    await executor.execute('nav', { action: 'bake_mesh', region_path: '/root/Nav' });

    // 验证 request 调用第三参包含 timeoutMs: 110000
    expect(mockConn.request).toHaveBeenCalledWith(
      'nav_bake_mesh',
      expect.objectContaining({ action: 'bake_mesh' }),
      { timeoutMs: 110000 }
    );
  });

  it('nav create_region with bake=true: request includes timeoutMs 110000', async () => {
    await executor.execute('nav', { action: 'create_region', bake: true });

    expect(mockConn.request).toHaveBeenCalledWith(
      'nav_create_region',
      expect.objectContaining({ bake: true }),
      { timeoutMs: 110000 }
    );
  });

  it('nav create_region with bake=false: request does NOT include custom timeoutMs', async () => {
    await executor.execute('nav', { action: 'create_region', bake: false });

    // 非 bake 调用不传第三参（使用默认 30s）
    expect(mockConn.request).toHaveBeenCalledWith(
      'nav_create_region',
      expect.objectContaining({ bake: false })
    );
    expect(mockConn.request).not.toHaveBeenCalledWith(
      'nav_create_region',
      expect.anything(),
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    );
  });

  it('non-nav tool: request does NOT include custom timeoutMs', async () => {
    registerTools([{ name: 'add_node', readonly: false, long_running: false }]);
    await executor.execute('add_node', { project_path: '/p', node_type: 'Node', node_name: 'X' });

    // 非 nav 工具不传第三参
    expect(mockConn.request).toHaveBeenCalledWith('add_node', expect.anything());
    expect(mockConn.request).not.toHaveBeenCalledWith(
      'add_node',
      expect.anything(),
      expect.anything()
    );
  });
});

// B-T3: 半开 HOL 预检（_executeInner healthMonitor.getState）
// TCP 半开时 conn.connected=true 但 editor 卡死，conn.request 挂满 30s；
// 串行 executeChain ×30s HOL 放大。注入 healthMonitor，reconnecting 即时返 NOT_CONNECTED。
describe('EditorToolExecutor HOL precheck (B-T3)', () => {
  let mockConn: MockConn;

  beforeEach(() => {
    clearRegistry();
    registerTools([{ name: 'add_node', readonly: false, long_running: false }]);
    mockConn = makeMockConn();
  });

  afterEach(() => {
    clearRegistry();
  });

  it('reconnecting state returns NOT_CONNECTED immediately, skips conn.request (no 30s HOL wait)', async () => {
    const hm = { getState: () => 'reconnecting' } as any;
    const executor = new EditorToolExecutor(
      mockConn as unknown as ConstructorParameters<typeof EditorToolExecutor>[0],
      hm,
    );
    // 若预检生效，conn.request 不应被调用；这里用 spy 兜底：一旦调用立即 fail
    mockConn.request.mockImplementation(async () => { throw new Error('should not reach — HOL precheck must short-circuit'); });

    const r = await executor.execute('add_node', { project_path: '/p', node_type: 'Node', node_name: 'X' });

    expect(r.isError).toBeTruthy();
    expect(JSON.stringify(r)).toMatch(/NOT_CONNECTED|reconnecting/i);
    // 反向断言：conn.request 未被调用（跳过 30s 等待）
    expect(mockConn.request).not.toHaveBeenCalled();
  });

  it('connected state dispatches normally (no false reject)', async () => {
    const hm = { getState: () => 'connected' } as any;
    const executor = new EditorToolExecutor(
      mockConn as unknown as ConstructorParameters<typeof EditorToolExecutor>[0],
      hm,
    );

    const r = await executor.execute('add_node', { project_path: '/p', node_type: 'Node', node_name: 'X' });

    expect(r.isError).toBeFalsy();
    expect(mockConn.request).toHaveBeenCalledTimes(1);
  });

  it('undefined healthMonitor (backward compat) dispatches normally', async () => {
    // 不注入 hm 的既有调用点（如测试 fixture）必须保持向后兼容
    const executor = new EditorToolExecutor(
      mockConn as unknown as ConstructorParameters<typeof EditorToolExecutor>[0],
    );

    const r = await executor.execute('add_node', { project_path: '/p', node_type: 'Node', node_name: 'X' });

    expect(r.isError).toBeFalsy();
    expect(mockConn.request).toHaveBeenCalledTimes(1);
  });
});
