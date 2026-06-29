import { describe, it, expect, afterEach } from 'vitest';
import { sanitizePath } from '../../src/core/path-security.js';
import { isPathInAllowedRoots } from '../../src/core/path-utils.js';

describe('sanitizePath', () => {
  afterEach(() => {
    delete process.env.GODOT_MCP_ALLOWED_ROOTS;
  });

  it('normalizes backslashes to forward slashes', () => {
    expect(sanitizePath('res://scenes\\main.tscn')).toBe('res://scenes/main.tscn');
  });

  it('merges double slashes', () => {
    expect(sanitizePath('res://scenes//main.tscn')).toBe('res://scenes/main.tscn');
  });

  it('rejects path traversal with ..', () => {
    expect(() => sanitizePath('res://../etc/passwd')).toThrow(/traversal/i);
  });

  it('allows res:// prefix', () => {
    expect(sanitizePath('res://scenes/main.tscn')).toBe('res://scenes/main.tscn');
  });

  it('allows user:// prefix', () => {
    expect(sanitizePath('user://save/game.dat')).toBe('user://save/game.dat');
  });

  it('rejects non-whitelisted prefix', () => {
    expect(() => sanitizePath('/etc/passwd')).toThrow(/prefix/i);
  });

  it('rejects illegal characters', () => {
    expect(() => sanitizePath('res://scenes/<script>.tscn')).toThrow(/illegal/i);
  });

  it('rejects control characters', () => {
    expect(() => sanitizePath('res://\x00evil')).toThrow(/illegal/i);
  });

  it('allows custom roots via opts.allowedRoots', () => {
    expect(sanitizePath('D:/custom/file.txt', {
      allowedRoots: ['D:/custom'],
    })).toBe('D:/custom/file.txt');
  });

  it('cannot remove default whitelist with opts', () => {
    expect(sanitizePath('res://scenes/main.tscn', {
      allowedRoots: ['D:/custom'],
    })).toBe('res://scenes/main.tscn');
  });

  it('accepts allowedRoots from env var', () => {
    process.env.GODOT_MCP_ALLOWED_ROOTS = 'D:/env-custom';
    expect(sanitizePath('D:/env-custom/file.txt')).toBe('D:/env-custom/file.txt');
  });
});

// G2: deny-by-default 专项覆盖 — 无 ALLOWED_PROJECT_PATHS + 非 UNRESTRICTED 时,
// 路径必须被拒(C-07: restrict to cwd)。isPathInAllowedRoots 无缓存,删 env 即时生效。
describe('isPathInAllowedRoots deny-by-default (G2)', () => {
  it('denies paths outside cwd when no ALLOWED_PROJECT_PATHS and UNRESTRICTED unset', () => {
    const prevU = process.env.GODOT_MCP_UNRESTRICTED;
    delete process.env.GODOT_MCP_UNRESTRICTED;
    delete process.env.GODOT_MCP_ALLOWED_ROOTS;
    try {
      // 项目 cwd 外的系统路径 → 不在 cwd → deny-by-default 返回 false
      const outside = process.platform === 'win32' ? 'C:/Windows/System32' : '/etc';
      expect(isPathInAllowedRoots(outside)).toBe(false);
    } finally {
      if (prevU !== undefined) process.env.GODOT_MCP_UNRESTRICTED = prevU;
    }
  });
});
