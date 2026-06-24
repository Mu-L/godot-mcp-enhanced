import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock tool-registry — use vi.hoisted() so mock functions are available when vi.mock factory runs
const { mockSetActiveGroups, mockGetActiveGroups, mockGetGroupForTool } = vi.hoisted(() => ({
  mockSetActiveGroups: vi.fn(),
  mockGetActiveGroups: vi.fn(),
  mockGetGroupForTool: vi.fn(),
}));

vi.mock('../../src/core/tool-registry.js', () => ({
  TOOL_GROUPS: {
    core: { description: '核心工具', tools: ['project', 'scene'], requires: [], protected: true },
    animation: { description: '动画', tools: ['animation'], requires: [] },
    bridge: { description: 'Bridge', tools: ['game'], requires: ['bridge'] },
  },
  setActiveGroups: mockSetActiveGroups,
  getActiveGroups: mockGetActiveGroups,
  getGroupForTool: mockGetGroupForTool,
  notifyToolsChanged: vi.fn(),
  LEGACY_TOOL_MAP: {
    node_create_3d: { tool: 'scene', action: 'create_3d_node' },
  },
}));

vi.mock('../../src/tools/shared.js', () => ({
  opsSuccess: (data: unknown) => ({ success: true, data, warnings: [] }),
  opsError: (code: string, msg: string) => ({
    success: false,
    error: msg,
    error_code: code,
    warnings: [],
  }),
  opsErrorResult: (code: string, msg: string) => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ success: false, error: msg, error_code: code }),
      },
    ],
    isError: true,
  }),
}));
vi.mock('../../src/helpers.js', () => ({
  isPathInAllowedRoots: vi.fn().mockReturnValue(true),
}));
vi.mock('../../src/core/process-state.js', () => ({
  getRunningProcess: vi.fn().mockReturnValue(null),
  setRunningProcess: vi.fn(),
  getOutputBuffer: vi.fn().mockReturnValue([]),
  setOutputBuffer: vi.fn(),
  getProcessStartTime: vi.fn().mockReturnValue(0),
  setProcessStartTime: vi.fn(),
  getProjectDir: vi.fn().mockReturnValue(''),
  setProjectDir: vi.fn(),
}));
vi.mock('../../src/guard.js', () => ({
  requiresConfirmation: vi.fn().mockReturnValue(false),
}));

import { handleTool, getToolDefinitions, setConnectionStatusProvider, setReconnectEditor, buildConnectionStatus, buildReconnectEditor } from '../../src/tools/manage-tools.js';

describe('manage_tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActiveGroups.mockReturnValue(new Set(['core', 'animation', 'bridge']));
    setConnectionStatusProvider(null);
    setReconnectEditor(null);
  });

  it('getToolDefinitions returns single tool with action enum', () => {
    const defs = getToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('manage_tools');
    const schema = defs[0].inputSchema as Record<string, unknown>;
    expect(schema.properties).toHaveProperty('action');
  });

  it('list_groups returns all groups with status', async () => {
    const result = await handleTool('manage_tools', { action: 'list_groups' }, {} as any);
    const data = JSON.parse((result!.content as any)[0].text);
    expect(data.success).toBe(true);
    expect(data.data.groups).toBeDefined();
    expect(data.data.groups.length).toBeGreaterThan(0);
    const coreGroup = data.data.groups.find((g: any) => g.name === 'core');
    expect(coreGroup).toBeDefined();
    expect(coreGroup.protected).toBe(true);
  });

  it('activate adds groups to active set', async () => {
    mockSetActiveGroups.mockImplementation((groups: Set<string>) => groups);
    const result = await handleTool('manage_tools', {
      action: 'activate',
      groups: ['animation'],
    }, {} as any);
    const data = JSON.parse((result!.content as any)[0].text);
    expect(data.success).toBe(true);
    expect(mockSetActiveGroups).toHaveBeenCalled();
  });

  it('deactivate rejects protected groups', async () => {
    const result = await handleTool('manage_tools', {
      action: 'deactivate',
      groups: ['core'],
    }, {} as any);
    const data = JSON.parse((result!.content as any)[0].text);
    expect(data.success).toBe(false);
    expect(data.error).toContain('protected');
  });

  it('deactivate removes non-protected groups', async () => {
    mockSetActiveGroups.mockImplementation((groups: Set<string>) => groups);
    const result = await handleTool('manage_tools', {
      action: 'deactivate',
      groups: ['animation'],
    }, {} as any);
    const data = JSON.parse((result!.content as any)[0].text);
    expect(data.success).toBe(true);
  });

  it('reconnect 无 provider → editor=null + bridge no-op 说明', async () => {
    const result = await handleTool('manage_tools', { action: 'reconnect' }, {} as any);
    const data = JSON.parse((result!.content as any)[0].text);
    expect(data.success).toBe(true);
    expect(data.data.editor).toBeNull();
    expect(data.data.bridge.detail).toContain('无需重连');
  });

  it('reconnect 注入 reconnectEditor → 返回其结果', async () => {
    setReconnectEditor(async () => ({ connected: true, detail: '手动重连完成' }));
    const result = await handleTool('manage_tools', { action: 'reconnect' }, {} as any);
    const data = JSON.parse((result!.content as any)[0].text);
    expect(data.data.editor).toEqual({ reconnected: true, detail: '手动重连完成' });
  });

  it('sync 无 provider → status 为 unknown', async () => {
    const result = await handleTool('manage_tools', { action: 'sync' }, {} as any);
    const data = JSON.parse((result!.content as any)[0].text);
    const bridgeGroup = data.data.groups.find((g: any) => g.name === 'bridge');
    expect(bridgeGroup.status).toContain('unknown');
  });

  it('sync 注入 provider → requires 映射状态', async () => {
    setConnectionStatusProvider(() => ({
      editor: { installed: true, connected: true, state: 'connected' },
      bridge: { note: '每请求建连' },
    }));
    const result = await handleTool('manage_tools', { action: 'sync' }, {} as any);
    const data = JSON.parse((result!.content as any)[0].text);
    // mock TOOL_GROUPS 含 core(requires [])/animation([])/bridge(['bridge'])
    const byName = Object.fromEntries(data.data.groups.map((g: any) => [g.name, g]));
    expect(byName.core.status).toBe('n/a');        // requires []
    expect(byName.animation.status).toBe('n/a');   // requires []
    expect(byName.bridge.status).toBe('probe-required'); // requires ['bridge']
    expect(data.data.editor.connected).toBe(true);
  });
});

describe('buildConnectionStatus / buildReconnectEditor 工厂', () => {
  it('buildConnectionStatus 映射 editorConn + healthMonitor', () => {
    const ec = { isConnected: () => true } as any;
    const hm = { getState: () => 'connected' } as any;
    const cs = buildConnectionStatus(ec, hm);
    expect(cs.editor).toEqual({ installed: true, connected: true, state: 'connected' });
    expect(cs.bridge.note).toBeTruthy();

    const cs2 = buildConnectionStatus(null, null);
    expect(cs2.editor).toEqual({ installed: false, connected: false, state: null });
  });

  it('buildReconnectEditor: 已连接 → 不调 connect', async () => {
    const ec = { isConnected: () => true, connect: vi.fn() };
    const fn = buildReconnectEditor(() => ec as any);
    const r = await fn();
    expect(ec.connect).not.toHaveBeenCalled();
    expect(r).toEqual({ connected: true, detail: '已连接' });
  });

  it('buildReconnectEditor: 未连接 → 调 connect', async () => {
    const ec = { isConnected: () => false, connect: vi.fn(async () => { ec.isConnected = () => true; }) };
    const fn = buildReconnectEditor(() => ec as any);
    const r = await fn();
    expect(ec.connect).toHaveBeenCalled();
    expect(r.connected).toBe(true);
  });

  it('buildReconnectEditor: 无 editorConn → 提示 launch_editor', async () => {
    const fn = buildReconnectEditor(() => null);
    const r = await fn();
    expect(r.connected).toBe(false);
    expect(r.detail).toContain('launch_editor');
  });
});
