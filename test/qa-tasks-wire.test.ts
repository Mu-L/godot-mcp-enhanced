// test/qa-tasks-wire.test.ts — PR-2 Task 3: GodotServer tasks wire 层全链
//
// 真实 SDK + InMemoryTransport(照 K-2 Part 2 先例;仓库无 @modelcontextprotocol/client
// 直接依赖,客户端侧手写 initialize 握手声明 clientCapabilities.tasks)。不 mock SDK——
// 本测试的价值恰在真实分发层:capabilities 回显 / 字符串 method 路由 / handler 抛错转
// JSON-RPC error / notification 直达客户端 transport。
//
// 实测锚点(2026-08-17,SDK 2.x):
// - Server.prototype.notification(...)(无 sendNotification);声明 tasks capability 后
//   直发 notifications/tasks/status 不被 assertNotificationCapability 拦,客户端可收。
// - tasks/* 未注册时 SDK 分发层返回 -32601(era 门控兜底);已注册字符串 method 优先分发。
// - 3 参 schema 重载:缺 taskId → SDK 自动 -32602;handler 抛普通 Error → -32603(消息保留)。
// - 测试不依赖 tools/call qa run(会真跑 bridge;全链留 Task 4)。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import type { Server } from '@modelcontextprotocol/server';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GodotServer } from '../src/GodotServer.js';
import { registerRun, updateProgress, finishRun, clearRegistry } from '../src/tools/qa/registry.js';
import { AUDIT_LOG_REL } from '../src/core/audit-log.js';

// ─── 测试侧最小 JSON-RPC 客户端(手写握手,替代 SDK Client) ───────────────────

interface JsonRpcResponse { result?: unknown; error?: { code: number; message: string } }
interface WireNotification { method: string; params?: Record<string, unknown> }

interface TestClient {
  request(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse>;
  notifications: WireNotification[];
}

/**
 * 起真实 GodotServer + InMemoryTransport,完成 initialize 握手。
 * clientCapabilities 声明形态由调用方控制(tasks 能力门控测试的关键)。
 */
async function startServer(clientCapabilities?: Record<string, unknown>): Promise<{ gs: GodotServer; tc: TestClient }> {
  const gs = new GodotServer('/fake/ops.gd');
  const server = (gs as unknown as { server: Server }).server;
  const [sT, cT] = InMemoryTransport.createLinkedPair();
  await server.connect(sT);

  const pending: Array<(m: unknown) => void> = [];
  const notifications: WireNotification[] = [];
  cT.onmessage = (m: unknown) => {
    const msg = m as { id?: unknown; method?: string };
    if (msg.id === undefined && msg.method !== undefined) {
      notifications.push(msg as WireNotification); // server→client notification(无 id)
    } else {
      pending.shift()?.(m);                        // response(id 有)
    }
  };

  let nextId = 1;
  const request = (method: string, params?: Record<string, unknown>) =>
    new Promise<JsonRpcResponse>((resolve) => {
      pending.push(resolve as (m: unknown) => void);
      void cT.send({ jsonrpc: '2.0', id: nextId++, method, params } as never);
    });

  const init = await request('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: clientCapabilities ?? {},
    clientInfo: { name: 'tasks-wire-test', version: '1.0.0' },
  });
  if (init.error) throw new Error(`initialize failed: ${JSON.stringify(init.error)}`);
  await cT.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as never);

  return { gs, tc: { request, notifications } };
}

// ─── 测试 ────────────────────────────────────────────────────────────────────

describe('tasks wire layer(PR-2 Task 3)', () => {
  let tmpDir: string;

  beforeEach(() => {
    clearRegistry();
    delete process.env.GODOT_MCP_AUDIT; // 默认开(isAuditEnabled: undefined → true)
    tmpDir = mkdtempSync(join(tmpdir(), 'qa-tasks-wire-'));
  });

  afterEach(() => {
    clearRegistry();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('initialize 后 server capabilities 含 tasks(细粒度 list/cancel/requests.tools.call)', async () => {
    const { gs, tc } = await startServer();
    try {
      const init = await tc.request('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 're-init', version: '1.0.0' },
      });
      const caps = (init.result as { capabilities?: { tasks?: unknown } }).capabilities;
      expect(caps?.tasks).toEqual({ list: {}, cancel: {}, requests: { tools: { call: {} } } });
    } finally {
      await gs.close();
    }
  });

  it('tasks/list 返回注册表条目(wire 五字段,ttl 秒)', async () => {
    const { gs, tc } = await startServer();
    try {
      registerRun('run-list-1', 'suite-x', tmpDir, 3);
      const res = await tc.request('tasks/list');
      const tasks = (res.result as { tasks?: Array<Record<string, unknown>> }).tasks ?? [];
      expect(tasks).toHaveLength(1);
      const t = tasks[0]!;
      expect(t.taskId).toBe('run-list-1');
      expect(t.status).toBe('working');
      expect(t.ttl).toBe(3600); // registry 3_600_000ms → wire 秒
      expect(typeof t.createdAt).toBe('string');
      expect(typeof t.lastUpdatedAt).toBe('string');
    } finally {
      await gs.close();
    }
  });

  it('tasks/get:working 带 statusMessage;终态 status 直映', async () => {
    const { gs, tc } = await startServer();
    try {
      registerRun('run-get-1', 'suite-x', tmpDir, 3);
      updateProgress('run-get-1', 1, 3, 'wait_for_node');
      const working = await tc.request('tasks/get', { taskId: 'run-get-1' });
      expect(working.error).toBeUndefined();
      expect((working.result as { status?: string }).status).toBe('working');
      expect((working.result as { statusMessage?: string }).statusMessage).toBe('step 1/3: wait_for_node');

      finishRun('run-get-1', 'completed');
      const done = await tc.request('tasks/get', { taskId: 'run-get-1' });
      expect((done.result as { status?: string }).status).toBe('completed');
      expect((done.result as { statusMessage?: string }).statusMessage).toBeUndefined();
    } finally {
      await gs.close();
    }
  });

  it('tasks/get 未知 taskId → JSON-RPC error(code/-32603,消息含 taskId);缺 taskId → SDK 校验 -32602', async () => {
    const { gs, tc } = await startServer();
    try {
      const notFound = await tc.request('tasks/get', { taskId: 'no-such-task' });
      expect(notFound.error).toBeDefined();
      expect(notFound.error!.code).toBe(-32603); // SDK 默认:handler 抛普通 Error → internal error
      expect(notFound.error!.message).toContain('no-such-task');

      const missingParam = await tc.request('tasks/get', {});
      expect(missingParam.error!.code).toBe(-32602); // 3 参 schema 重载:SDK zod 校验
      expect(missingParam.error!.message).toContain('taskId');
    } finally {
      await gs.close();
    }
  });

  it('tasks/cancel working → ok(taskId 回显,仍 working);且写 audit line(action:"tasks/cancel")', async () => {
    const { gs, tc } = await startServer();
    try {
      registerRun('run-cancel-1', 'suite-x', tmpDir, 2);
      const res = await tc.request('tasks/cancel', { taskId: 'run-cancel-1' });
      expect(res.error).toBeUndefined();
      expect((res.result as { taskId?: string }).taskId).toBe('run-cancel-1');
      // cancel 置 cancelRequested,不改 status(cancelled 由终态通知送)→ wire 仍 working
      expect((res.result as { status?: string }).status).toBe('working');

      const auditPath = join(tmpDir, ...AUDIT_LOG_REL);
      expect(existsSync(auditPath)).toBe(true);
      const lines = readFileSync(auditPath, 'utf8').split(/\r?\n/).filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      const entry = JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
      expect(entry.action).toBe('tasks/cancel');
      expect(entry.tool).toBe('qa');
      expect(entry.ok).toBe(true);
      expect(entry.trace_id).toContain('run-cancel-1');
    } finally {
      await gs.close();
    }
  });

  it('tasks/cancel 终态/未知 → JSON-RPC error', async () => {
    const { gs, tc } = await startServer();
    try {
      registerRun('run-cancel-2', 'suite-x', tmpDir, 2);
      finishRun('run-cancel-2', 'completed');
      const terminal = await tc.request('tasks/cancel', { taskId: 'run-cancel-2' });
      expect(terminal.error).toBeDefined();
      expect(terminal.error!.message).toContain('不可取消');

      const unknown = await tc.request('tasks/cancel', { taskId: 'no-such-task' });
      expect(unknown.error).toBeDefined();
      expect(unknown.error!.message).toContain('no-such-task');
    } finally {
      await gs.close();
    }
  });

  it('tasks/result:终态返回 payload(run_id/summary/error);working → error', async () => {
    const { gs, tc } = await startServer();
    try {
      registerRun('run-result-1', 'suite-x', tmpDir, 2);
      const working = await tc.request('tasks/result', { taskId: 'run-result-1' });
      expect(working.error).toBeDefined();
      expect(working.error!.message).toContain('not terminal');

      finishRun('run-result-1', 'failed', undefined, undefined, 'boom: suite 执行异常');
      const done = await tc.request('tasks/result', { taskId: 'run-result-1' });
      expect(done.error).toBeUndefined();
      const payload = (done.result as { payload?: Record<string, unknown> }).payload;
      expect(payload!.run_id).toBe('run-result-1');
      expect(payload!.error).toBe('boom: suite 执行异常');
    } finally {
      await gs.close();
    }
  });

  it('终态通知:客户端声明 tasks 能力 → finishRun 触发 notifications/tasks/status(五字段)', async () => {
    const { gs, tc } = await startServer({ tasks: { listChanged: true } });
    try {
      registerRun('run-notify-1', 'suite-x', tmpDir, 2);
      finishRun('run-notify-1', 'completed');
      await new Promise((r) => setTimeout(r, 50)); // 等 notification 异步派发

      const notes = tc.notifications.filter((n) => n.method === 'notifications/tasks/status');
      expect(notes).toHaveLength(1);
      const p = notes[0]!.params!;
      expect(p.taskId).toBe('run-notify-1');
      expect(p.status).toBe('completed');
      expect(p.ttl).toBe(3600);
      expect(typeof p.createdAt).toBe('string');
      expect(typeof p.lastUpdatedAt).toBe('string');
    } finally {
      await gs.close();
    }
  });

  it('终态通知:未声明 tasks 能力的客户端 → 不发(协议门控)', async () => {
    const { gs, tc } = await startServer(); // 无 clientCapabilities.tasks
    try {
      registerRun('run-notify-2', 'suite-x', tmpDir, 2);
      finishRun('run-notify-2', 'completed');
      await new Promise((r) => setTimeout(r, 50));
      expect(tc.notifications.filter((n) => n.method === 'notifications/tasks/status')).toHaveLength(0);
    } finally {
      await gs.close();
    }
  });

  it('无 tasks 能力客户端的现状零破坏:tools/list 照旧返回工具清单', async () => {
    const { gs, tc } = await startServer(); // 无 tasks 能力声明
    try {
      const res = await tc.request('tools/list');
      expect(res.error).toBeUndefined();
      const tools = (res.result as { tools?: Array<{ name: string }> }).tools ?? [];
      expect(tools.length).toBeGreaterThan(0); // 工具清单照常可列
    } finally {
      await gs.close();
    }
  });
});
