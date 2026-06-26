import { expect } from 'vitest';
import { handleTool } from '../src/tools/audio-ops.js';

// 阶段4-2: audio stream_path 同源对齐 sanitizeResPath(对齐 ui theme_path/save_path)
// genAudioPlayScript :33 直接 load("${gdEscape(streamPath)}"),gdEscape 防 GDScript 注入但不防路径遍历。
describe('handleTool audio_play (阶段4-2: stream_path sanitizeResPath)', () => {
  const fakeCtx = { findGodot: async () => '/fake/godot', projectDir: '/fake/p' };

  it('rejects stream_path with path traversal (res://../../etc)', async () => {
    const result = await handleTool('audio', {
      action: 'audio_play', project_path: '/fake/p',
      node_path: 'root/Audio', stream_path: 'res://../../etc/passwd',
    }, fakeCtx);
    expect(result).toBeTruthy();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/traversal|INVALID_PATH/i);
  });

  it('rejects stream_path not starting with res://', async () => {
    const result = await handleTool('audio', {
      action: 'audio_play', project_path: '/fake/p',
      node_path: 'root/Audio', stream_path: '/etc/passwd',
    }, fakeCtx);
    expect(result).toBeTruthy();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/INVALID_PATH|res:\/\//i);
  });

  it('rejects double-encoded traversal (%252e%252e)', async () => {
    const result = await handleTool('audio', {
      action: 'audio_play', project_path: '/fake/p',
      node_path: 'root/Audio', stream_path: 'res://%252e%252e/secret.ogg',
    }, fakeCtx);
    expect(result).toBeTruthy();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/traversal|INVALID_PATH/i);
  });

  it('accepts valid res:// stream_path (no traversal error)', async () => {
    // 合法路径不应被 stream_path 校验拦截(后续 spawn /fake/godot 会失败,但错误不应是 traversal/INVALID_PATH)
    const result = await handleTool('audio', {
      action: 'audio_play', project_path: '/fake/p',
      node_path: 'root/Audio', stream_path: 'res://sounds/bg.ogg',
    }, fakeCtx);
    expect(result).toBeTruthy();
    expect(result.content[0].text).not.toMatch(/traversal|INVALID_PATH/i);
  });
});
