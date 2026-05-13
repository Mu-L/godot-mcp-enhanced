import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerTools,
  isReadOnly,
  isLongRunning,
  getReadOnlyTools,
  getWriteTools,
  getAllToolNames,
} from '../build/core/tool-registry.js';

describe('tool-registry', () => {
  it('registers tools with tags', () => {
    registerTools([
      { name: 'read_scene', readonly: true, long_running: false },
      { name: 'add_node', readonly: false, long_running: false },
      { name: 'nav_bake_mesh', readonly: false, long_running: true },
    ]);
    assert.equal(isReadOnly('read_scene'), true);
    assert.equal(isReadOnly('add_node'), false);
    assert.equal(isLongRunning('nav_bake_mesh'), true);
    assert.equal(isLongRunning('add_node'), false);
  });

  it('returns false for unknown tools', () => {
    assert.equal(isReadOnly('nonexistent_tool'), false);
    assert.equal(isLongRunning('nonexistent_tool'), false);
  });

  it('lists all readonly tools', () => {
    registerTools([
      { name: 'read_scene', readonly: true, long_running: false },
      { name: 'add_node', readonly: false, long_running: false },
      { name: 'get_project_info', readonly: true, long_running: false },
    ]);
    const ro = getReadOnlyTools();
    assert.ok(ro.includes('read_scene'));
    assert.ok(ro.includes('get_project_info'));
    assert.ok(!ro.includes('add_node'));
  });

  it('lists all write tools', () => {
    registerTools([
      { name: 'read_scene', readonly: true, long_running: false },
      { name: 'add_node', readonly: false, long_running: false },
      { name: 'write_script', readonly: false, long_running: false },
    ]);
    const wr = getWriteTools();
    assert.ok(wr.includes('add_node'));
    assert.ok(wr.includes('write_script'));
    assert.ok(!wr.includes('read_scene'));
  });

  it('getAllToolNames returns all registered names', () => {
    registerTools([
      { name: 'a', readonly: true, long_running: false },
      { name: 'b', readonly: false, long_running: false },
    ]);
    const names = getAllToolNames();
    assert.deepEqual(names.sort(), ['a', 'b']);
  });
});
