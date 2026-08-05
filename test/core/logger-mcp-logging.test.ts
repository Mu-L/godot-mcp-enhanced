import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getLogger, setLoggerServer, setLoggerClientReady, resetLogger, withRequestLogLevel, withRequestLogLevelAsync, getCurrentRequestLogLevel } from '../../src/core/logger.js';

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

  it('错误 toolEnd（error 级）触发 sendLoggingMessage（level=error）', () => {
    setLoggerServer(mockServer as any);
    setLoggerClientReady(true);
    const logger = getLogger();
    const callId = logger.toolStart('mytool', { x: 1 });
    logger.toolEnd(callId, 'mytool', 100, 'something failed');
    // toolStart 是 info（不发），toolEnd 带错是 error 级（发）
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledTimes(1);
    const params = mockServer.sendLoggingMessage.mock.calls[0][0];
    expect(params.level).toBe('error');
  });
});

// P1-7 (SEP-2577): per-request logLevel 过滤
describe('P1-7 per-request logLevel filtering', () => {
  let mockServer: { sendLoggingMessage: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    resetLogger();
    mockServer = { sendLoggingMessage: vi.fn() };
    setLoggerServer(mockServer as any);
    setLoggerClientReady(true);
  });

  it('withRequestLogLevel(null,...) 保持旧行为(仅 warn/error 发,info/debug 不发)', () => {
    const logger = getLogger();
    withRequestLogLevel(null, () => {
      logger.debug('mod', 'd');
      logger.info('mod', 'i');
      logger.warn('mod', 'w');
      logger.error('mod', 'e');
    });
    // null = 旧行为:仅 warn/error
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledTimes(2);
    const levels = mockServer.sendLoggingMessage.mock.calls.map((c: unknown[]) => (c[0] as { level: string }).level);
    expect(levels).toContain('warning');
    expect(levels).toContain('error');
  });

  it('withRequestLogLevel("off",...) 完全不发', () => {
    const logger = getLogger();
    withRequestLogLevel('off', () => {
      logger.warn('mod', 'w');
      logger.error('mod', 'e');
    });
    expect(mockServer.sendLoggingMessage).not.toHaveBeenCalled();
  });

  it('withRequestLogLevel("debug",...) 发所有级别(debug/info/warning/error)', () => {
    const logger = getLogger();
    withRequestLogLevel('debug', () => {
      logger.debug('mod', 'd');
      logger.info('mod', 'i');
      logger.warn('mod', 'w');
      logger.error('mod', 'e');
    });
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledTimes(4);
    const levels = mockServer.sendLoggingMessage.mock.calls.map((c: unknown[]) => (c[0] as { level: string }).level);
    expect(levels).toEqual(['debug', 'info', 'warning', 'error']);
  });

  it('withRequestLogLevel("info",...) 发 info 及以上(debug 不发)', () => {
    const logger = getLogger();
    withRequestLogLevel('info', () => {
      logger.debug('mod', 'd');   // 不发(< info)
      logger.info('mod', 'i');    // 发
      logger.warn('mod', 'w');    // 发
      logger.error('mod', 'e');   // 发
    });
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledTimes(3);
  });

  it('withRequestLogLevel 执行完自动复位(后续日志回到旧行为)', () => {
    const logger = getLogger();
    withRequestLogLevel('debug', () => {
      logger.info('mod', 'in scope');  // 发(debug 模式)
    });
    expect(getCurrentRequestLogLevel()).toBe(null);  // 复位
    logger.info('mod', 'out of scope');  // 不发(回到旧行为)
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledTimes(1);
  });

  it('withRequestLogLevel 抛错也复位(finally 语义)', () => {
    const logger = getLogger();
    expect(() => {
      withRequestLogLevel('debug', () => {
        throw new Error('boom');
      });
    }).toThrow('boom');
    expect(getCurrentRequestLogLevel()).toBe(null);
  });

  // P1-7 review: async 版测试(生产路径 ToolDispatcher 用 withRequestLogLevelAsync)
  it('withRequestLogLevelAsync 在 await 期间保持 logLevel,完成后复位', async () => {
    const logger = getLogger();
    await withRequestLogLevelAsync('debug', async () => {
      // await 期间 _currentRequestLogLevel 应为 debug
      expect(getCurrentRequestLogLevel()).toBe('debug');
      await Promise.resolve(); // 模拟异步操作
      logger.info('mod', 'async in scope');  // 应发(debug 模式)
    });
    expect(getCurrentRequestLogLevel()).toBe(null);  // 复位
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledTimes(1);
  });

  it('withRequestLogLevelAsync 抛错也复位(async finally 语义)', async () => {
    await expect(
      withRequestLogLevelAsync('debug', async () => {
        await Promise.resolve();
        throw new Error('async boom');
      }),
    ).rejects.toThrow('async boom');
    expect(getCurrentRequestLogLevel()).toBe(null);
  });
});
