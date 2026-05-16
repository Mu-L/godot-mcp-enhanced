import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOOL_NAMES,
  getToolDefinitions,
  genAudioPlayScript,
  genAudioStopScript,
  genAudioSetParamScript,
  genAudioQueryScript,
} from '../build/tools/audio-ops.js';

// ─── TOOL_NAMES ─────────────────────────────────────────────────────────────

describe('audio-ops TOOL_NAMES', () => {
  it('contains exactly 4 tool names', () => {
    assert.strictEqual(TOOL_NAMES.length, 4);
  });
  it('includes audio_play', () => {
    assert.ok(TOOL_NAMES.includes('audio_play'));
  });
  it('includes audio_stop', () => {
    assert.ok(TOOL_NAMES.includes('audio_stop'));
  });
  it('includes audio_set_param', () => {
    assert.ok(TOOL_NAMES.includes('audio_set_param'));
  });
  it('includes audio_query', () => {
    assert.ok(TOOL_NAMES.includes('audio_query'));
  });
});

// ─── getToolDefinitions ─────────────────────────────────────────────────────

describe('audio-ops getToolDefinitions', () => {
  it('returns 4 tool definitions', () => {
    const defs = getToolDefinitions();
    assert.strictEqual(defs.length, 4);
  });
  it('each definition has a name from TOOL_NAMES', () => {
    const defs = getToolDefinitions();
    const names = defs.map(d => d.name);
    for (const tn of TOOL_NAMES) {
      assert.ok(names.includes(tn), `missing tool definition for ${tn}`);
    }
  });
});

// ─── genAudioPlayScript ─────────────────────────────────────────────────────

describe('genAudioPlayScript', () => {
  it('generates play script with stream_path', () => {
    const script = genAudioPlayScript('/root/BGMPlayer', 'res://audio/bgm.ogg', -10, 1.0, 'Master');
    assert.ok(script.includes('get_node("/root/BGMPlayer")'));
    assert.ok(script.includes('res://audio/bgm.ogg'));
    assert.ok(script.includes('volume_db = -10'));
    assert.ok(script.includes('pitch_scale = 1.0'));
    assert.ok(script.includes('AudioStreamPlayer'));
    assert.ok(script.includes('.play()'));
  });
  it('generates play script without stream_path', () => {
    const script = genAudioPlayScript('/root/SFX');
    assert.ok(script.includes('.play()'));
    assert.ok(!script.includes('node.stream ='));
  });
  it('generates play script with from_position', () => {
    const script = genAudioPlayScript('/root/BGM', undefined, undefined, undefined, undefined, 5.0);
    assert.ok(script.includes('.play(5.0)'));
  });
});

// ─── genAudioStopScript ─────────────────────────────────────────────────────

describe('genAudioStopScript', () => {
  it('generates stop script', () => {
    const script = genAudioStopScript('/root/BGMPlayer');
    assert.ok(script.includes('get_node("/root/BGMPlayer")'));
    assert.ok(script.includes('.stop()'));
  });
});

// ─── genAudioSetParamScript ─────────────────────────────────────────────────

describe('genAudioSetParamScript', () => {
  it('generates volume_db param script', () => {
    const script = genAudioSetParamScript('/root/BGM', 'volume_db', -5);
    assert.ok(script.includes('volume_db = -5'));
  });
  it('generates pitch_scale param script', () => {
    const script = genAudioSetParamScript('/root/BGM', 'pitch_scale', 1.5);
    assert.ok(script.includes('pitch_scale = 1.5'));
  });
  it('generates bus param script', () => {
    const script = genAudioSetParamScript('/root/BGM', 'bus', 'SFX');
    assert.ok(script.includes('bus = "SFX"'));
  });
});

// ─── genAudioQueryScript ────────────────────────────────────────────────────

describe('genAudioQueryScript', () => {
  it('generates query script', () => {
    const script = genAudioQueryScript('/root/BGM');
    assert.ok(script.includes('get_node("/root/BGM")'));
    assert.ok(script.includes('playing'));
    assert.ok(script.includes('volume_db'));
    assert.ok(script.includes('pitch_scale'));
    assert.ok(script.includes('bus'));
    assert.ok(script.includes('get_playback_position'));
  });
});
