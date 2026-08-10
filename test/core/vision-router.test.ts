// test/core/vision-router.test.ts
// Phase 2: vision-router 单测。mock fetch,不真实调 groq API。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  routeImage,
  buildPrompt,
  parseDescription,
  stripThinkBlocks,
  type VisionRouteOptions,
} from '../../src/core/vision-router.js';

// ─── fetch mock ──────────────────────────────────────────────────────────────

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── buildPrompt ─────────────────────────────────────────────────────────────

describe('buildPrompt', () => {
  it('returns base prompt without question', () => {
    const p = buildPrompt();
    expect(p).toContain('vision module');
    expect(p).toContain('under 200 words');
    expect(p).not.toContain('Context from the agent');
  });

  it('appends question when provided', () => {
    const p = buildPrompt('debugging player animation');
    expect(p).toContain('Context from the agent: debugging player animation');
  });

  it('omits question when empty/whitespace', () => {
    expect(buildPrompt('')).not.toContain('Context from the agent');
    expect(buildPrompt('   ')).not.toContain('Context from the agent');
  });

  it('includes key reporting categories', () => {
    const p = buildPrompt();
    expect(p).toMatch(/What is shown/);
    expect(p).toMatch(/Objects/);
    expect(p).toMatch(/UI text/);
    expect(p).toMatch(/Problems/);
  });
});

// ─── stripThinkBlocks ───────────────────────────────────────────────────────

describe('stripThinkBlocks', () => {
  it('strips <think>...</think> blocks', () => {
    expect(stripThinkBlocks('<think>reasoning here</think>final answer')).toBe('final answer');
  });

  it('strips multi-line think blocks', () => {
    const input = '<think>\nline 1\nline 2\n</think>\nactual output';
    expect(stripThinkBlocks(input)).toBe('actual output');
  });

  it('handles case-insensitive tags', () => {
    expect(stripThinkBlocks('<THINK>x</THINK>result')).toBe('result');
  });

  it('passes through text without think blocks', () => {
    expect(stripThinkBlocks('plain description')).toBe('plain description');
  });

  it('handles multiple think blocks', () => {
    expect(stripThinkBlocks('<think>a</think>mid<think>b</think>end')).toBe('midend');
  });
});

// ─── parseDescription ───────────────────────────────────────────────────────

describe('parseDescription', () => {
  it('parses standard OpenAI/groq response', () => {
    const resp = {
      choices: [{ message: { content: 'A screenshot showing the Godot editor.' } }],
    };
    expect(parseDescription(resp)).toBe('A screenshot showing the Godot editor.');
  });

  it('strips think blocks from content', () => {
    const resp = {
      choices: [{ message: { content: '<think>analysis</think>clean output' } }],
    };
    expect(parseDescription(resp)).toBe('clean output');
  });

  it('returns null for missing choices', () => {
    expect(parseDescription({})).toBeNull();
    expect(parseDescription({ choices: [] })).toBeNull();
  });

  it('returns null for non-string content', () => {
    expect(parseDescription({ choices: [{ message: { content: 42 } }] })).toBeNull();
    expect(parseDescription({ choices: [{ message: { content: '' } }] })).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(parseDescription(null)).toBeNull();
    expect(parseDescription('string')).toBeNull();
    expect(parseDescription(42)).toBeNull();
  });
});

// ─── routeImage ─────────────────────────────────────────────────────────────

const defaultOpts: VisionRouteOptions = {
  apiKey: 'test-key-12345',
};

const okResponse = (content: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content } }] }),
  text: async () => '',
});

const errResponse = (status: number, text: string) => ({
  ok: false,
  status,
  json: async () => ({}),
  text: async () => text,
});

describe('routeImage', () => {
  it('returns description on successful API call', async () => {
    fetchMock.mockResolvedValue(okResponse('Screenshot shows a 3D scene with a player character.'));
    const result = await routeImage('base64data', 'image/png', defaultOpts);

    expect(result.success).toBe(true);
    expect(result.description).toBe('Screenshot shows a 3D scene with a player character.');
    expect(result.routedVia).toMatch(/^groq:/);
  });

  it('sends correct request format (OpenAI dialect)', async () => {
    fetchMock.mockResolvedValue(okResponse('desc'));
    await routeImage('imgdata', 'image/png', {
      ...defaultOpts,
      question: 'checking UI layout',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-key-12345');
    expect(headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].content[0].type).toBe('text');
    expect(body.messages[0].content[0].text).toContain('checking UI layout');
    expect(body.messages[0].content[1].type).toBe('image_url');
    expect(body.messages[0].content[1].image_url.url).toBe('data:image/png;base64,imgdata');
    expect(body.max_tokens).toBe(300);
    expect(body.temperature).toBe(0.2);
  });

  it('uses jpeg mimeType correctly', async () => {
    fetchMock.mockResolvedValue(okResponse('desc'));
    await routeImage('jpegdata', 'image/jpeg', defaultOpts);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.messages[0].content[1].image_url.url).toBe('data:image/jpeg;base64,jpegdata');
  });

  it('returns error when apiKey is empty', async () => {
    const result = await routeImage('data', 'image/png', { apiKey: '' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('No API key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns error on HTTP 401 (bad key)', async () => {
    fetchMock.mockResolvedValue(errResponse(401, 'Unauthorized'));
    const result = await routeImage('data', 'image/png', defaultOpts);
    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 401');
  });

  it('returns error on HTTP 429 (rate limit)', async () => {
    fetchMock.mockResolvedValue(errResponse(429, 'Too Many Requests'));
    const result = await routeImage('data', 'image/png', defaultOpts);
    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 429');
  });

  it('returns error on HTTP 404 (model retired)', async () => {
    fetchMock.mockResolvedValue(errResponse(404, 'Model not found'));
    const result = await routeImage('data', 'image/png', {
      ...defaultOpts,
      model: 'retired-model-id',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 404');
  });

  it('returns error on empty description', async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: '' } }] }),
      text: async () => '',
    });
    const result = await routeImage('data', 'image/png', defaultOpts);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Empty or unparseable');
  });

  it('returns error on network failure', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await routeImage('data', 'image/png', defaultOpts);
    expect(result.success).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('returns timeout error on abort', async () => {
    // 模拟 abort:fetch 抛 AbortError
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    fetchMock.mockRejectedValue(abortErr);

    const result = await routeImage('data', 'image/png', {
      ...defaultOpts,
      timeoutMs: 50,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Timeout');
  });

  it('respects custom baseUrl (OpenAI-compatible proxy)', async () => {
    fetchMock.mockResolvedValue(okResponse('desc'));
    await routeImage('data', 'image/png', {
      ...defaultOpts,
      baseUrl: 'https://my-proxy.com/v1/chat/completions',
    });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://my-proxy.com/v1/chat/completions');
  });

  it('respects custom model', async () => {
    fetchMock.mockResolvedValue(okResponse('desc'));
    const result = await routeImage('data', 'image/png', {
      ...defaultOpts,
      model: 'custom-vision-model',
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.model).toBe('custom-vision-model');
    expect(result.routedVia).toBe('groq:custom-vision-model');
  });

  it('uses default model when not specified', async () => {
    fetchMock.mockResolvedValue(okResponse('desc'));
    const result = await routeImage('data', 'image/png', defaultOpts);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.model).toBe('meta-llama/llama-4-scout-17b-16e-instruct');
    expect(result.routedVia).toContain('meta-llama/llama-4-scout-17b-16e-instruct');
  });
});
