import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, mkdtempSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readJsonConfigWithBackup, readJsonForCheck, stripBom } from '../../../src/cli/clients/json-config.js';

const BOM = String.fromCharCode(0xFEFF);

describe('stripBom', () => {
  it('strips UTF-8 BOM', () => {
    expect(stripBom(BOM + '{"a":1}')).toBe('{"a":1}');
  });
  it('passes through non-BOM string', () => {
    expect(stripBom('{"a":1}')).toBe('{"a":1}');
  });
});

describe('readJsonConfigWithBackup', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mcp-json-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns {} when file not found', () => {
    expect(readJsonConfigWithBackup(join(dir, 'no.json'))).toEqual({});
  });
  it('parses valid JSON with BOM', () => {
    const p = join(dir, 'bom.json');
    writeFileSync(p, BOM + '{"mcpServers":{"godot":{}}}');
    expect(readJsonConfigWithBackup(p)).toEqual({ mcpServers: { godot: {} } });
  });
  it('backs up corrupted JSON and returns {}', () => {
    const p = join(dir, 'bad.json');
    const corrupt = '{ broken';
    writeFileSync(p, corrupt);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = readJsonConfigWithBackup(p);
    expect(result).toEqual({});
    const backups = readdirSync(dir).filter(f => f.startsWith('bad.json.corrupt.'));
    expect(backups.length).toBe(1);
    expect(readFileSync(join(dir, backups[0]!), 'utf-8')).toBe(corrupt);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('readJsonForCheck', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mcp-chk-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns null when file not found', () => {
    expect(readJsonForCheck(join(dir, 'no.json'))).toBeNull();
  });
  it('parses valid JSON with BOM', () => {
    const p = join(dir, 'bom.json');
    writeFileSync(p, BOM + '{"mcpServers":{"godot":{}}}');
    expect(readJsonForCheck(p)).toEqual({ mcpServers: { godot: {} } });
  });
  it('returns null for corrupted JSON', () => {
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{ broken');
    expect(readJsonForCheck(p)).toBeNull();
  });
});
