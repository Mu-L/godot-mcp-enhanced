/**
 * args-validator 测试 — validateArgs 各 JSON schema 关键字正反例
 */
import { describe, it, expect } from 'vitest';
import { validateArgs } from '../src/core/args-validator.js';

describe('validateArgs', () => {
  // ── type ──
  it('type: 字段类型正确 → ok;错误 → error', () => {
    const schema = { type: 'object', properties: { name: { type: 'string' }, count: { type: 'number' } }, required: ['name'] };
    expect(validateArgs({ name: 'x', count: 1 }, schema).ok).toBe(true);
    const r = validateArgs({ name: 'x', count: 'bad' }, schema);
    expect(r.ok).toBe(false);
    expect(r.errors.join(';')).toContain('count');
    expect(r.errors.join(';')).toContain('number');
  });

  it('type 数组: ["string","null"] 接受 string 或 null,拒 number', () => {
    const schema = { type: 'object', properties: { v: { type: ['string', 'null'] } } };
    expect(validateArgs({ v: 's' }, schema).ok).toBe(true);
    expect(validateArgs({ v: null }, schema).ok).toBe(true);
    expect(validateArgs({ v: 1 }, schema).ok).toBe(false);
  });

  // ── required ──
  it('required: 缺必填字段 → error', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] };
    expect(validateArgs({}, schema).ok).toBe(false);
    expect(validateArgs({}, schema).errors.join(';')).toContain('a');
  });

  // ── enum ──
  it('enum: 非法值 → error', () => {
    const schema = { type: 'object', properties: { action: { type: 'string', enum: ['read', 'write'] } } };
    expect(validateArgs({ action: 'read' }, schema).ok).toBe(true);
    const r = validateArgs({ action: 'delete' }, schema);
    expect(r.ok).toBe(false);
    expect(r.errors.join(';')).toContain('enum');
  });

  // ── items 递归(batch-tools files[] 模式)──
  it('items 递归: array of object 嵌套 properties+required,深层错类型 → error', () => {
    const schema = {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: { path: { type: 'string' }, content: { type: 'string' } },
            required: ['path', 'content'],
          },
        },
      },
    };
    expect(validateArgs({ files: [{ path: 'a', content: 'b' }] }, schema).ok).toBe(true);
    // 深层:items 缺 required
    const r1 = validateArgs({ files: [{ path: 'a' }] }, schema);
    expect(r1.ok).toBe(false);
    expect(r1.errors.join(';')).toContain('content');
    // 深层:items 字段错类型
    const r2 = validateArgs({ files: [{ path: 1, content: 'b' }] }, schema);
    expect(r2.ok).toBe(false);
    expect(r2.errors.join(';')).toContain('path');
  });

  // ── 嵌套 properties ──
  it('properties 嵌套: 子对象字段验证', () => {
    const schema = { type: 'object', properties: { opts: { type: 'object', properties: { depth: { type: 'number' } } } } };
    expect(validateArgs({ opts: { depth: 3 } }, schema).ok).toBe(true);
    const r = validateArgs({ opts: { depth: 'x' } }, schema);
    expect(r.ok).toBe(false);
    expect(r.errors.join(';')).toContain('depth');
  });

  // ── 未知字段允许 ──
  it('未知字段允许(additionalProperties 不拒)', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } } };
    expect(validateArgs({ a: 'x', unknown: 1 }, schema).ok).toBe(true);
  });
});
