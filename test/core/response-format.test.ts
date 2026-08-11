import { describe, it, expect } from 'vitest';
import {
  compactStringify,
  firstSentence,
  looksLikeErrorObject,
  isErrorText,
} from '../../src/core/response-format.js';

describe('compactStringify', () => {
  it('produces compact JSON by default', () => {
    expect(compactStringify({ a: 1, b: [2, 3] })).toBe('{"a":1,"b":[2,3]}');
  });

  it('handles primitives', () => {
    expect(compactStringify('hello')).toBe('"hello"');
    expect(compactStringify(42)).toBe('42');
    expect(compactStringify(null)).toBe('null');
  });

  it('handles nested objects', () => {
    expect(compactStringify({ x: { y: { z: 1 } } })).toBe('{"x":{"y":{"z":1}}}');
  });
});

describe('firstSentence', () => {
  it('returns undefined for empty/undefined input', () => {
    expect(firstSentence(undefined)).toBeUndefined();
    expect(firstSentence('')).toBeUndefined();
    expect(firstSentence(null)).toBeUndefined();
  });

  it('extracts first sentence ending with period+space', () => {
    expect(firstSentence('Hello world. Second sentence.')).toBe('Hello world.');
  });

  it('skips e.g. abbreviation', () => {
    expect(firstSentence('Use tools e.g. hammer. Next sentence.')).toBe('Use tools e.g. hammer.');
  });

  it('skips i.e. abbreviation', () => {
    expect(firstSentence('Foo, i.e. bar. Next.')).toBe('Foo, i.e. bar.');
  });

  it('returns full text when no sentence boundary', () => {
    expect(firstSentence('No period here')).toBe('No period here');
  });

  it('truncates over 160 chars', () => {
    const long = 'A'.repeat(200) + '. Next.';
    const result = firstSentence(long);
    expect(result).toHaveLength(160); // 157 chars + "..."
    expect(result!.endsWith('...')).toBe(true);
  });

  it('handles Chinese text (no period-space boundary)', () => {
    const cn = '这是一个中文描述,没有句点空格边界,所以返回全文';
    expect(firstSentence(cn)).toBe(cn);
  });

  it('truncates long Chinese text', () => {
    const cn = '中'.repeat(200);
    const result = firstSentence(cn);
    expect(result!.endsWith('...')).toBe(true);
    expect(result!.length).toBe(160);
  });
});

describe('looksLikeErrorObject', () => {
  it('returns false for non-objects', () => {
    expect(looksLikeErrorObject(null)).toBe(false);
    expect(looksLikeErrorObject(undefined)).toBe(false);
    expect(looksLikeErrorObject('string')).toBe(false);
    expect(looksLikeErrorObject(42)).toBe(false);
  });

  it('returns false for arrays', () => {
    expect(looksLikeErrorObject([1, 2, 3])).toBe(false);
  });

  it('detects {success: false}', () => {
    expect(looksLikeErrorObject({ success: false })).toBe(true);
  });

  it('detects {ok: false}', () => {
    expect(looksLikeErrorObject({ ok: false })).toBe(true);
  });

  it('detects {error: "string"} (unity shape)', () => {
    expect(looksLikeErrorObject({ error: 'boom' })).toBe(true);
  });

  it('detects {error: {message: "string"}} (unity nested shape)', () => {
    expect(looksLikeErrorObject({ error: { message: 'boom' } })).toBe(true);
  });

  it('detects {error_code, message} (godot advanced-proxy shape)', () => {
    expect(looksLikeErrorObject({ error_code: 'UNKNOWN_TOOL', message: 'not found' })).toBe(true);
  });

  it('does NOT flag message-only without error_code (M1: recording.ts {status:ok, message})', () => {
    // 修复:原 message-only 检查误判 {status:'ok', message:'...'} 为错误(recording.ts:317)
    expect(looksLikeErrorObject({ message: 'No events to play' })).toBe(false);
    expect(looksLikeErrorObject({ status: 'ok', events_played: 0, message: 'No events to play' })).toBe(false);
  });

  it('respects explicit success: true over error field', () => {
    // 状态查询类工具带 error 字段但 success=true 不算失败
    expect(looksLikeErrorObject({ success: true, error: 'some warning' })).toBe(false);
  });

  it('respects explicit ok: true over message field', () => {
    expect(looksLikeErrorObject({ ok: true, message: 'info' })).toBe(false);
  });

  it('ignores empty error string', () => {
    expect(looksLikeErrorObject({ error: '' })).toBe(false);
  });

  it('ignores empty message string', () => {
    expect(looksLikeErrorObject({ message: '' })).toBe(false);
  });

  it('returns false for plain success object', () => {
    expect(looksLikeErrorObject({ success: true, data: { x: 1 } })).toBe(false);
  });

  it('returns false for neutral object', () => {
    expect(looksLikeErrorObject({ foo: 'bar' })).toBe(false);
  });
});

describe('isErrorText', () => {
  it('returns false for empty/non-string', () => {
    expect(isErrorText('')).toBe(false);
  });

  it('detects JSON {success: false}', () => {
    expect(isErrorText('{"success":false,"error":"boom"}')).toBe(true);
  });

  it('detects JSON {error: "string"}', () => {
    expect(isErrorText('{"error":"something failed"}')).toBe(true);
  });

  it('detects JSON {ok: false}', () => {
    expect(isErrorText('{"ok":false}')).toBe(true);
  });

  it('detects godot opsError shape', () => {
    expect(isErrorText('{"success":false,"error":"msg","error_code":"NODE_NOT_FOUND"}')).toBe(true);
  });

  it('detects bridged envelope (outer ok, inner data error)', () => {
    expect(isErrorText('{"success":true,"data":{"success":false,"error":"inner"}}')).toBe(true);
  });

  it('returns false for success JSON', () => {
    expect(isErrorText('{"success":true,"data":{"x":1}}')).toBe(false);
  });

  it('returns false for neutral JSON', () => {
    expect(isErrorText('{"foo":"bar"}')).toBe(false);
  });

  it('returns false for invalid JSON (falls through to text check)', () => {
    expect(isErrorText('{not valid json')).toBe(false);
  });

  it('detects "Error:" prefix text', () => {
    expect(isErrorText('Error: something went wrong')).toBe(true);
  });

  it('detects "Error " prefix text', () => {
    expect(isErrorText('Error something went wrong')).toBe(true);
  });

  it('returns false for normal text', () => {
    expect(isErrorText('just some output')).toBe(false);
  });

  it('returns false for JSON array without error', () => {
    expect(isErrorText('[1,2,3]')).toBe(false);
  });
});
