import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createProgressEmitter,
  setProgressSender,
  setProgressClientReady,
  resetProgressSender,
} from '../../src/core/progress.js';

function createMockServer(notificationImpl?: ReturnType<typeof vi.fn>) {
  return { notification: notificationImpl ?? vi.fn().mockReturnValue(undefined) };
}

beforeEach(() => {
  resetProgressSender();
});

describe('progress.createProgressEmitter', () => {
  it('ready + sender 时调 notification 且 params 带 token/progress/total/message', () => {
    const server = createMockServer();
    setProgressSender(server as any);
    setProgressClientReady(true);
    const emit = createProgressEmitter('tok-1');
    emit(2, 5, 'verifying');
    expect(server.notification).toHaveBeenCalledTimes(1);
    expect(server.notification).toHaveBeenCalledWith({
      method: 'notifications/progress',
      params: { progressToken: 'tok-1', progress: 2, total: 5, message: 'verifying' },
    });
  });

  it('未 ready（clientReady=false）→ no-op，不调 notification', () => {
    const server = createMockServer();
    setProgressSender(server as any);
    setProgressClientReady(false);
    createProgressEmitter('tok-2')(1, 3);
    expect(server.notification).not.toHaveBeenCalled();
  });

  it('无 sender（null）→ 不抛、不调', () => {
    setProgressSender(null);
    setProgressClientReady(true);
    expect(() => createProgressEmitter('tok-3')(1, 3)).not.toThrow();
  });

  it('notification 返回 rejected promise → 不抛（fire-and-forget）', async () => {
    const server = createMockServer(vi.fn().mockReturnValue(Promise.reject(new Error('transport closed'))));
    setProgressSender(server as any);
    setProgressClientReady(true);
    expect(() => createProgressEmitter('tok-4')(1, 3)).not.toThrow();
    await new Promise(r => setImmediate(r)); // 等 microtask 让 .catch 处理 reject
  });

  it('notification 同步 throw → 不抛', () => {
    const server = createMockServer(vi.fn().mockImplementation(() => { throw new Error('sync boom'); }));
    setProgressSender(server as any);
    setProgressClientReady(true);
    expect(() => createProgressEmitter('tok-5')(1, 3)).not.toThrow();
  });

  it('string 与 number 两种 token 透传', () => {
    const server = createMockServer();
    setProgressSender(server as any);
    setProgressClientReady(true);
    createProgressEmitter('string-tok')(1, 2);
    createProgressEmitter(42)(1, 2);
    expect(server.notification).toHaveBeenNthCalledWith(1, {
      method: 'notifications/progress',
      params: { progressToken: 'string-tok', progress: 1, total: 2, message: undefined },
    });
    expect(server.notification).toHaveBeenNthCalledWith(2, {
      method: 'notifications/progress',
      params: { progressToken: 42, progress: 1, total: 2, message: undefined },
    });
  });

  it('message 省略时为 undefined', () => {
    const server = createMockServer();
    setProgressSender(server as any);
    setProgressClientReady(true);
    createProgressEmitter('tok')(1, 2);
    expect(server.notification).toHaveBeenCalledWith({
      method: 'notifications/progress',
      params: { progressToken: 'tok', progress: 1, total: 2, message: undefined },
    });
  });
});
