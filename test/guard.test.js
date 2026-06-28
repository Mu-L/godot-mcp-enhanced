import { expect } from 'vitest';
import fc from 'fast-check';
import {
  requiresConfirmation, createPendingToken, consumeToken, pendingCount, resetState,
  TOKEN_TTL_MS,
} from '../src/guard.js';

// ─── requiresConfirmation (merged-tool guard) ────────────────────────────

describe('requiresConfirmation', () => {
  it('returns true for scene.remove_node', () => {
    expect(requiresConfirmation('scene', { action: 'remove_node' })).toBe(true);
  });
  it('returns true for scene.save_scene', () => {
    expect(requiresConfirmation('scene', { action: 'save_scene' })).toBe(true);
  });
  it('returns true for scene.detach_instance', () => {
    expect(requiresConfirmation('scene', { action: 'detach_instance' })).toBe(true);
  });
  it('returns false for script without action (read_script is exempt)', () => {
    expect(requiresConfirmation('script')).toBe(false);
  });
  it('returns true for script write actions', () => {
    expect(requiresConfirmation('script', { action: 'execute_gdscript' })).toBe(true);
    expect(requiresConfirmation('script', { action: 'write_script' })).toBe(true);
    expect(requiresConfirmation('script', { action: 'edit_script' })).toBe(true);
    expect(requiresConfirmation('script', { action: 'project_replace' })).toBe(true);
    expect(requiresConfirmation('script', { action: 'generate_test' })).toBe(true);
    expect(requiresConfirmation('script', { action: 'create_test_scene' })).toBe(true);
  });
  it('returns false for script read_script', () => {
    expect(requiresConfirmation('script', { action: 'read_script' })).toBe(false);
  });
  it('exempts edit_script with search_and_replace mode', () => {
    expect(requiresConfirmation('script', { action: 'edit_script', search_and_replace: { search: 'old', replace: 'new' } })).toBe(false);
  });
  it('still requires confirmation for edit_script with line range mode', () => {
    expect(requiresConfirmation('script', { action: 'edit_script', start_line: 10, end_line: 15 })).toBe(true);
  });
  it('still requires confirmation for edit_script with empty search_and_replace', () => {
    expect(requiresConfirmation('script', { action: 'edit_script', search_and_replace: {} })).toBe(true);
  });
  it('CRITICAL-1: scene write actions guarded, read not', () => {
    expect(requiresConfirmation('scene', { action: 'add_node' })).toBe(true);
    expect(requiresConfirmation('scene', { action: 'edit_node' })).toBe(true);
    expect(requiresConfirmation('scene', { action: 'create_3d_node' })).toBe(true);
    expect(requiresConfirmation('scene', { action: 'commit' })).toBe(true);
    expect(requiresConfirmation('scene', { action: 'read_scene' })).toBe(false);
  });
  it('returns true for animation.delete', () => {
    expect(requiresConfirmation('animation', { action: 'delete' })).toBe(true);
  });
  it('returns false for animation.get_info', () => {
    expect(requiresConfirmation('animation', { action: 'get_info' })).toBe(false);
    expect(requiresConfirmation('animation', { action: 'play' })).toBe(false);
  });
  it('returns true for tilemap.tilemap_clear', () => {
    expect(requiresConfirmation('tilemap', { action: 'tilemap_clear' })).toBe(true);
  });
  it('CRITICAL-1: tilemap write actions guarded, read/copy not', () => {
    expect(requiresConfirmation('tilemap', { action: 'tilemap_read' })).toBe(false);
    expect(requiresConfirmation('tilemap', { action: 'tilemap_copy' })).toBe(false);
    expect(requiresConfirmation('tilemap', { action: 'tilemap_set_cell' })).toBe(true);
    expect(requiresConfirmation('tilemap', { action: 'tilemap_fill_rect' })).toBe(true);
  });
  it('returns true for game.game_bridge_install', () => {
    expect(requiresConfirmation('game', { action: 'game_bridge_install' })).toBe(true);
    expect(requiresConfirmation('game', { action: 'game_bridge_uninstall' })).toBe(true);
  });
  it('returns false for game.game_query', () => {
    expect(requiresConfirmation('game', { action: 'game_query' })).toBe(false);
    expect(requiresConfirmation('game', { action: 'game_input' })).toBe(false);
  });
  it('returns true for runtime.run_project', () => {
    expect(requiresConfirmation('runtime', { action: 'run_project' })).toBe(true);
  });
  it('returns true for runtime.launch_editor', () => {
    expect(requiresConfirmation('runtime', { action: 'launch_editor' })).toBe(true);
  });
  it('returns true for runtime.stop_project', () => {
    expect(requiresConfirmation('runtime', { action: 'stop_project' })).toBe(true);
  });
  it('CRITICAL-1: runtime execute guarded, read not', () => {
    expect(requiresConfirmation('runtime', { action: 'get_godot_version' })).toBe(false);
    expect(requiresConfirmation('runtime', { action: 'get_debug_output' })).toBe(false);
    expect(requiresConfirmation('runtime', { action: 'run_tests' })).toBe(true);
    expect(requiresConfirmation('runtime', { action: 'record_play' })).toBe(true);
  });
  it('CRITICAL-1: guards high-risk write/execute across tools (game_write/material/particles/nav/signal/ui/physics)', () => {
    expect(requiresConfirmation('game', { action: 'game_write', method: 'call_method' })).toBe(true);
    expect(requiresConfirmation('material', { action: 'set_params' })).toBe(true);
    expect(requiresConfirmation('material', { action: 'shader_write' })).toBe(true);
    expect(requiresConfirmation('particles', { action: 'particles_create' })).toBe(true);
    expect(requiresConfirmation('nav', { action: 'create_region' })).toBe(true);
    expect(requiresConfirmation('signal', { action: 'signal_emit' })).toBe(true);
    expect(requiresConfirmation('ui', { action: 'ui_create_control' })).toBe(true);
    expect(requiresConfirmation('physics', { action: 'collision_overlay' })).toBe(true);
  });

  it('CRITICAL-1: does not guard read/boundary actions (game_input/signal_connect/audio_play)', () => {
    expect(requiresConfirmation('game', { action: 'game_query' })).toBe(false);
    expect(requiresConfirmation('game', { action: 'game_input' })).toBe(false);
    expect(requiresConfirmation('signal', { action: 'signal_list' })).toBe(false);
    expect(requiresConfirmation('signal', { action: 'signal_connect' })).toBe(false);
    expect(requiresConfirmation('audio', { action: 'audio_play' })).toBe(false);
    expect(requiresConfirmation('audio', { action: 'audio_query' })).toBe(false);
    expect(requiresConfirmation('physics', { action: 'raycast' })).toBe(false);
    expect(requiresConfirmation('material', { action: 'read' })).toBe(false);
    expect(requiresConfirmation('nav', { action: 'query_path' })).toBe(false);
  });

  it('returns false for non-guarded tools', () => {
    expect(requiresConfirmation('validation')).toBe(false);
    expect(requiresConfirmation('workflow')).toBe(false);
    expect(requiresConfirmation('screenshot')).toBe(false);
  });
});

// ─── createPendingToken + consumeToken ──────────────────────────────────

describe('createPendingToken + consumeToken', () => {
  beforeEach(() => { resetState(); });

  it('creates and consumes a valid token', () => {
    const token = createPendingToken('scene', { action: 'remove_node', node_path: '/root/Player' });
    expect(typeof token === 'string' && token.length > 10).toBeTruthy();
    expect(pendingCount()).toBe(1);

    const result = consumeToken(token);
    expect(result).toBeTruthy();
    expect(result.toolName).toBe('scene');
    expect(result.args).toEqual({ action: 'remove_node', node_path: '/root/Player' });
    expect(pendingCount()).toBe(0);
  });

  it('token is single-use', () => {
    const token = createPendingToken('script', { action: 'write_script', path: 'test.gd' });
    const first = consumeToken(token);
    expect(first).toBeTruthy();
    const second = consumeToken(token);
    expect(second).toBe(null);
  });

  it('unknown token returns null', () => {
    const result = consumeToken('nonexistent_token_12345');
    expect(result).toBe(null);
  });
});

// ─── Property-based tests ───────────────────────────────────────────────

describe('Property: guard', () => {
  it('requiresConfirmation is deterministic for any string', () => {
    fc.assert(
      fc.property(fc.string(), (toolName) => {
        const result = requiresConfirmation(toolName);
        expect(requiresConfirmation(toolName)).toBe(result);
        expect(typeof result).toBe('boolean');
      }),
      { numRuns: process.env.CI ? 200 : 1000 }
    );
  });

  it('consumeToken with random string always returns null', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 100 }), (token) => {
        expect(consumeToken(token)).toBe(null);
      }),
      { numRuns: process.env.CI ? 200 : 1000 }
    );
  });

  it('createPendingToken + consumeToken roundtrip preserves toolName', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.anything()),
        (toolName, args) => {
          resetState();
          const token = createPendingToken(toolName, args);
          const consumed = consumeToken(token);
          expect(consumed).not.toBeNull();
          expect(consumed.toolName).toBe(toolName);
        }
      ),
      { numRuns: process.env.CI ? 200 : 1000 }
    );
  });
});

// ─── TOKEN_TTL_MS (CRITICAL-3 子项1) ───────────────────────────────────────

describe('TOKEN_TTL_MS', () => {
  it('CRITICAL-3: TTL tightened to 60s (from 180s)', () => {
    expect(TOKEN_TTL_MS).toBe(60_000);
  });
});
