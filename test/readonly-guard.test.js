import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ReadOnlyGuard } from '../build/core/ReadOnlyGuard.js';
import { registerTools } from '../build/core/tool-registry.js';

describe('ReadOnlyGuard', () => {
  beforeEach(() => {
    registerTools([
      { name: 'read_scene', readonly: true, long_running: false },
      { name: 'add_node', readonly: false, long_running: false },
      { name: 'get_project_info', readonly: true, long_running: false },
      { name: 'write_script', readonly: false, long_running: false },
    ]);
  });

  it('allows readonly tools when guard is active', () => {
    const guard = new ReadOnlyGuard(true);
    const result = guard.check('read_scene');
    assert.equal(result.blocked, false);
  });

  it('blocks write tools when guard is active', () => {
    const guard = new ReadOnlyGuard(true);
    const result = guard.check('add_node');
    assert.equal(result.blocked, true);
    assert.equal(result.errorCode, -32001);
    assert.ok(result.message.includes('read-only'));
  });

  it('allows all tools when guard is inactive', () => {
    const guard = new ReadOnlyGuard(false);
    assert.equal(guard.check('add_node').blocked, false);
    assert.equal(guard.check('write_script').blocked, false);
    assert.equal(guard.check('read_scene').blocked, false);
  });

  it('blocks unknown tools in readonly mode (safe default)', () => {
    const guard = new ReadOnlyGuard(true);
    const result = guard.check('unknown_tool');
    assert.equal(result.blocked, true);
  });

  it('returns proper error structure', () => {
    const guard = new ReadOnlyGuard(true);
    const result = guard.check('write_script');
    assert.deepEqual(result, {
      blocked: true,
      errorCode: -32001,
      message: 'Operation blocked: read-only mode enabled (GODOT_MCP_READ_ONLY=true)',
    });
  });
});
