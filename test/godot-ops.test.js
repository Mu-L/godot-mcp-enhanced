import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeNodePath, gdEscape, validateVector3,
  TYPE_WHITELIST,
} from '../build/tools/shared.js';
import { genNavQueryScript } from '../build/tools/navigation.js';

describe('normalizeNodePath', () => {
  it('prepends / if missing', () => {
    assert.strictEqual(normalizeNodePath('root/Player'), '/root/Player');
  });
  it('keeps /root/... unchanged', () => {
    assert.strictEqual(normalizeNodePath('/root/Player'), '/root/Player');
  });
  it('rejects empty string', () => {
    assert.throws(() => normalizeNodePath(''), { message: /empty/ });
  });
  it('rejects whitespace-only', () => {
    assert.throws(() => normalizeNodePath('   '), { message: /empty/ });
  });
  it('rejects res:// paths', () => {
    assert.throws(() => normalizeNodePath('res://scenes/main.tscn'), { message: /scene tree path/ });
  });
  it('trims whitespace', () => {
    assert.strictEqual(normalizeNodePath('  /root/Player  '), '/root/Player');
  });
});

describe('gdEscape', () => {
  it('escapes double quotes', () => {
    assert.strictEqual(gdEscape('say "hello"'), 'say \\"hello\\"');
  });
  it('escapes backslashes', () => {
    assert.strictEqual(gdEscape('path\\to\\file'), 'path\\\\to\\\\file');
  });
  it('escapes newlines', () => {
    assert.strictEqual(gdEscape('line1\nline2'), 'line1\\nline2');
  });
  it('escapes CRLF', () => {
    assert.strictEqual(gdEscape('a\r\nb'), 'a\\nb');
  });
  it('removes null bytes', () => {
    assert.strictEqual(gdEscape('a\0b'), 'ab');
  });
  it('preserves unicode', () => {
    assert.strictEqual(gdEscape('你好世界'), '你好世界');
  });
  it('handles empty string', () => {
    assert.strictEqual(gdEscape(''), '');
  });
});

describe('validateVector3', () => {
  it('accepts valid {x,y,z}', () => {
    assert.deepStrictEqual(validateVector3({ x: 1, y: 2, z: 3 }), { x: 1, y: 2, z: 3 });
  });
  it('accepts zero values', () => {
    assert.deepStrictEqual(validateVector3({ x: 0, y: 0, z: 0 }), { x: 0, y: 0, z: 0 });
  });
  it('accepts negative values', () => {
    assert.deepStrictEqual(validateVector3({ x: -1, y: -2.5, z: -3 }), { x: -1, y: -2.5, z: -3 });
  });
  it('rejects missing field', () => {
    assert.throws(() => validateVector3({ x: 1, y: 2 }), { message: /finite number/ });
  });
  it('rejects non-number value', () => {
    assert.throws(() => validateVector3({ x: '1', y: 2, z: 3 }), { message: /finite number/ });
  });
  it('rejects null', () => {
    assert.throws(() => validateVector3(null), { message: /object/ });
  });
  it('rejects NaN', () => {
    assert.throws(() => validateVector3({ x: NaN, y: 0, z: 0 }), { message: /finite number/ });
  });
  it('rejects Infinity', () => {
    assert.throws(() => validateVector3({ x: 0, y: Infinity, z: 0 }), { message: /finite number/ });
  });
});

describe('TYPE_WHITELIST', () => {
  it('contains Node3D', () => { assert.ok(TYPE_WHITELIST.includes('Node3D')); });
  it('contains MeshInstance3D', () => { assert.ok(TYPE_WHITELIST.includes('MeshInstance3D')); });
  it('contains Camera3D', () => { assert.ok(TYPE_WHITELIST.includes('Camera3D')); });
  it('contains RigidBody3D', () => { assert.ok(TYPE_WHITELIST.includes('RigidBody3D')); });
  it('does NOT contain Node', () => { assert.ok(!TYPE_WHITELIST.includes('Node')); });
});

describe('genNavQueryScript', () => {
  it('contains NavigationServer3D.map_get_path', () => {
    const script = genNavQueryScript({x:0,y:0,z:0}, {x:10,y:0,z:10});
    assert.ok(script.includes('NavigationServer3D.map_get_path'));
    assert.ok(script.includes('Vector3(0, 0, 0)'));
    assert.ok(script.includes('Vector3(10, 0, 10)'));
  });
  it('includes region lookup when provided', () => {
    const script = genNavQueryScript({x:0,y:0,z:0}, {x:10,y:0,z:10}, '/root/NavRegion');
    assert.ok(script.includes('NavigationRegion3D'));
    assert.ok(script.includes('/root/NavRegion'));
  });
  it('includes fallback maps logic', () => {
    const script = genNavQueryScript({x:0,y:0,z:0}, {x:10,y:0,z:10});
    assert.ok(script.includes('get_maps'));
    assert.ok(script.includes('warning'));
  });
});
