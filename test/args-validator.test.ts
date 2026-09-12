/**
 * args-validator 测试 — validateArgs 各 JSON schema 关键字正反例
 */
import { describe, it, expect } from 'vitest';
import { validateArgs, similarity, checkUnknownParams } from '../src/core/args-validator.js';

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

  // ── P8-2 (2026-09-11): 未知字段语义反转——regiellis 移植后顶层 unknown 拒 + did-you-mean ──
  it('未知字段拒(P8-2 语义反转,regiellis 移植)+ did-you-mean 提示', () => {
    const schema = { type: 'object', properties: { alpha: { type: 'string' } } };
    const r = validateArgs({ alpha: 'x', alpah: 1 }, schema);  // 换位 typo(编辑距离 2/5 → sim 0.6)
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('未知参数');
    expect(r.errors.join(' ')).toContain("想传 'alpha'");
  });

  it('未知字段:相似度 <0.4 无 did-you-mean,列出全部声明参数', () => {
    const schema = { type: 'object', properties: { alpha: { type: 'string' } } };
    const r = validateArgs({ alpha: 'x', zzzz: 1 }, schema);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('不是已声明参数');
    expect(r.errors.join(' ')).not.toContain('想传');
  });

  it('无 properties 的 schema(自由 dict 工具)不查 unknown', () => {
    const r = validateArgs({ anything: 1, goes: 2 }, { type: 'object' });
    expect(r.ok).toBe(true);
  });

  it('checkUnknownParams: 全部声明则空;dispatcher 级公共键豁免(P8 审查 B-1 清偿)', () => {
    expect(checkUnknownParams({ a: 1 }, { a: {} })).toEqual([]);
    expect(checkUnknownParams({ a: 1, b: 2 }, { a: {} }).length).toBe(1);
    // godot_path 是 ToolDispatcher 对所有工具的 per-call 覆盖键(消费在 validateArgs 之前),
    // 未声明它的 ~19 个 headless 工具(particles/tilemap/signal/...)同样支持——豁免防
    // "dispatcher 消费了却被 unknown 拒"的自相矛盾(与 check-ssot-params.mjs 特判同源)
    expect(checkUnknownParams({ a: 1, godot_path: 'D:/x.exe' }, { a: {} })).toEqual([]);
    const r = validateArgs({ a: 'x', godot_path: 'D:/x.exe' }, { type: 'object', properties: { a: { type: 'string' } } });
    expect(r.ok, 'validateArgs 全链路同样豁免').toBe(true);
  });

  it('similarity:相同=1/空=0/编辑距离比率(Levenshtein,对齐 GD String.similarity)', () => {
    expect(similarity('abc', 'abc')).toBe(1);
    expect(similarity('', 'abc')).toBe(0);
    expect(similarity('ab', 'ax')).toBeCloseTo(0.5, 5);
    expect(similarity('pattern', 'patern')).toBeGreaterThanOrEqual(0.4); // did-you-mean 阈内
    expect(similarity('pattern', 'zzzzzzz')).toBeLessThan(0.4);
  });
});
