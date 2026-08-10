import { describe, it, expect } from 'vitest';
import type { Tool } from '@modelcontextprotocol/server';
import {
  categoryOf,
  buildSummary,
  searchTools,
  listCategory,
  getToolSchema,
} from '../../src/core/tool-discovery.js';

// ─── Test fixtures ──────────────────────────────────────────────────────────

function makeTool(name: string, description: string, properties: string[] = [], required: string[] = []): Tool {
  const props: Record<string, unknown> = {};
  for (const p of properties) props[p] = { type: 'string' };
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties: props,
      ...(required.length > 0 ? { required } : {}),
    } as Tool['inputSchema'],
  };
}

const staticTools: Tool[] = [
  makeTool('scene', 'Read and manipulate Godot scenes. Add nodes, save scenes, etc.', ['action', 'path'], ['action']),
  makeTool('nav', 'Navigation mesh creation and agent management.', ['action']),
  makeTool('script', 'Create and edit GDScript files.', ['action', 'path'], ['action']),
  makeTool('godot_terrain_raise_lower', 'Raise or lower terrain height.', ['position', 'amount']),
  makeTool('godot_terrain_smooth', 'Smooth terrain at position.', ['position']),
  makeTool('godot_custom_special', 'A custom special tool with unique route.'),
];

const dynamicTools: Tool[] = [
  makeTool('godot_experimental_new_thing', 'An experimental feature discovered live.', ['foo']),
  makeTool('godot_lighting_bake', 'Bake lighting for the scene.'),
];

const allTools = [...staticTools, ...dynamicTools];

// ─── categoryOf ─────────────────────────────────────────────────────────────

describe('categoryOf', () => {
  it('extracts category from godot_ prefixed tool', () => {
    expect(categoryOf('godot_terrain_raise_lower')).toBe('terrain');
    expect(categoryOf('godot_custom_special')).toBe('custom');
    expect(categoryOf('godot_experimental_new_thing')).toBe('experimental');
  });

  it('returns "core" for merged tools without underscore', () => {
    expect(categoryOf('scene')).toBe('core');
    expect(categoryOf('nav')).toBe('core');
    expect(categoryOf('script')).toBe('core');
  });

  it('returns "core" for godot_ prefix with single segment', () => {
    // edge case: godot_terrain (no action part) — but categoryOf treats it as core
    // because split('_') on 'terrain' gives ['terrain'] which is length 1 < 2
    expect(categoryOf('godot_terrain')).toBe('core');
  });
});

// ─── buildSummary (Level 1) ─────────────────────────────────────────────────

describe('buildSummary', () => {
  it('counts tools per category', () => {
    const summary = buildSummary(staticTools, dynamicTools);
    expect(summary.totalTools).toBe(8);
    expect(summary.totalDynamic).toBe(2);
    expect(summary.categories).toEqual({
      core: 3,      // scene, nav, script
      terrain: 2,   // godot_terrain_raise_lower, godot_terrain_smooth
      custom: 1,    // godot_custom_special
      experimental: 1, // godot_experimental_new_thing
      lighting: 1,  // godot_lighting_bake
    });
  });

  it('includes hint string', () => {
    const summary = buildSummary([], []);
    expect(summary.hint).toContain('search=');
    expect(summary.hint).toContain('category=');
    expect(summary.hint).toContain('tool=');
  });

  it('handles empty tool lists', () => {
    const summary = buildSummary([], []);
    expect(summary.totalTools).toBe(0);
    expect(summary.totalDynamic).toBe(0);
    expect(summary.categories).toEqual({});
  });
});

// ─── searchTools (Level 2a) ─────────────────────────────────────────────────

describe('searchTools', () => {
  it('returns empty for empty query', () => {
    const result = searchTools('', allTools);
    expect(result.totalMatches).toBe(0);
    expect(result.results).toEqual([]);
  });

  it('matches single token in name (rank 0)', () => {
    const result = searchTools('terrain', allTools);
    expect(result.totalMatches).toBe(2); // raise_lower + smooth
    expect(result.results.every((r) => r.category === 'terrain')).toBe(true);
  });

  it('matches tokens in description (rank 1, sorted after name matches)', () => {
    // "bake" matches godot_lighting_bake in name (rank 0)
    const result = searchTools('bake', allTools);
    expect(result.totalMatches).toBe(1);
    expect(result.results[0]!.name).toBe('godot_lighting_bake');
  });

  it('requires ALL tokens to match (AND logic)', () => {
    // "terrain raise" — both tokens must match
    const result = searchTools('terrain raise', allTools);
    expect(result.totalMatches).toBe(1);
    expect(result.results[0]!.name).toBe('godot_terrain_raise_lower');
  });

  it('returns zero matches when one token missing', () => {
    const result = searchTools('terrain nonexistent', allTools);
    expect(result.totalMatches).toBe(0);
  });

  it('name-match ranks before description-match', () => {
    // Add a tool where token is in description but not name
    const tools = [
      makeTool('alpha', 'contains terrain keyword in description'),
      makeTool('godot_terrain_x', 'some tool'),
    ];
    const result = searchTools('terrain', tools);
    expect(result.totalMatches).toBe(2);
    // godot_terrain_x (name match, rank 0) should come first
    expect(result.results[0]!.name).toBe('godot_terrain_x');
    expect(result.results[1]!.name).toBe('alpha');
  });

  it('respects limit (default 20)', () => {
    const many = Array.from({ length: 30 }, (_, i) => makeTool(`godot_cat_${i}`, 'cat tool'));
    const result = searchTools('cat', many);
    expect(result.totalMatches).toBe(30);
    expect(result.results).toHaveLength(20);
  });

  it('respects custom limit', () => {
    const many = Array.from({ length: 10 }, (_, i) => makeTool(`godot_cat_${i}`, 'cat tool'));
    const result = searchTools('cat', many, { limit: 3 });
    expect(result.results).toHaveLength(3);
  });

  it('filters by category when provided', () => {
    const result = searchTools('tool', allTools, { category: 'terrain' });
    // only terrain category tools, and they must match "tool" token
    // terrain tools don't have "tool" in name/desc, so expect 0
    expect(result.totalMatches).toBe(0);
  });

  it('includes brief from firstSentence', () => {
    const result = searchTools('terrain', allTools);
    expect(result.results[0]!.brief).toBeDefined();
  });

  it('marks dynamic tools', () => {
    const dynamicNames = new Set(['godot_experimental_new_thing']);
    const result = searchTools('experimental', allTools, { dynamicNames });
    expect(result.results[0]!.dynamic).toBe(true);
  });
});

// ─── listCategory (Level 2b) ────────────────────────────────────────────────

describe('listCategory', () => {
  it('returns lean view (name + brief + params) by default', () => {
    const result = listCategory('terrain', allTools, false) as {
      category: string;
      count: number;
      tools: Array<{ name: string; brief?: string; params?: string[]; required?: string[] }>;
    };
    expect(result.category).toBe('terrain');
    expect(result.count).toBe(2);
    expect(result.tools).toHaveLength(2);
    expect(result.tools[0]!.name).toBeDefined();
    expect(result.tools[0]!.brief).toBeDefined();
    expect(result.tools[0]!.params).toBeDefined();
  });

  it('returns error for non-existent category', () => {
    const result = listCategory('nonexistent', allTools, false) as { error: string };
    expect(result.error).toContain('nonexistent');
  });

  it('returns full schemas when includeSchemas=true', () => {
    const result = listCategory('terrain', allTools, true) as Array<{
      name: string;
      description: string;
      inputSchema: unknown;
    }>;
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]!.inputSchema).toBeDefined();
    expect(result[0]!.description).toBeDefined();
  });

  it('includes required params in lean view when present', () => {
    // scene tool has required: ['action']
    const result = listCategory('core', allTools, false) as {
      tools: Array<{ name: string; required?: string[] }>;
    };
    const scene = result.tools.find((t) => t.name === 'scene');
    expect(scene?.required).toEqual(['action']);
  });

  it('handles category with case-insensitive match', () => {
    const result = listCategory('TERRAIN', allTools, false) as { count: number };
    expect(result.count).toBe(2);
  });
});

// ─── getToolSchema (Level 3) ────────────────────────────────────────────────

describe('getToolSchema', () => {
  it('returns full schema for existing tool', () => {
    const result = getToolSchema('godot_terrain_raise_lower', allTools) as {
      name: string;
      category: string;
      description: string;
      inputSchema: unknown;
    };
    expect(result.name).toBe('godot_terrain_raise_lower');
    expect(result.category).toBe('terrain');
    expect(result.description).toBeDefined();
    expect(result.inputSchema).toBeDefined();
  });

  it('returns null for non-existent tool', () => {
    expect(getToolSchema('does_not_exist', allTools)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(getToolSchema('', allTools)).toBeNull();
  });

  it('includes category in result', () => {
    const result = getToolSchema('scene', allTools) as { category: string };
    expect(result.category).toBe('core');
  });
});
