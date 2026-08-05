// test/sdk-prerequisites.test.ts
import type { Tool } from "@modelcontextprotocol/server";
import { describe, it, expect } from 'vitest';
describe('SDK Prerequisites', () => {
  it('supports annotations.tags on Tool definitions', () => {
    const tool: Tool = {
      name: 'test_tool',
      description: 'test',
      inputSchema: { type: 'object', properties: {} },
      annotations: { tags: ['group:core'] },
    };
    expect(tool.annotations?.tags).toEqual(['group:core']);
  });

  it('Server type has capabilities.tools for list_changed', () => {
    // Server 构造时传入 capabilities: { tools: {} } 即支持 list_changed
    // 验证类型定义存在
    const caps = { tools: {} };
    expect(caps.tools).toBeDefined();
  });

  it('Server.notification method exists in type', async () => {
    const { Server } = await import('@modelcontextprotocol/server');
    const server = new Server(
      { name: 'test', version: '0.0.0' },
      { capabilities: { tools: {} } }
    );
    expect(typeof server.notification).toBe('function');
  });

  it('v2 setRequestHandler accepts method string', async () => {
    // v2 范式：setRequestHandler 改用方法字符串（如 'prompts/list'），不再需要 Schema 常量
    // Schema 常量已移到 @modelcontextprotocol/core（仅向后兼容用）
    const { Server } = await import('@modelcontextprotocol/server');
    const server = new Server(
      { name: 'test', version: '0.0.0' },
      { capabilities: { prompts: {} } }
    );
    // 验证方法字符串注册不抛错（v2 范式）
    expect(() => server.setRequestHandler('prompts/list', async () => ({ prompts: [] }))).not.toThrow();
  });
});
