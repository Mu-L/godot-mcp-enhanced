import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElicitFn, setElicitServer, resetElicitServer } from '../../src/core/elicit.js';
import type { RequestedSchema } from '../../src/core/elicit.js';

function mockServer(opts: { supportsElicitation?: boolean; elicitResult?: unknown; elicitThrows?: boolean }) {
  return {
    getClientCapabilities: vi.fn().mockReturnValue(
      opts.supportsElicitation === false ? {} : { elicitation: {} },
    ),
    elicitInput: opts.elicitThrows
      ? vi.fn().mockImplementation(() => { throw new Error('transport closed'); })
      : vi.fn().mockResolvedValue(opts.elicitResult ?? { action: 'decline' }),
  };
}

const schema: RequestedSchema = {
  type: 'object',
  properties: { name: { type: 'string' }, count: { type: 'number' } },
  required: ['name', 'count'],
};

beforeEach(() => resetElicitServer());

describe('elicit.createElicitFn', () => {
  it('client 支持 + accept → 返回 content（number 类型保留，不窄化成 string）', async () => {
    const server = mockServer({ elicitResult: { action: 'accept', content: { name: 'x', count: 5 } } });
    setElicitServer(server as any);
    const result = await createElicitFn()(schema, '请补全参数');
    expect(result).toEqual({ name: 'x', count: 5 });
    expect(typeof result?.count).toBe('number');  // 关键：number 不被窄化
    expect(server.elicitInput).toHaveBeenCalledWith({ mode: 'form', message: '请补全参数', requestedSchema: schema });
  });

  it('client 不支持 elicitation（caps.elicitation falsy）→ null，不调 elicitInput', async () => {
    const server = mockServer({ supportsElicitation: false });
    setElicitServer(server as any);
    expect(await createElicitFn()(schema, 'msg')).toBeNull();
    expect(server.elicitInput).not.toHaveBeenCalled();
  });

  it('用户 decline → null', async () => {
    setElicitServer(mockServer({ elicitResult: { action: 'decline' } }) as any);
    expect(await createElicitFn()(schema, 'msg')).toBeNull();
  });

  it('用户 cancel → null', async () => {
    setElicitServer(mockServer({ elicitResult: { action: 'cancel' } }) as any);
    expect(await createElicitFn()(schema, 'msg')).toBeNull();
  });

  it('elicitInput throw → null（不抛，fallback 由 middleware 处理）', async () => {
    setElicitServer(mockServer({ elicitThrows: true }) as any);
    expect(await createElicitFn()(schema, 'msg')).toBeNull();
  });

  it('无 _elicitServer（null）→ null', async () => {
    resetElicitServer();
    expect(await createElicitFn()(schema, 'msg')).toBeNull();
  });
});
