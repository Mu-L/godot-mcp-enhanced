// test/core/instance-http-server.test.ts
// 行225 MULTI_INSTANCE 接收端 HTTP server 集成测试（真 http，不 mock）。
// 验证 verifyApiToken 闭环：HMAC 签名验证 + 转发 dispatcher + 安全防御。
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock homedir 到临时目录（instance-api-auth 的 secret 文件隔离）
const MOCK_HOME = join(tmpdir(), `mcp-http-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => MOCK_HOME };
});

// Mock dispatcher：只测 HTTP 层验签 + 转发，不跑真工具逻辑。
// vi.mock factory 不能引用外部变量（hoisting），用 vi.hoisted 提升 mockHandleCall。
const { mockHandleCall } = vi.hoisted(() => ({ mockHandleCall: vi.fn() }));
vi.mock('../../src/core/ToolDispatcher.js', () => {
  return {
    ToolDispatcher: class MockDispatcher {
      handleCall = mockHandleCall;
    },
  };
});

import { InstanceHttpServer } from '../../src/core/instance-http-server.js';
import { generateApiToken, clearCachedSecret } from '../../src/core/instance-api-auth.js';
import { mkdirSync, rmSync } from 'fs';
import type { ToolDispatcher } from '../../src/core/ToolDispatcher.js';

const TEST_INSTANCE_ID = 'ts-test-12345-abcdef';
const MOCK_REGISTRY = join(MOCK_HOME, '.godot-mcp');

let server: InstanceHttpServer;
let baseUrl: string;
let port: number;

// 找一个空闲端口（避免硬编码，防 CI 并行冲突）
async function findFreePort(): Promise<number> {
  const { createServer } = await import('node:http');
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      if (addr && typeof addr === 'object') {
        const p = addr.port;
        s.close(() => resolve(p));
      } else {
        s.close();
        reject(new Error('cannot find free port'));
      }
    });
    s.on('error', reject);
  });
}

beforeAll(async () => {
  mkdirSync(MOCK_REGISTRY, { recursive: true });
  port = await findFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = new InstanceHttpServer({
    port,
    instanceId: TEST_INSTANCE_ID,
    dispatcher: { handleCall: mockHandleCall } as unknown as ToolDispatcher,
  });
  await server.start();
});

afterAll(async () => {
  await server.stop();
  try { rmSync(MOCK_HOME, { recursive: true, force: true }); } catch { /* ok */ }
});

beforeEach(() => {
  mockHandleCall.mockReset();
  clearCachedSecret();
});

afterEach(() => {
  clearCachedSecret();
});

describe('InstanceHttpServer HMAC 闭环', () => {
  it('H1 有效签名 → verifyApiToken 通过 → 转发 dispatcher → 200', async () => {
    mockHandleCall.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"ok":true}' }],
    });
    const token = generateApiToken(TEST_INSTANCE_ID);
    const resp = await fetch(`${baseUrl}/api/script`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'execute', project_path: '/fake' }),
    });
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.content[0].text).toBe('{"ok":true}');
    // 验证 dispatcher 收到正确的 name + arguments
    expect(mockHandleCall).toHaveBeenCalledOnce();
    const callArg = mockHandleCall.mock.calls[0]![0];
    expect(callArg.params.name).toBe('script');
    expect(callArg.params.arguments.action).toBe('execute');
  });

  it('H2 无 Authorization header → 401', async () => {
    const resp = await fetch(`${baseUrl}/api/script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(resp.status).toBe(401);
    expect(mockHandleCall).not.toHaveBeenCalled();
  });

  it('H3 篡改签名 → 401', async () => {
    // 用正确 instanceId 生成 token，但篡改 hmac 部分
    const token = generateApiToken(TEST_INSTANCE_ID);
    const parts = token.split('.');
    const tampered = `${parts[0]}.${parts[1]}.deadbeef`;
    const resp = await fetch(`${baseUrl}/api/script`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tampered}` },
      body: '{}',
    });
    expect(resp.status).toBe(401);
    expect(mockHandleCall).not.toHaveBeenCalled();
  });

  it('H4 过期 token（timestamp +120s 超过 60s TTL）→ 401', async () => {
    // 构造过期 token：手动拼 timestamp 在 120s 前
    const { getOrCreateApiSecret } = await import('../../src/core/instance-api-auth.js');
    const { createHmac, randomBytes } = await import('node:crypto');
    const secret = getOrCreateApiSecret();
    const oldTs = Date.now() - 120_000; // 120s 前，超过 60s TTL
    const nonce = randomBytes(8).toString('hex');
    const hmac = createHmac('sha256', secret)
      .update(`${TEST_INSTANCE_ID}:${oldTs}:${nonce}`)
      .digest('hex');
    const expiredToken = `${oldTs}.${nonce}.${hmac}`;
    const resp = await fetch(`${baseUrl}/api/script`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${expiredToken}` },
      body: '{}',
    });
    expect(resp.status).toBe(401);
    expect(mockHandleCall).not.toHaveBeenCalled();
  });

  it('H5 重放攻击（同一有效 token 第二次）→ 401（nonce 防重放）', async () => {
    mockHandleCall.mockResolvedValue({ content: [{ type: 'text', text: '{}' }] });
    const token = generateApiToken(TEST_INSTANCE_ID);
    // 第一次：成功
    const resp1 = await fetch(`${baseUrl}/api/script`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: '{}',
    });
    expect(resp1.status).toBe(200);
    // 第二次：同一 token（同 nonce）→ 重放，拒绝
    const resp2 = await fetch(`${baseUrl}/api/script`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: '{}',
    });
    expect(resp2.status).toBe(401);
  });

  it('H6 非法 tool 名（路径注入）→ 400', async () => {
    const token = generateApiToken(TEST_INSTANCE_ID);
    const resp = await fetch(`${baseUrl}/api/..%2Fetc%2fpasswd`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: '{}',
    });
    // decodeURIComponent 后是 ../etc/passwd，不匹配 ^[a-zA-Z_][a-zA-Z0-9_]*$
    expect(resp.status).toBe(400);
    expect(mockHandleCall).not.toHaveBeenCalled();
  });

  it('H7 GET 方法 → 405', async () => {
    const token = generateApiToken(TEST_INSTANCE_ID);
    const resp = await fetch(`${baseUrl}/api/script`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    expect(resp.status).toBe(405);
    expect(mockHandleCall).not.toHaveBeenCalled();
  });

  it('H8 非 /api 路径 → 404', async () => {
    const token = generateApiToken(TEST_INSTANCE_ID);
    const resp = await fetch(`${baseUrl}/foo/bar`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: '{}',
    });
    expect(resp.status).toBe(404);
    expect(mockHandleCall).not.toHaveBeenCalled();
  });

  it('H9 dispatcher 抛错 → 500（不泄露内部错误细节）', async () => {
    mockHandleCall.mockRejectedValueOnce(new Error('internal boom'));
    const token = generateApiToken(TEST_INSTANCE_ID);
    const resp = await fetch(`${baseUrl}/api/script`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: '{}',
    });
    expect(resp.status).toBe(500);
    const data = await resp.json();
    expect(data.error).toBe('Internal server error.');
    expect(JSON.stringify(data)).not.toContain('internal boom'); // 不泄露内部错误
  });
});
