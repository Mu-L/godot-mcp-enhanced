import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, sep } from 'node:path';

import { validatePath, resolveWithinRoot } from '../build/helpers.js';

describe('validatePath', () => {
  it('resolves relative paths to absolute', () => {
    const result = validatePath('some/relative/path');
    assert.strictEqual(result, resolve('some/relative/path'));
  });

  it('passes through absolute paths unchanged', () => {
    const abs = resolve('/tmp/test');
    assert.strictEqual(validatePath(abs), abs);
  });
});

describe('resolveWithinRoot', () => {
  const root = resolve('/tmp/test-project');

  it('resolves a simple relative path within root', () => {
    const result = resolveWithinRoot(root, 'scripts/player.gd');
    assert.strictEqual(result, resolve(root, 'scripts/player.gd'));
  });

  it('rejects parent traversal with ..', () => {
    assert.throws(
      () => resolveWithinRoot(root, '../../../etc/passwd'),
      { message: /Path traversal detected/ }
    );
  });

  it('rejects absolute path outside root', () => {
    assert.throws(
      () => resolveWithinRoot(root, '/etc/passwd'),
      { message: /Path traversal detected/ }
    );
  });

  it('accepts paths after stripping res:// prefix', () => {
    const result = resolveWithinRoot(root, 'res://scenes/main.tscn'.replace('res://', ''));
    assert.ok(result.startsWith(root));
  });

  it('handles deep relative paths within root', () => {
    const result = resolveWithinRoot(root, 'a/b/c/d/file.gd');
    assert.ok(result.startsWith(root + sep));
  });
});
