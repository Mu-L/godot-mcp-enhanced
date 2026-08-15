// test/tools/screenshot-vision-route.test.ts
// Phase 2: screenshot analyze 的 vision_route 参数集成测试。
// 不真实调 groq API(vision-router 已有 mock 单测),这里只测集成行为:
//   1. vision_route=false(默认):走现有 detail 分层,行为不变
//   2. vision_route=true 无 key:fallback 到 detail 分层 + note
//   3. vision_route=true 有 key 但 mock 失败:fallback + note
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { resolve } from 'path';
import { handleTool, getToolDefinitions } from '../../src/tools/screenshot.js';
import type { ToolContext, ToolResult } from '../../src/types.js';

// ─── fixture ────────────────────────────────────────────────────────────────

const TMP_DIR = resolve(process.cwd(), 'test/fixtures/vision-route-tmp');
const PNG_PATH = resolve(TMP_DIR, 'test.png');

// 2x2 合法 PNG(pngjs 生成的真实文件,避免解码错误)
const MINIMAL_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4AWNMSUn5zwAETAxQAAAg6AIviveEewAAAABJRU5ErkJggg==';

const mockCtx = {
  projectDir: TMP_DIR,
  runningProcess: null,
  outputBuffer: '',
  processStartTime: 0,
  findGodot: async () => '/fake/godot',
} as unknown as ToolContext;

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(PNG_PATH, Buffer.from(MINIMAL_PNG_BASE64, 'base64'));
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ─── schema 验证 ────────────────────────────────────────────────────────────

describe('screenshot schema: vision_route 参数', () => {
  it('analyze inputSchema 含 vision_route 和 vision_question', () => {
    const defs = getToolDefinitions();
    const screenshot = defs[0]!;
    const props = (screenshot.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(props.vision_route).toBeDefined();
    expect(props.vision_question).toBeDefined();
    expect((props.vision_route as { type: string }).type).toBe('boolean');
  });
});

// ─── vision_route=false(默认):行为不变 ─────────────────────────────────────

describe('screenshot analyze: vision_route=false(默认)走 detail 分层', () => {
  it('vision_route 未传 → 走 detail=full,返回 image content', async () => {
    const result = await handleTool('screenshot', {
      action: 'analyze',
      image_path: PNG_PATH,
      project_path: TMP_DIR,
    }, mockCtx) as ToolResult;

    expect(result.content).toBeDefined();
    // detail=full 默认,应有 image content block
    const hasImage = result.content.some(c => c.type === 'image');
    expect(hasImage).toBe(true);
    // 不应有 vision fallback note
    const textBlock = result.content.find(c => c.type === 'text');
    expect((textBlock as { text?: string })?.text ?? '').not.toContain('Vision routing');
  });

  it('vision_route=false 显式 → 走 detail=ascii', async () => {
    const result = await handleTool('screenshot', {
      action: 'analyze',
      image_path: PNG_PATH,
      project_path: TMP_DIR,
      vision_route: false,
      detail: 'ascii',
    }, mockCtx) as ToolResult;

    const textBlock = result.content.find(c => c.type === 'text');
    expect((textBlock as { text?: string })?.text ?? '').toContain('ASCII art');
    expect(result.content.some(c => c.type === 'image')).toBe(false);
  });
});

// ─── vision_route=true 无 key:fallback ──────────────────────────────────────

describe('screenshot analyze: vision_route=true 无 key → fallback + note', () => {
  beforeEach(() => {
    delete process.env.GODOT_MCP_VISION_KEY;
  });

  it('无 GODOT_MCP_VISION_KEY → fallback 到 detail 分层 + warning note', async () => {
    const result = await handleTool('screenshot', {
      action: 'analyze',
      image_path: PNG_PATH,
      project_path: TMP_DIR,
      vision_route: true,
    }, mockCtx) as ToolResult;

    // fallback 到 detail=full(默认),返回 image content
    expect(result.content.some(c => c.type === 'image')).toBe(true);
    // text content 含 fallback note
    const textBlock = result.content.find(c => c.type === 'text');
    const text = (textBlock as { text?: string })?.text ?? '';
    expect(text).toContain('Vision routing unavailable');
    expect(text).toContain('GODOT_MCP_VISION_KEY');
  });

  it('无 key + detail=ascii → fallback 到 ascii + note', async () => {
    const result = await handleTool('screenshot', {
      action: 'analyze',
      image_path: PNG_PATH,
      project_path: TMP_DIR,
      vision_route: true,
      detail: 'ascii',
    }, mockCtx) as ToolResult;

    // ascii 分支有 2 个 text block:ASCII art + question(含 note)
    const textBlocks = result.content.filter(c => c.type === 'text');
    const allText = textBlocks.map(b => (b as { text: string }).text).join('\n');
    expect(allText).toContain('ASCII art');
    expect(allText).toContain('Vision routing unavailable');
  });
});

// ─── vision_route=true 有 key 但 API 失败:fallback ──────────────────────────

describe('screenshot analyze: vision_route=true 有 key 但 API 失败 → fallback + note', () => {
  beforeEach(() => {
    process.env.GODOT_MCP_VISION_KEY = 'fake-key-for-test';
    // mock fetch 失败
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
  });

  afterEach(() => {
    delete process.env.GODOT_MCP_VISION_KEY;
    vi.unstubAllGlobals();
  });

  it('API 网络失败 → fallback 到 detail=full + 失败 note', async () => {
    const result = await handleTool('screenshot', {
      action: 'analyze',
      image_path: PNG_PATH,
      project_path: TMP_DIR,
      vision_route: true,
    }, mockCtx) as ToolResult;

    // fallback,有 image content
    expect(result.content.some(c => c.type === 'image')).toBe(true);
    const textBlock = result.content.find(c => c.type === 'text');
    const text = (textBlock as { text?: string })?.text ?? '';
    expect(text).toContain('Vision routing failed');
    expect(text).toContain('ECONNREFUSED');
  });
});

// ─── vision_route=true 成功:返回纯文本(用 mock fetch) ─────────────────────

describe('screenshot analyze: vision_route=true 成功 → 纯文本描述', () => {
  beforeEach(() => {
    process.env.GODOT_MCP_VISION_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'A screenshot showing a 3D scene with a player character.' } }],
      }),
      text: async () => '',
    }));
  });

  afterEach(() => {
    delete process.env.GODOT_MCP_VISION_KEY;
    vi.unstubAllGlobals();
  });

  it('成功 → 返回 vision_description,不含 image block(省 token)', async () => {
    const result = await handleTool('screenshot', {
      action: 'analyze',
      image_path: PNG_PATH,
      project_path: TMP_DIR,
      vision_route: true,
      vision_question: 'checking player position',
    }, mockCtx) as ToolResult;

    // 成功:不含 image block(省 token)
    expect(result.content.some(c => c.type === 'image')).toBe(false);
    // 只有 text content,含 vision_description
    const textBlock = result.content.find(c => c.type === 'text');
    const text = (textBlock as { text?: string })?.text ?? '';
    const parsed = JSON.parse(text);
    expect(parsed.action).toBe('screenshot_analyze_vision');
    expect(parsed.vision_description).toBe('A screenshot showing a 3D scene with a player character.');
    expect(parsed.routed_via).toMatch(/^groq:/);
    // structuredContent 也有
    expect(result.structuredContent).toBeDefined();
    expect((result.structuredContent as { action: string }).action).toBe('screenshot_analyze_vision');
  });
});

// ─── F-4: JPEG 超限 fallback(不直发超大 base64 到 vision API)──────────────

describe('F-4: JPEG 超过降采样阈值时 fallback 到 detail 分层', () => {
  const JPG_LARGE_PATH = resolve(TMP_DIR, 'large.jpg');

  beforeEach(() => {
    // 2MB 假 JPEG(不需有效 JPEG 头,size 检查在解码前)
    writeFileSync(JPG_LARGE_PATH, Buffer.alloc(2 * 1024 * 1024, 0xff));
    process.env.GODOT_MCP_VISION_KEY = 'fake-key';
  });
  afterEach(() => { delete process.env.GODOT_MCP_VISION_KEY; });

  it('大 JPEG(>1MB)→ 不调用 routeImage,fallback note 含 "downsampling threshold"', async () => {
    const result = await handleTool('screenshot', {
      action: 'analyze',
      image_path: JPG_LARGE_PATH,
      project_path: TMP_DIR,
      vision_route: true,
      detail: 'full',
    }, mockCtx) as ToolResult;

    // 应回落到 detail=full(含 image content),而非走 vision route(不含)
    const textBlock = result.content.find(c => c.type === 'text');
    const text = (textBlock as { text?: string })?.text ?? '';
    expect(text).toContain('downsampling threshold');
    // 不应调到 vision API(无 vision_description)
    expect(text).not.toContain('vision_description');
  });
});
