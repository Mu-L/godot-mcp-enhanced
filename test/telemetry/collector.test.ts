import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('telemetry/collector', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('CI', '');
    vi.stubEnv('GODOT_MCP_TELEMETRY', 'true');
    vi.stubEnv('GODOT_MCP_TELEMETRY_ENDPOINT', 'https://example.test/ingest');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('record 入队（enabled + endpoint 设）', async () => {
    const { record, _queueLengthForTest } = await import('../../src/telemetry/collector.js');
    expect(_queueLengthForTest()).toBe(0);
    record({ tool: 'nav', success: true, duration_ms: 10 });
    expect(_queueLengthForTest()).toBe(1);
  });

  it('record disabled 不入队（零副作用）', async () => {
    vi.stubEnv('GODOT_MCP_TELEMETRY', '');
    const { record, _queueLengthForTest } = await import('../../src/telemetry/collector.js');
    record({ tool: 'nav', success: true, duration_ms: 10 });
    expect(_queueLengthForTest()).toBe(0);
  });

  it('record endpoint 空 不入队（阶段 0 零外传）', async () => {
    vi.stubEnv('GODOT_MCP_TELEMETRY_ENDPOINT', '');
    const { record, _queueLengthForTest } = await import('../../src/telemetry/collector.js');
    record({ tool: 'nav', success: true, duration_ms: 10 });
    expect(_queueLengthForTest()).toBe(0);
  });

  it('queue 满丢新（保业务关键旧事件）', async () => {
    const { record, _queueLengthForTest, _resetForTest, QUEUE_MAXSIZE } = await import('../../src/telemetry/collector.js');
    _resetForTest();
    for (let i = 0; i < QUEUE_MAXSIZE; i++) record({ tool: 't', success: true, duration_ms: 1 });
    expect(_queueLengthForTest()).toBe(QUEUE_MAXSIZE);
    record({ tool: 'overflow', success: true, duration_ms: 1 });  // 满则丢新
    expect(_queueLengthForTest()).toBe(QUEUE_MAXSIZE);  // 不超
  });
});
