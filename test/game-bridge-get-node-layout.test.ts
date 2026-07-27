import { describe, it, expect } from 'vitest';
import { QUERY_METHODS, BRIDGE_READ_ONLY_METHODS } from '../src/tools/game-bridge';

describe('get_node_layout whitelist', () => {
  it('get_node_layout 在 QUERY_METHODS（game_query allowed 集合）', () => {
    expect(QUERY_METHODS.has('get_node_layout')).toBe(true);
  });
  it('get_node_layout 在 BRIDGE_READ_ONLY_METHODS（只读）', () => {
    expect(BRIDGE_READ_ONLY_METHODS.has('get_node_layout')).toBe(true);
  });
});
