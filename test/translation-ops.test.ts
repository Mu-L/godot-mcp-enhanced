// test/translation-ops.test.ts — P1-2 翻译工具:CSV/PO 解析纯函数 + 注册器 + handler 集成
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { isolatePathEnv } from './helpers/path-isolation.js';
import {
  parseCsvRecords, serializeCsvLine, parseTranslationCsv, serializeTranslationCsv,
  parseTranslationPo, registerTranslationsInProjectGodot, handleTool, TOOL_META,
  getToolDefinitions,
} from '../src/tools/translation-ops.js';

// ─── CSV 纯函数 ──────────────────────────────────────────────────────────────

describe('CSV parse/serialize', () => {
  it('parses simple record', () => {
    expect(parseCsvRecords('keys,en,fr')).toEqual([['keys', 'en', 'fr']]);
  });

  it('parses multiple records with trailing newline', () => {
    expect(parseCsvRecords('a,b\nc,d\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('parses quoted field with comma', () => {
    expect(parseCsvRecords('GREETING,"Hello, world",Bonjour')).toEqual([['GREETING', 'Hello, world', 'Bonjour']]);
  });

  it('parses escaped double quotes', () => {
    expect(parseCsvRecords('K,"say ""hi""",x')).toEqual([['K', 'say "hi"', 'x']]);
  });

  it('I-1 回归:引号内换行是字段内容,不是记录分隔(RFC 4180)', () => {
    const csv = 'keys,en\nMULTI,"line1\nline2"\nAFTER,ok\n';
    expect(parseCsvRecords(csv)).toEqual([
      ['keys', 'en'],
      ['MULTI', 'line1\nline2'],
      ['AFTER', 'ok'],
    ]);
  });

  it('I-1 回归:serialize→parse 文件级往返保留含换行字段', () => {
    const languages = ['en'];
    const entries = { MULTI: { en: 'line1\nline2' }, PLAIN: { en: 'x' } };
    const csv = serializeTranslationCsv(languages, entries);
    const parsed = parseTranslationCsv(csv);
    expect(parsed.entries.MULTI).toEqual({ en: 'line1\nline2' });
    expect(parsed.entries.PLAIN).toEqual({ en: 'x' });
  });

  it('round-trips tricky fields', () => {
    const fields = ['key,1', 'quote"inside', 'line\nbreak', 'plain'];
    const line = serializeCsvLine(fields);
    expect(parseCsvRecords(line)).toEqual([fields]);
  });

  it('parses Godot translation csv', () => {
    const csv = 'keys,en,zh_CN\nGREETING,Hello,你好\nBYE,Bye,再见\n';
    const parsed = parseTranslationCsv(csv);
    expect(parsed.languages).toEqual(['en', 'zh_CN']);
    expect(parsed.entries.GREETING).toEqual({ en: 'Hello', zh_CN: '你好' });
  });

  it('rejects csv without keys header', () => {
    expect(() => parseTranslationCsv('en,fr\na,b\n')).toThrow(/keys/);
  });

  it('serialize → parse round-trip keeps entries', () => {
    const languages = ['en', 'zh_CN'];
    const entries = { 'MSG,A': { en: 'a"b', zh_CN: '甲' }, MSG2: { en: 'x' } };
    const csv = serializeTranslationCsv(languages, entries);
    const parsed = parseTranslationCsv(csv);
    expect(parsed.entries['MSG,A']).toEqual({ en: 'a"b', zh_CN: '甲' });
    expect(parsed.entries.MSG2).toEqual({ en: 'x' });
  });
});

// ─── PO 解析 ─────────────────────────────────────────────────────────────────

describe('PO parse', () => {
  it('extracts msgid/msgstr pairs and Language header', () => {
    const po = `msgid ""
msgstr ""
"Language: fr\\n"

msgid "GREETING"
msgstr "Bonjour"

msgid "BYE"
msgstr "Au revoir"
`;
    const parsed = parseTranslationPo(po);
    expect(parsed.language).toBe('fr');
    expect(parsed.entries.GREETING).toBe('Bonjour');
    expect(parsed.entries.BYE).toBe('Au revoir');
    expect(parsed.entries['']).toBeUndefined(); // header 条目剔除
  });

  it('handles multi-line msgid/msgstr', () => {
    const po = 'msgid "line1"\n"line2"\nmsgstr "第一行"\n"第二行"\n';
    const parsed = parseTranslationPo(po);
    expect(parsed.entries['line1line2']).toBe('第一行第二行');
  });

  it('N-1 回归:字面反斜杠序列不被误译为换行', () => {
    // PO 源里 "C:\\new"(字节 C:\\\\new)应解析为 C:\new 而非 C:+LF+ew
    const po = 'msgid "PATH"\nmsgstr "C:\\\\new\\\\dir"\n';
    const parsed = parseTranslationPo(po);
    expect(parsed.entries.PATH).toBe('C:\\new\\dir');
  });
});

// ─── project.godot 注册器 ────────────────────────────────────────────────────

describe('registerTranslationsInProjectGodot', () => {
  let dir: string;
  let godotPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'trans-reg-'));
    godotPath = join(dir, 'project.godot');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('appends [internationalization] section when absent', () => {
    writeFileSync(godotPath, '[application]\n\nconfig/name="Test"\n');
    const r = registerTranslationsInProjectGodot(godotPath, ['res://translations/en.translation'], false);
    expect(r.changed).toBe(true);
    expect(r.translations).toEqual(['res://translations/en.translation']);
    const content = readFileSync(godotPath, 'utf-8');
    expect(content).toContain('[internationalization]');
    expect(content).toContain('locale/translations=PackedStringArray("res://translations/en.translation")');
    expect(content).toContain('[application]'); // 原内容保留
  });

  it('merges into existing translations line, dedup', () => {
    writeFileSync(godotPath, '[internationalization]\n\nlocale/translations=PackedStringArray("res://a.translation")\n');
    const r = registerTranslationsInProjectGodot(godotPath, ['res://a.translation', 'res://b.po'], false);
    expect(r.changed).toBe(true);
    expect(r.translations).toEqual(['res://a.translation', 'res://b.po']);
    // 再注册一次 → 无变更
    const r2 = registerTranslationsInProjectGodot(godotPath, ['res://a.translation'], false);
    expect(r2.changed).toBe(false);
  });

  it('remove=true takes entries out', () => {
    writeFileSync(godotPath, '[internationalization]\n\nlocale/translations=PackedStringArray("res://a.translation", "res://b.po")\n');
    const r = registerTranslationsInProjectGodot(godotPath, ['res://b.po'], true);
    expect(r.changed).toBe(true);
    expect(r.translations).toEqual(['res://a.translation']);
  });

  it('inserts into existing section without the line (段内追加,不破坏下一段)', () => {
    writeFileSync(godotPath, '[internationalization]\n\nlocale/fallback="en"\n\n[rendering]\n\nrenderer/rendering_method="gl_compatibility"\n');
    const r = registerTranslationsInProjectGodot(godotPath, ['res://a.po'], false);
    expect(r.changed).toBe(true);
    const content = readFileSync(godotPath, 'utf-8');
    expect(content.indexOf('locale/fallback')).toBeLessThan(content.indexOf('locale/translations'));
    expect(content.indexOf('locale/translations')).toBeLessThan(content.indexOf('[rendering]'));
  });
});

// ─── handler 集成(白名单 env + tmp 项目) ───────────────────────────────────

describe('translation handler', () => {
  let proj: string;
  let restore: () => void;
  const makeCtx = () => ({}) as unknown as Parameters<typeof handleTool>[2];

  beforeEach(() => {
    proj = mkdtempSync(join(tmpdir(), 'trans-handler-'));
    writeFileSync(join(proj, 'project.godot'), '[application]\n');
    restore = isolatePathEnv({ allowed: [proj] });
  });
  afterEach(() => {
    restore();
    rmSync(proj, { recursive: true, force: true });
  });

  const run = (args: Record<string, unknown>) => handleTool('translation', { project_path: proj, ...args }, makeCtx());
  const parse = (r: { content: { type: string; text?: string }[] }) =>
    JSON.parse((Array.isArray(r!.content) ? r!.content[0]!.text : '')!);

  it('契约:1 tool named translation,3 actions,风险 read/write/write', () => {
    const defs = getToolDefinitions();
    expect(defs[0]!.name).toBe('translation');
    expect(defs[0]!.inputSchema.properties.action.enum).toEqual(['translation_read', 'translation_write', 'translation_register']);
    const risks = TOOL_META.translation!.actionRisks!;
    expect(risks.translation_read).toBe('read');
    expect(risks.translation_write).toBe('write');
    expect(risks.translation_register).toBe('write');
  });

  it('write → read csv round-trip(含引号逗号)', async () => {
    const w = parse((await run({
      action: 'translation_write', path: 'res://translations/messages.csv',
      languages: ['en', 'zh_CN'],
      entries: { 'GREET,A': { en: 'Hello, "world"', zh_CN: '你好' } },
    }))!);
    expect(w.success).toBe(true);
    const r = parse((await run({ action: 'translation_read', path: 'res://translations/messages.csv' }))!);
    expect(r.success).toBe(true);
    expect(r.data.languages).toEqual(['en', 'zh_CN']);
    expect(r.data.entries['GREET,A']).toEqual({ en: 'Hello, "world"', zh_CN: '你好' });
  });

  it('read po', async () => {
    writeFileSync(join(proj, 'messages.po'), 'msgid ""\nmsgstr ""\n"Language: ja\\n"\n\nmsgid "HI"\nmsgstr "こんにちは"\n');
    const r = parse((await run({ action: 'translation_read', path: 'res://messages.po' }))!);
    expect(r.success).toBe(true);
    expect(r.data.format).toBe('po');
    expect(r.data.language).toBe('ja');
    expect(r.data.entries.HI).toBe('こんにちは');
  });

  it('register merges into project.godot and is idempotent', async () => {
    mkdirSync(join(proj, 'translations'), { recursive: true });
    writeFileSync(join(proj, 'translations', 'en.translation'), '');
    const r1 = parse((await run({ action: 'translation_register', paths: ['res://translations/en.translation'] }))!);
    expect(r1.success).toBe(true);
    expect(r1.data.changed).toBe(true);
    const r2 = parse((await run({ action: 'translation_register', paths: ['res://translations/en.translation'] }))!);
    expect(r2.data.changed).toBe(false); // 幂等
    const content = readFileSync(join(proj, 'project.godot'), 'utf-8');
    expect(content).toContain('"res://translations/en.translation"');
  });

  it('register rejects nonexistent file(防手滑注册幽灵路径)', async () => {
    const r = parse((await run({ action: 'translation_register', paths: ['res://ghost.translation'] }))!);
    expect(r.success).toBe(false);
    expect(r.error_code).toBe('FILE_NOT_FOUND');
  });

  it('register rejects csv(需先经编辑器导入)', async () => {
    writeFileSync(join(proj, 'a.csv'), 'keys,en\nA,a\n');
    const r = parse((await run({ action: 'translation_register', paths: ['res://a.csv'] }))!);
    expect(r.success).toBe(false);
    expect(r.error_code).toBe('INVALID_FORMAT');
  });

  it('write rejects path traversal', async () => {
    const r = parse((await run({
      action: 'translation_write', path: 'res://../outside.csv',
      languages: ['en'], entries: { A: { en: 'a' } },
    }))!);
    expect(r.success).toBe(false);
    expect(r.error_code).toBe('INVALID_PARAMS');
  });

  it('write rejects non-csv extension', async () => {
    const r = parse((await run({
      action: 'translation_write', path: 'res://a.po',
      languages: ['en'], entries: { A: { en: 'a' } },
    }))!);
    expect(r.success).toBe(false);
    expect(r.error_code).toBe('INVALID_FORMAT');
  });

  it('write rejects invalid language code', async () => {
    const r = parse((await run({
      action: 'translation_write', path: 'res://a.csv',
      languages: ['en; rm -rf'], entries: { A: { 'en; rm -rf': 'a' } },
    }))!);
    expect(r.success).toBe(false);
  });

  it('write rejects entries referencing undeclared language', async () => {
    const r = parse((await run({
      action: 'translation_write', path: 'res://a.csv',
      languages: ['en'], entries: { A: { fr: 'a' } },
    }))!);
    expect(r.success).toBe(false);
    expect(r.error).toContain('fr');
  });

  it('read truncates large entry sets', async () => {
    const entries: Record<string, Record<string, string>> = {};
    for (let i = 0; i < 250; i++) entries[`K${i}`] = { en: `v${i}` };
    await run({ action: 'translation_write', path: 'res://big.csv', languages: ['en'], entries });
    const r = parse((await run({ action: 'translation_read', path: 'res://big.csv' }))!);
    expect(r.data.entry_count).toBe(250);
    expect(r.data.truncated).toBe(true);
    expect(Object.keys(r.data.entries).length).toBe(200);
  });

  it('returns null for other tool names', async () => {
    expect(await handleTool('uid', {}, makeCtx())).toBeNull();
  });
});
