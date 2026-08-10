import { describe, it, expect } from 'vitest';
import { toolNameToRoute, classifyError, isUnknownRouteResult } from '../../src/core/dynamic-routes.js';

describe('toolNameToRoute', () => {
  it('converts standard tool name to route', () => {
    expect(toolNameToRoute('godot_custom_light_bake')).toBe('custom/light-bake');
  });

  it('converts two-part tool name', () => {
    expect(toolNameToRoute('godot_terrain_sculpt')).toBe('terrain/sculpt');
  });

  it('converts multi-segment tool name', () => {
    expect(toolNameToRoute('godot_animation_play_forward')).toBe('animation/play-forward');
  });

  it('returns null for non-godot prefix', () => {
    expect(toolNameToRoute('custom_light_bake')).toBeNull();
  });

  it('returns null for single-segment after prefix', () => {
    expect(toolNameToRoute('godot_animation')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(toolNameToRoute('')).toBeNull();
  });

  it('returns null for just the prefix', () => {
    expect(toolNameToRoute('godot_')).toBeNull();
  });
});

describe('classifyError', () => {
  it('classifies 4xx as permanent', () => {
    expect(classifyError(400)).toBe('permanent');
    expect(classifyError(404)).toBe('permanent');
    expect(classifyError(422)).toBe('permanent');
  });

  it('classifies 5xx as transient', () => {
    expect(classifyError(500)).toBe('transient');
    expect(classifyError(502)).toBe('transient');
    expect(classifyError(503)).toBe('transient');
  });

  it('classifies other status codes as permanent', () => {
    expect(classifyError(200)).toBe('permanent');
    expect(classifyError(301)).toBe('permanent');
  });
});

describe('isUnknownRouteResult', () => {
  it('returns false for null/undefined/empty', () => {
    expect(isUnknownRouteResult(null)).toBe(false);
    expect(isUnknownRouteResult(undefined)).toBe(false);
    expect(isUnknownRouteResult('')).toBe(false);
  });

  it('detects "Unknown route" in object error field', () => {
    expect(isUnknownRouteResult({ error: 'Unknown route: foo/bar' })).toBe(true);
  });

  it('detects "Unknown API endpoint" in nested data.error', () => {
    expect(isUnknownRouteResult({ data: { error: 'Unknown API endpoint' } })).toBe(true);
  });

  it('detects "HTTP 404" in message field', () => {
    expect(isUnknownRouteResult({ message: 'HTTP 404: not found' })).toBe(true);
  });

  it('detects "Unknown method" signature', () => {
    expect(isUnknownRouteResult({ error: 'Unknown method: foo' })).toBe(true);
  });

  it('detects "Unknown command" signature', () => {
    expect(isUnknownRouteResult({ error: 'Unknown command: foo' })).toBe(true);
  });

  it('detects in Error object', () => {
    expect(isUnknownRouteResult(new Error('Unknown route: foo/bar'))).toBe(true);
  });

  it('detects in plain string', () => {
    expect(isUnknownRouteResult('Error: Unknown route foo')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isUnknownRouteResult({ error: 'unknown ROUTE: foo' })).toBe(true);
    expect(isUnknownRouteResult({ error: 'UNKNOWN API ENDPOINT' })).toBe(true);
  });

  it('returns false for non-route errors', () => {
    expect(isUnknownRouteResult({ error: 'Node not found' })).toBe(false);
    expect(isUnknownRouteResult({ error: 'Invalid params' })).toBe(false);
    expect(isUnknownRouteResult({ message: 'permission denied' })).toBe(false);
  });

  it('returns false for success objects', () => {
    expect(isUnknownRouteResult({ success: true, data: {} })).toBe(false);
  });

  it('returns false for plain objects without error/message', () => {
    expect(isUnknownRouteResult({ foo: 'bar' })).toBe(false);
  });
});
