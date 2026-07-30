import { expect } from 'vitest';
import {
  getToolDefinitions,
  TOOL_META,
  genAudioPlayScript,
  genAudioStopScript,
  genAudioSetParamScript,
  genAudioQueryScript,
} from '../src/tools/audio-ops.js';

// ─── getToolDefinitions ─────────────────────────────────────────────────────

describe('audio-ops getToolDefinitions', () => {
  it('returns 1 merged tool definition', () => {
    const defs = getToolDefinitions();
    expect(defs.length).toBe(1);
  });
  it('tool is named "audio"', () => {
    const defs = getToolDefinitions();
    expect(defs[0].name).toBe('audio');
  });
  it('action enum contains all 4 actions', () => {
    const defs = getToolDefinitions();
    const actionEnum = defs[0].inputSchema.properties.action.enum;
    expect(actionEnum).toContain('audio_play');
    expect(actionEnum).toContain('audio_stop');
    expect(actionEnum).toContain('audio_set_param');
    expect(actionEnum).toContain('audio_query');
  });
  it('definition has inputSchema with required fields', () => {
    const defs = getToolDefinitions();
    expect(defs[0].inputSchema).toBeTruthy();
    expect(defs[0].inputSchema.required).toContain('action');
  });
});

// ─── TOOL_META ──────────────────────────────────────────────────────────────

describe('audio-ops TOOL_META', () => {
  it('has exactly 1 entry', () => {
    expect(Object.keys(TOOL_META).length).toBe(1);
  });
  it('has entry for "audio"', () => {
    expect(TOOL_META.audio).toBeDefined();
  });
  it('audio is non-readonly and non-long-running', () => {
    expect(TOOL_META.audio.readonly).toBe(false);
    expect(TOOL_META.audio.long_running).toBe(false);
  });
});

// ─── genAudioPlayScript ─────────────────────────────────────────────────────

describe('genAudioPlayScript', () => {
  it('generates play script with stream_path', () => {
    const script = genAudioPlayScript('/root/BGMPlayer', 'res://audio/bgm.ogg', -10, 1.0, 'Master');
    expect(script).toContain('get_node("/root/BGMPlayer")');
    expect(script).toContain('res://audio/bgm.ogg');
    expect(script).toContain('volume_db = -10');
    expect(script).toContain('pitch_scale = 1.0');
    expect(script).toContain('AudioStreamPlayer');
    expect(script).toContain('.play()');
  });
  it('generates play script without stream_path', () => {
    const script = genAudioPlayScript('/root/SFX');
    expect(script).toContain('.play()');
    expect(script.includes('node.stream =')).toBeFalsy();
  });
  it('generates play script with from_position', () => {
    const script = genAudioPlayScript('/root/BGM', undefined, undefined, undefined, undefined, 5.0);
    expect(script).toContain('.play(5.0)');
  });
});

// ─── genAudioStopScript ─────────────────────────────────────────────────────

describe('genAudioStopScript', () => {
  it('generates stop script', () => {
    const script = genAudioStopScript('/root/BGMPlayer');
    expect(script).toContain('get_node("/root/BGMPlayer")');
    expect(script).toContain('.stop()');
  });
});

// ─── genAudioSetParamScript ─────────────────────────────────────────────────

describe('genAudioSetParamScript', () => {
  it('generates volume_db param script', () => {
    const script = genAudioSetParamScript('/root/BGM', 'volume_db', -5);
    expect(script).toContain('volume_db = -5');
  });
  it('generates pitch_scale param script', () => {
    const script = genAudioSetParamScript('/root/BGM', 'pitch_scale', 1.5);
    expect(script).toContain('pitch_scale = 1.5');
  });
  it('generates bus param script', () => {
    const script = genAudioSetParamScript('/root/BGM', 'bus', 'SFX');
    expect(script).toContain('bus = "SFX"');
  });
});

// ─── genAudioQueryScript ────────────────────────────────────────────────────

describe('genAudioQueryScript', () => {
  it('generates query script', () => {
    const script = genAudioQueryScript('/root/BGM');
    expect(script).toContain('get_node("/root/BGM")');
    expect(script).toContain('playing');
    expect(script).toContain('volume_db');
    expect(script).toContain('pitch_scale');
    expect(script).toContain('bus');
    expect(script).toContain('get_playback_position');
  });
});
