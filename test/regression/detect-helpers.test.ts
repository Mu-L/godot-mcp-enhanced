// test/regression/detect-helpers.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  PROJECT_ROOT, countMatchesInFile, countMatchesInDir, fileContains, readSrc,
  _setProjectRootForTest,
} from './detect-helpers.js';

const TMP = join(tmpdir(), `mcp-m2-helpers-${Date.now()}`);

describe('detect-helpers', () => {
  beforeEach(() => {
    mkdirSync(join(TMP, 'src/tools'), { recursive: true });
    mkdirSync(join(TMP, 'src/core'), { recursive: true });
    _setProjectRootForTest(TMP);
  });
  afterEach(() => { rmSync(TMP, { recursive: true, force: true }); _setProjectRootForTest(undefined); });

  it('countMatchesInFile counts RegExp matches across lines', () => {
    writeFileSync(join(TMP, 'src/tools/a.ts'), 'args.x as string\nargs.y as number\nsafe line');
    expect(countMatchesInFile('src/tools/a.ts', /\bargs\.\w+\s+as\s+(string|number)/g)).toBe(2);
  });

  it('countMatchesInDir recursively sums matches filtered by fileFilter', () => {
    writeFileSync(join(TMP, 'src/tools/a.ts'), 'OS.execute("ls")');
    writeFileSync(join(TMP, 'src/core/b.ts'), 'OS.execute("rm")');
    writeFileSync(join(TMP, 'src/tools/c.gd'), 'OS.execute("gd")'); // 被 fileFilter 排除
    expect(countMatchesInDir('src', /OS\.execute\s*\(/g, /\.ts$/)).toBe(2);
  });

  it('fileContains returns boolean for pattern presence', () => {
    writeFileSync(join(TMP, 'src/core/b.ts'), 'const ws = "ws://localhost"');
    expect(fileContains('src/core/b.ts', /ws:\/\/localhost/)).toBe(true);
    expect(fileContains('src/core/b.ts', /wss:\/\//)).toBe(false);
  });

  it('readSrc returns file content', () => {
    writeFileSync(join(TMP, 'src/x.ts'), 'hello');
    expect(readSrc('src/x.ts')).toBe('hello');
  });

  it('countMatchesInFile returns 0 for missing file', () => {
    expect(countMatchesInFile('src/missing.ts', /x/g)).toBe(0);
  });
});
