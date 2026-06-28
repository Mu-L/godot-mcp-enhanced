import { expect, vi } from 'vitest';

// 阶段2b IMP-11: mock bridge 以测 recording_play 回放分发(无需真实 TCP 连接)
vi.mock('../src/tools/game-bridge.js', async () => {
  const actual = await vi.importActual('../src/tools/game-bridge.js');
  return {
    ...actual,  // 保留真实 export(BridgeNotConnectedError/BridgeTimeoutError)供 recording.ts instanceof
    sendToBridge: vi.fn(async () => ({ result: { ok: true } })),
    setBridgeProjectDir: vi.fn(),
  };
});

import {
  getToolDefinitions,
  sanitizeRecordingFileName,
  generateRecordingFileName,
  genRecordingSaveScript,
  genRecordingLoadScript,
  validateEventsJson,
  MAX_RECORDING_EVENTS,
  handleTool,
  // Task 3: TOUCH_DRAG_FIELDS 双侧字段契约(F2)
  TOUCH_DRAG_FIELDS,
} from '../src/tools/recording.js';
import { sendToBridge } from '../src/tools/game-bridge.js';

// ─── getToolDefinitions ─────────────────────────────────────────────────────

describe('getToolDefinitions', () => {
  it('returns 1 merged tool definition', () => {
    const defs = getToolDefinitions();
    expect(defs.length).toBe(1);
  });

  it('tool name is "recording"', () => {
    const defs = getToolDefinitions();
    expect(defs[0].name).toBe('recording');
  });

  it('tool has action enum with 5 operations', () => {
    const defs = getToolDefinitions();
    const actionEnum = defs[0].inputSchema.properties.action.enum;
    expect(actionEnum).toEqual([
      'recording_start',
      'recording_stop',
      'recording_save',
      'recording_load',
      'recording_play',
    ]);
  });

  it('tool has required field: action', () => {
    const defs = getToolDefinitions();
    expect(defs[0].inputSchema.required).toContain('action');
  });

  it('tool has optional events_json, file_name, speed parameters', () => {
    const defs = getToolDefinitions();
    const props = defs[0].inputSchema.properties;
    expect(props.events_json).toBeTruthy();
    expect(props.file_name).toBeTruthy();
    expect(props.speed).toBeTruthy();
  });
});

// ─── sanitizeRecordingFileName ──────────────────────────────────────────────

describe('sanitizeRecordingFileName', () => {
  it('accepts valid recording file names', () => {
    expect(sanitizeRecordingFileName('recording_20260516_120000.json')).toBe('recording_20260516_120000.json');
  });

  it('accepts recording names with dashes and underscores', () => {
    expect(sanitizeRecordingFileName('recording_test-session_01.json')).toBe('recording_test-session_01.json');
  });

  it('rejects path traversal with ..', () => {
    expect(() => sanitizeRecordingFileName('recording_..json')).toThrow(/path traversal/);
  });

  it('rejects forward slash', () => {
    expect(() => sanitizeRecordingFileName('recording_foo/bar.json')).toThrow(/path traversal/);
  });

  it('rejects backslash', () => {
    expect(() => sanitizeRecordingFileName('recording_foo\\bar.json')).toThrow(/path traversal/);
  });

  it('rejects names not matching recording_*.json pattern', () => {
    expect(() => sanitizeRecordingFileName('evil.json')).toThrow(/must match/);
  });

  it('rejects names with double dot embedded', () => {
    expect(() => sanitizeRecordingFileName('../recording_test.json')).toThrow(/path traversal/);
  });

  it('rejects names with spaces', () => {
    expect(() => sanitizeRecordingFileName('recording_has space.json')).toThrow(/must match/);
  });
});

// ─── generateRecordingFileName ──────────────────────────────────────────────

describe('generateRecordingFileName', () => {
  it('generates a name matching recording_*.json', () => {
    const name = generateRecordingFileName();
    expect(/^recording_[\w-]+\.json$/.test(name)).toBeTruthy();
  });

  it('includes timestamp-like portion', () => {
    const name = generateRecordingFileName();
    expect(/recording_\d{8}_\d{6}\.json/.test(name)).toBeTruthy();
  });

  it('passes sanitizeRecordingFileName', () => {
    const name = generateRecordingFileName();
    expect(() => sanitizeRecordingFileName(name)).not.toThrow();
  });
});

// ─── genRecordingSaveScript ─────────────────────────────────────────────────

describe('genRecordingSaveScript', () => {
  it('generates GDScript that writes to res://recordings/', () => {
    const script = genRecordingSaveScript('recording_test.json', '{"version":1,"events":[]}');
    expect(script.includes('res://recordings/recording_test.json')).toBeTruthy();
    expect(script.includes('FileAccess.WRITE')).toBeTruthy();
    expect(script.includes('_mcp_output("saved"')).toBeTruthy();
  });

  it('creates recordings directory if missing', () => {
    const script = genRecordingSaveScript('recording_test.json', '{}');
    expect(script.includes('make_dir("recordings")')).toBeTruthy();
  });

  it('escapes JSON content for GDScript string', () => {
    const script = genRecordingSaveScript('recording_test.json', '{"key": "val\\ue"}');
    expect(script.includes('store_string')).toBeTruthy();
  });
});

// ─── genRecordingLoadScript ─────────────────────────────────────────────────

describe('genRecordingLoadScript', () => {
  it('generates GDScript that reads from res://recordings/', () => {
    const script = genRecordingLoadScript('recording_test.json');
    expect(script.includes('res://recordings/recording_test.json')).toBeTruthy();
    expect(script.includes('FileAccess.READ')).toBeTruthy();
    expect(script.includes('_mcp_output("recording"')).toBeTruthy();
  });

  it('handles file not found', () => {
    const script = genRecordingLoadScript('recording_missing.json');
    expect(script.includes('File not found')).toBeTruthy();
  });
});

// ─── Bridge-mode recording start/stop ───────────────────────────────────────

describe('recording_start/stop use Bridge', () => {
  it('recording_start handler calls sendToBridge with recording.start method', async () => {
    const mod = await import('../src/tools/recording.js');
    expect(mod.genRecordingStartScript).toBeUndefined();
  });

  it('recording_stop handler calls sendToBridge with recording.stop method', async () => {
    const mod = await import('../src/tools/recording.js');
    expect(mod.genRecordingStopScript).toBeUndefined();
  });
});

// CRITICAL-2 (R2): validateEventsJson 事件总数上限防 DoS(百万级 events_json OOM/挂死)
describe('validateEventsJson (CRITICAL-2: MAX_EVENTS DoS 防护)', () => {
  it(`rejects events array exceeding MAX_RECORDING_EVENTS (${MAX_RECORDING_EVENTS})`, () => {
    const huge = { version: 1, duration_ms: 0, events: new Array(MAX_RECORDING_EVENTS + 1).fill({ type: 'key', keycode: 65, pressed: true, time_offset: 0 }) };
    expect(() => validateEventsJson(JSON.stringify(huge))).toThrow(/exceeds.*potential DoS/);
  });

  it('accepts events array at MAX_RECORDING_EVENTS boundary', () => {
    const ok = { version: 1, duration_ms: 0, events: new Array(MAX_RECORDING_EVENTS).fill({ type: 'key', keycode: 65, pressed: true, time_offset: 0 }) };
    expect(() => validateEventsJson(JSON.stringify(ok))).not.toThrow();
  });

  it('rejects non-array events / missing version (existing validation intact)', () => {
    expect(() => validateEventsJson(JSON.stringify({ version: 1, events: 'notarray' }))).toThrow(/must contain version/);
  });
});

// A-4: recording catch 错误分类(对接 game-bridge BridgeNotConnectedError/BridgeTimeoutError 子类)
describe('A-4: recording catch 错误分类(Bridge 子类)', () => {
  it('recording_start 游戏未运行(ECONNREFUSED→BridgeNotConnectedError) → BRIDGE_NOT_CONNECTED', async () => {
    const actual = await vi.importActual('../src/tools/game-bridge.js');
    vi.mocked(sendToBridge).mockRejectedValueOnce(new actual.BridgeNotConnectedError('Cannot connect to MCP Bridge. Is the game running?'));
    const fakeCtx = { findGodot: async () => '/fake/godot', projectDir: '/fake/p' };
    const result = await handleTool('recording', { action: 'recording_start', project_path: '/fake/p' }, fakeCtx);
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error_code).toBe('BRIDGE_NOT_CONNECTED');
    expect(parsed.suggestion).toBeTruthy();
  });

  it('recording_start 游戏卡住(BridgeTimeoutError) → BRIDGE_TIMEOUT', async () => {
    const actual = await vi.importActual('../src/tools/game-bridge.js');
    vi.mocked(sendToBridge).mockRejectedValueOnce(new actual.BridgeTimeoutError('Bridge request timed out after 5000ms'));
    const fakeCtx = { findGodot: async () => '/fake/godot', projectDir: '/fake/p' };
    const result = await handleTool('recording', { action: 'recording_start', project_path: '/fake/p' }, fakeCtx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error_code).toBe('BRIDGE_TIMEOUT');
  });
});

// 阶段2b IMP-11: recording_play 回放 touch 事件分发到 send_touch
// 契约: 录制的 touch 事件 {type:"touch",position:[x,y],pressed,index} → sendToBridge('send_touch',{x,y,pressed,index})
describe('recording_play touch (阶段2b IMP-11: touch 回放分发)', () => {
  beforeEach(() => { vi.mocked(sendToBridge).mockClear(); });

  it('replays touch event via send_touch with position/pressed/index', async () => {
    const events = [{ type: 'touch', position: [10, 20], pressed: true, index: 0, time_offset: 0 }];
    const fakeCtx = { findGodot: async () => '/fake/godot', projectDir: '/fake/p' };
    const result = await handleTool('recording', {
      action: 'recording_play', project_path: '/fake/p',
      events_json: JSON.stringify({ version: 1, duration_ms: 0, events }),
    }, fakeCtx);
    expect(sendToBridge).toHaveBeenCalledWith('send_touch',
      expect.objectContaining({ x: 10, y: 20, pressed: true, index: 0 }),
      expect.any(Number));
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.events_played).toBeGreaterThanOrEqual(1);
  });

  it('replays touch with default index 0 when omitted', async () => {
    const events = [{ type: 'touch', position: [5, 5], pressed: false, time_offset: 0 }];
    const fakeCtx = { findGodot: async () => '/fake/godot', projectDir: '/fake/p' };
    await handleTool('recording', {
      action: 'recording_play', project_path: '/fake/p',
      events_json: JSON.stringify({ version: 1, duration_ms: 0, events }),
    }, fakeCtx);
    expect(sendToBridge).toHaveBeenCalledWith('send_touch',
      expect.objectContaining({ x: 5, y: 5, pressed: false, index: 0 }),
      expect.any(Number));
  });
});

// Task 3: recording_play touch_drag 事件分发到 send_drag
// 契约: 录制的 touch_drag {type:"touch_drag",position:[x,y],index,relative:[dx,dy],speed:[sx,sy]}
//   → sendToBridge('send_drag', {x,y,index,relative,speed})
describe('recording_play touch_drag (Task 3: touch_drag 回放 + F3 + F2 契约)', () => {
  const fakeCtx = { findGodot: async () => '/fake/godot', projectDir: '/fake/p' };

  beforeEach(() => { vi.mocked(sendToBridge).mockClear(); });

  // 用例 A: touch_drag 单事件回放 → send_drag 带 {x,y,index,relative,speed}
  it('plays touch_drag event via send_drag', async () => {
    vi.mocked(sendToBridge).mockResolvedValue({ result: { ok: true } });
    const events = [{
      type: 'touch_drag', position: [10, 20], index: 0,
      relative: [3, 4], speed: [1, 2], time_offset: 0,
    }];
    await handleTool('recording', {
      action: 'recording_play', project_path: '/fake/p',
      events_json: JSON.stringify({ version: 1, duration_ms: 0, events }),
    }, fakeCtx);
    expect(sendToBridge).toHaveBeenCalledWith('send_drag',
      expect.objectContaining({
        x: expect.any(Number), y: expect.any(Number),
        index: expect.any(Number),
        relative: expect.any(Array), speed: expect.any(Array),
      }),
      expect.any(Number));
  });

  // 用例 B (F5): touch→touch_drag→touch 同 index 序列回放顺序与分发方法正确
  it('plays touch→touch_drag→touch sequence with same index', async () => {
    vi.mocked(sendToBridge).mockResolvedValue({ result: { ok: true } });
    const events = [
      { type: 'touch', position: [1, 1], pressed: true, index: 0, time_offset: 0 },
      { type: 'touch_drag', position: [11, 1], index: 0, relative: [10, 0], speed: [1, 0], time_offset: 50 },
      { type: 'touch', position: [11, 1], pressed: false, index: 0, time_offset: 200 },
    ];
    await handleTool('recording', {
      action: 'recording_play', project_path: '/fake/p',
      events_json: JSON.stringify({ version: 1, duration_ms: 0, events }),
    }, fakeCtx);
    expect(sendToBridge).toHaveBeenCalledTimes(3);
    expect(sendToBridge).toHaveBeenNthCalledWith(1, 'send_touch', expect.any(Object), expect.any(Number));
    expect(sendToBridge).toHaveBeenNthCalledWith(2, 'send_drag', expect.any(Object), expect.any(Number));
    expect(sendToBridge).toHaveBeenNthCalledWith(3, 'send_touch', expect.any(Object), expect.any(Number));
  });

  // 用例 C (F3): unknown event type → 推入 errors(此前 silently skip)
  it('pushes unknown event type to errors (F3)', async () => {
    const events = [{ type: 'gamepad', button: 0, time_offset: 0 }];
    const result = await handleTool('recording', {
      action: 'recording_play', project_path: '/fake/p',
      events_json: JSON.stringify({ version: 1, duration_ms: 0, events }),
    }, fakeCtx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.errors).toBeDefined();
    expect(Array.isArray(parsed.errors)).toBe(true);
    expect(parsed.events_played).toBe(0);
    expect(parsed.errors.join('\n')).toMatch(/Unknown event type: gamepad/);
  });

  // 用例 D (F2 TS 侧): 发出的 send_drag payload 字段 ⊇ TOUCH_DRAG_FIELDS 对应
  it('send_drag payload keys cover TOUCH_DRAG_FIELDS (F2)', async () => {
    vi.mocked(sendToBridge).mockResolvedValue({ result: { ok: true } });
    const events = [{
      type: 'touch_drag', position: [5, 6], index: 1,
      relative: [1, 2], speed: [3, 4], time_offset: 0,
    }];
    await handleTool('recording', {
      action: 'recording_play', project_path: '/fake/p',
      events_json: JSON.stringify({ version: 1, duration_ms: 0, events }),
    }, fakeCtx);
    const payload = vi.mocked(sendToBridge).mock.calls[0][1];
    // F2 双侧契约:payload 字段经 TOUCH_DRAG_FIELDS 常量索引断言(改实现字段名测试必红)
    // TOUCH_DRAG_FIELDS = ['position','index','relative','speed']
    // events[0] 字段名与常量对齐:position→x/y 拆分;index/relative/speed 透传
    const evt = events[0];
    const positionField = TOUCH_DRAG_FIELDS[0]; // 'position'
    expect(payload.x).toBe(Number(evt[positionField][0]));
    expect(payload.y).toBe(Number(evt[positionField][1]));
    expect(payload.index).toBe(Number(evt[TOUCH_DRAG_FIELDS[1]])); // 'index'
    const relField = TOUCH_DRAG_FIELDS[2]; // 'relative'
    expect(payload.relative).toEqual([Number(evt[relField][0]), Number(evt[relField][1])]);
    const spdField = TOUCH_DRAG_FIELDS[3]; // 'speed'
    expect(payload.speed).toEqual([Number(evt[spdField][0]), Number(evt[spdField][1])]);
  });
});

// Task 3: TOUCH_DRAG_FIELDS 常量导出契约(F2 双侧字段对齐防 IMP-11 同类静默错)
describe('TOUCH_DRAG_FIELDS (Task 3: F2 字段契约常量)', () => {
  it('exports an array of touch_drag field names', () => {
    expect(Array.isArray(TOUCH_DRAG_FIELDS)).toBe(true);
    expect([...TOUCH_DRAG_FIELDS]).toEqual(['position', 'index', 'relative', 'speed']);
  });
});
