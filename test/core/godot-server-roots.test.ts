import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pathToFileURL } from 'node:url';

// ─── Mock MCP SDK Server 类——可控 oninitialized / getClientCapabilities / ─────
// listRoots / setNotificationHandler（驱动 SDK 不 await 的 async 钩子）
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => {
  return {
    Server: class {
      oninitialized: (() => void) | null = null;
      private notifHandler: ((...args: unknown[]) => void | Promise<void>) | null = null;
      private caps: Record<string, unknown> = {};
      private listRootsResult: { roots: Array<{ uri: string }> } = { roots: [] };
      private listRootsImpl: (() => Promise<{ roots: Array<{ uri: string }> }>) | null = null;
      setRequestHandler() {}
      setNotificationHandler(_schema: unknown, fn: (...args: unknown[]) => void | Promise<void>) {
        this.notifHandler = fn;
      }
      getClientCapabilities() { return this.caps; }
      async listRoots() {
        if (this.listRootsImpl) return this.listRootsImpl();
        return this.listRootsResult;
      }
      async connect() {}
      async close() {}
      async start() {}
      // 测试驱动钩子
      __setCaps(c: Record<string, unknown>) { this.caps = c; }
      __setListRootsResult(r: { roots: Array<{ uri: string }> }) {
        this.listRootsResult = r;
        this.listRootsImpl = null;
      }
      __setListRootsImpl(fn: (() => Promise<{ roots: Array<{ uri: string }> }>) | null) {
        this.listRootsImpl = fn;
      }
      get __notifHandler() { return this.notifHandler; }
    },
  };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn().mockImplementation(function () { return {}; }),
}));

vi.mock('@modelcontextprotocol/sdk/types.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // 真实 schema 对象（setNotificationHandler 第二参数），但 mock Server 不消费它
    RootsListChangedNotificationSchema: { _def: { typeName: 'ZodObject', shape: {} } },
  };
});

// ─── Mock fs to control detectProjectPath behavior ───────────────────────────
const { mockExistsSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn().mockReturnValue(false),
}));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, existsSync: mockExistsSync };
});

// ─── Mock editor auth (avoids real network/file access) ─────────────────────
const { mockWaitForEditorSecret } = vi.hoisted(() => ({
  mockWaitForEditorSecret: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../src/core/editor-auth.js', () => ({
  waitForEditorSecret: (...args: unknown[]) => mockWaitForEditorSecret(...args),
}));

// ─── Mock EditorConnection and EditorToolExecutor ───────────────────────────
vi.mock('../../src/core/EditorConnection.js', () => ({
  EditorConnection: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockRejectedValue(new Error('no editor')),
    disconnect: vi.fn(),
  })),
}));

vi.mock('../../src/core/EditorToolExecutor.js', () => ({
  EditorToolExecutor: vi.fn().mockImplementation(() => ({
    execute: vi.fn(),
    destroy: vi.fn(),
  })),
}));

// ─── Mock process-state to avoid real process management ────────────────────
vi.mock('../../src/core/process-state.js', () => ({
  getRunningProcess: vi.fn().mockReturnValue(null),
  setRunningProcess: vi.fn(),
  getOutputBuffer: vi.fn().mockReturnValue([]),
  setOutputBuffer: vi.fn(),
  getProcessStartTime: vi.fn().mockReturnValue(0),
  setProcessStartTime: vi.fn(),
  getProjectDir: vi.fn().mockReturnValue(''),
  setProjectDir: vi.fn(),
  killProcess: vi.fn().mockResolvedValue(undefined),
  // B-T4: close() 清理 in-flight gdscript spawn（默认空集，无 orphan）
  getSpawnedGodotPids: vi.fn().mockReturnValue([]),
  killPidTree: vi.fn(),
  unregisterSpawnedGodotPid: vi.fn(),
}));

// ─── Import SUT (after mocks) ────────────────────────────────────────────────
import { GodotServer } from '../../src/GodotServer.js';
import {
  setAllowedRootsFromClient,
  hasDynamicRoots,
} from '../../src/core/path-utils.js';

// Helper: 从 GodotServer 实例取出 mock Server（与 constructor 中 this.server 同源）
function getMockServer(s: GodotServer): any {
  return (s as unknown as { server: any }).server;
}

// 生成跨平台合法 file URL（Windows file:///projA 抛 ERR_INVALID_FILE_URL_PATH）
const fileUrl = (p: string): string => pathToFileURL(p).href;

describe('GodotServer Roots integration (Task 3)', () => {
  let server: GodotServer;
  let mockServerInstance: any;

  beforeEach(() => {
    setAllowedRootsFromClient(null);
    delete process.env.ALLOWED_PROJECT_PATHS;
  });

  afterEach(async () => {
    if (server) {
      await server.close().catch(() => {});
    }
    vi.restoreAllMocks();
    setAllowedRootsFromClient(null);
  });

  it('client 支持 Roots + 返回非空 → 注入（替换 env）', async () => {
    server = new GodotServer('fake.gd', { connectionMode: 'headless' });
    mockServerInstance = getMockServer(server);
    mockServerInstance.__setCaps({ roots: {} });
    mockServerInstance.__setListRootsResult({ roots: [{ uri: fileUrl('/projA') }] });
    expect(mockServerInstance.oninitialized).toBeTruthy();
    await mockServerInstance.oninitialized();
    expect(hasDynamicRoots()).toBe(true);
  });

  it('client 不支持 Roots → 不注入（用 env baseline）', async () => {
    server = new GodotServer('fake.gd', { connectionMode: 'headless' });
    mockServerInstance = getMockServer(server);
    mockServerInstance.__setCaps({});  // 无 roots
    await mockServerInstance.oninitialized();
    expect(hasDynamicRoots()).toBe(false);
  });

  it('initial listRoots 抛错 → 回落 env baseline', async () => {
    server = new GodotServer('fake.gd', { connectionMode: 'headless' });
    mockServerInstance = getMockServer(server);
    mockServerInstance.__setCaps({ roots: {} });
    mockServerInstance.__setListRootsImpl(async () => { throw new Error('boom'); });
    await mockServerInstance.oninitialized();
    expect(hasDynamicRoots()).toBe(false);  // fail-to-env-baseline
  });

  it('initial roots 全部无效（非 file:）→ 回落 env baseline', async () => {
    server = new GodotServer('fake.gd', { connectionMode: 'headless' });
    mockServerInstance = getMockServer(server);
    mockServerInstance.__setCaps({ roots: {} });
    mockServerInstance.__setListRootsResult({ roots: [{ uri: 'http://x' }] });
    await mockServerInstance.oninitialized();
    expect(hasDynamicRoots()).toBe(false);
  });

  it('list_changed re-fetch 成功非空 → 替换', async () => {
    server = new GodotServer('fake.gd', { connectionMode: 'headless' });
    mockServerInstance = getMockServer(server);
    mockServerInstance.__setCaps({ roots: {} });
    mockServerInstance.__setListRootsResult({ roots: [{ uri: fileUrl('/initial') }] });
    await mockServerInstance.oninitialized();
    expect(hasDynamicRoots()).toBe(true);

    mockServerInstance.__setListRootsResult({ roots: [{ uri: fileUrl('/updated') }] });
    const notifHandler = mockServerInstance.__notifHandler;
    expect(notifHandler).toBeTruthy();
    await notifHandler();
    expect(hasDynamicRoots()).toBe(true);  // 仍是 roots 态（已替换）
  });

  it('list_changed re-fetch 抛错 + 已有 roots → 保留旧 roots（不静默切）', async () => {
    server = new GodotServer('fake.gd', { connectionMode: 'headless' });
    mockServerInstance = getMockServer(server);
    mockServerInstance.__setCaps({ roots: {} });
    mockServerInstance.__setListRootsResult({ roots: [{ uri: fileUrl('/initial') }] });
    await mockServerInstance.oninitialized();
    expect(hasDynamicRoots()).toBe(true);

    mockServerInstance.__setListRootsImpl(async () => { throw new Error('refetch boom'); });
    const notifHandler = mockServerInstance.__notifHandler;
    expect(notifHandler).toBeTruthy();
    await notifHandler();
    expect(hasDynamicRoots()).toBe(true);  // 保留旧 roots（关键安全契约）
  });

  it('list_changed re-fetch 返回空 + 已有 roots → 保留旧 roots', async () => {
    server = new GodotServer('fake.gd', { connectionMode: 'headless' });
    mockServerInstance = getMockServer(server);
    mockServerInstance.__setCaps({ roots: {} });
    mockServerInstance.__setListRootsResult({ roots: [{ uri: fileUrl('/initial') }] });
    await mockServerInstance.oninitialized();
    expect(hasDynamicRoots()).toBe(true);

    mockServerInstance.__setListRootsResult({ roots: [] });
    const notifHandler = mockServerInstance.__notifHandler;
    expect(notifHandler).toBeTruthy();
    await notifHandler();
    expect(hasDynamicRoots()).toBe(true);  // 保留旧 roots
  });

  it('close() → 清理 dynamic roots（回落 env）', async () => {
    server = new GodotServer('fake.gd', { connectionMode: 'headless' });
    mockServerInstance = getMockServer(server);
    mockServerInstance.__setCaps({ roots: {} });
    mockServerInstance.__setListRootsResult({ roots: [{ uri: fileUrl('/x') }] });
    await mockServerInstance.oninitialized();
    expect(hasDynamicRoots()).toBe(true);

    await server.close();
    expect(hasDynamicRoots()).toBe(false);  // close 清理
    server = undefined as unknown as GodotServer;  // 防 afterEach 二次 close
  });
});
