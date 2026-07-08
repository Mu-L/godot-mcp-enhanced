import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getLogger, setLoggerServer, setLoggerClientReady, resetLogger } from '../../src/core/logger.js';

describe('MCP Logging emitToClient', () => {
  let mockServer: { sendLoggingMessage: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    resetLogger();
    mockServer = { sendLoggingMessage: vi.fn() };
  });

  it('warn 触发 sendLoggingMessage（level=warning, logger=module, data.msg）', () => {
    setLoggerServer(mockServer as any);
    setLoggerClientReady(true);
    getLogger().warn('mymodule', 'something wrong');
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledTimes(1);
    const params = mockServer.sendLoggingMessage.mock.calls[0][0];
    expect(params.level).toBe('warning');
    expect(params.logger).toBe('mymodule');
    expect(params.data.msg).toBe('something wrong');
    expect(params.data.module).toBe('mymodule');
  });

  it('error 触发 sendLoggingMessage（level=error）', () => {
    setLoggerServer(mockServer as any);
    setLoggerClientReady(true);
    getLogger().error('mod', 'bad');
    const params = mockServer.sendLoggingMessage.mock.calls[0][0];
    expect(params.level).toBe('error');
  });

  it('info 不触发 sendLoggingMessage', () => {
    setLoggerServer(mockServer as any);
    setLoggerClientReady(true);
    getLogger().info('mod', 'hi');
    expect(mockServer.sendLoggingMessage).not.toHaveBeenCalled();
  });

  it('debug 不触发 sendLoggingMessage', () => {
    setLoggerServer(mockServer as any);
    setLoggerClientReady(true);
    getLogger().debug('mod', 'trace');
    expect(mockServer.sendLoggingMessage).not.toHaveBeenCalled();
  });

  it('clientReady=false 不触发（client 未 initialize）', () => {
    setLoggerServer(mockServer as any);
    setLoggerClientReady(false);
    getLogger().warn('mod', 'msg');
    expect(mockServer.sendLoggingMessage).not.toHaveBeenCalled();
  });

  it('未注入 server（_mcpServer=null）不触发 —— 证明现有测试零回归', () => {
    setLoggerClientReady(true);
    getLogger().warn('mod', 'msg');
    expect(mockServer.sendLoggingMessage).not.toHaveBeenCalled();
  });

  it('sendLoggingMessage async reject 静默不崩（fire-and-forget .catch）', async () => {
    mockServer.sendLoggingMessage = vi.fn(() => Promise.reject(new Error('send fail')));
    setLoggerServer(mockServer as any);
    setLoggerClientReady(true);
    expect(() => getLogger().warn('mod', 'msg')).not.toThrow();
    await new Promise(r => setTimeout(r, 10));  // 等 microtask 让 reject settle
  });

  it('sendLoggingMessage 同步 throw 静默不崩（try/catch）', () => {
    mockServer.sendLoggingMessage = vi.fn(() => { throw new Error('sync throw'); });
    setLoggerServer(mockServer as any);
    setLoggerClientReady(true);
    expect(() => getLogger().warn('mod', 'msg')).not.toThrow();
  });

  it('resetLogger 清理 _mcpServer/_clientReady（后续 warn 不发）', () => {
    setLoggerServer(mockServer as any);
    setLoggerClientReady(true);
    resetLogger();  // 清理
    getLogger().warn('mod', 'after reset');
    expect(mockServer.sendLoggingMessage).not.toHaveBeenCalled();
  });
});
