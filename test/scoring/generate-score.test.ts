import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { generateScore } from '../../src/scoring/generate-score.js';

const TMP = resolve(process.cwd(), 'test', 'scoring', '__tmp_gen__');
const LCOV = resolve(TMP, 'lcov.info');
const OUT = resolve(TMP, 'score.json');

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe('generateScore', () => {
  it('读 lcov → 写 score.json,coverage 维度有值,其余 5 维 n/a', () => {
    writeFileSync(LCOV, ['SF:src/a.ts', 'DA:1,1', 'DA:2,1', 'end_of_record'].join('\n'));
    const s = generateScore({ lcovPath: LCOV, outPath: OUT, godotVersion: '4.6' });
    expect(s.total).toBe(100);
    expect(s.pass).toBe(true);
    expect(s.partial).toBe(true);
    expect(s.dimensions.coverage.status).toBe('pass');
    expect(s.dimensions.security.status).toBe('na');
    expect(s.unverified).toHaveLength(5);
    expect(s.unverified).not.toContain('coverage');

    // 文件落地
    expect(existsSync(OUT)).toBe(true);
    const onDisk = JSON.parse(readFileSync(OUT, 'utf8'));
    expect(onDisk.total).toBe(100);
    expect(onDisk.godotVersion).toBe('4.6');
  });

  it('lcov 缺失 → coverage 也 n/a,total=0,pass=false', () => {
    const s = generateScore({ lcovPath: resolve(TMP, 'nope.info'), outPath: OUT });
    expect(s.total).toBe(0);
    expect(s.pass).toBe(false);
    expect(s.unverified).toHaveLength(6);
  });

  it('生成的 JSON 含 generatedAt(ISO 字符串)', () => {
    writeFileSync(LCOV, ['SF:x', 'DA:1,1', 'end_of_record'].join('\n'));
    const s = generateScore({ lcovPath: LCOV, outPath: OUT });
    expect(() => new Date(s.generatedAt).toISOString()).not.toThrow();
  });
});
