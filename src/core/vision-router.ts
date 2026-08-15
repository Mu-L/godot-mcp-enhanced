// src/core/vision-router.ts
/**
 * Vision Router — 把图片路由到视觉模型(groq),翻译成文字描述(Phase 2)。
 *
 * 对标 godot-ai/plugin/addons/godot_ai/vision_routing.gd(2026-08-10 深挖报告),
 * 但因 godot-mcp-enhanced 截图架构不同(TS 侧读文件,非 GD addon 实时截图),
 * 本模块是纯 TS 实现,不需要 worker 线程 / deferred 机制 / 加密存储。
 *
 * 核心流程:
 *   图片 base64 + prompt → groq API(OpenAI dialect)→ 文字描述
 *
 * 错误处理(对标 godot-ai fallback 设计):
 *   任何失败都返回 {success: false, error},调用方(screenshot.ts)负责
 *   fallback 到现有 detail 分层 + 追加 note,工具链不破。
 *
 * @module vision-router
 */

/**
 * Vision Routing 请求选项。
 *
 * API key 通过环境变量 GODOT_MCP_VISION_KEY 传入(对标 unity-mcp-server 的
 * UNITY_MCP_* 环境变量模式;godot-ai 用加密存储是因为它在 Godot editor 进程内,
 * TS server 用环境变量更自然,且 CI/容器场景友好)。
 */
export interface VisionRouteOptions {
  /** groq API key(必填)。 */
  apiKey: string;
  /** 模型 id。默认 `meta-llama/llama-4-scout-17b-16e-instruct`(groq 视觉模型,有免费档)。 */
  model?: string;
  /** 可选上下文(追加到 prompt,让视觉模型知道 agent 在做什么)。 */
  question?: string;
  /** 超时毫秒。默认 30000(groq 视觉模型首 token 约 2-5s + 描述生成 5-10s,30s 余量充足)。 */
  timeoutMs?: number;
  /** 可选:覆盖 API endpoint(用于兼容 OpenAI dialect 的国内中转/本地 ollama)。 */
  baseUrl?: string;
}

/** Vision Routing 返回结果。 */
export interface VisionRouteResult {
  /** 成功=true(有 description);失败=false(有 error,调用方 fallback)。 */
  success: boolean;
  /** 视觉模型返回的文字描述(success=true 时)。 */
  description?: string;
  /** 路由标识,如 "groq:meta-llama/llama-4-scout-17b-16e-instruct"(success=true 时)。 */
  routedVia?: string;
  /** 失败原因(success=false 时,用于 fallback note)。 */
  error?: string;
}

/** groq API 默认 endpoint(OpenAI dialect 兼容)。 */
const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1/chat/completions';

/** 默认模型(groq 视觉模型,有免费档,速度快)。 */
const DEFAULT_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

/** 默认超时(30s,groq 视觉模型典型响应 7-15s)。 */
const DEFAULT_TIMEOUT_MS = 30_000;

/** 视觉模型返回 token 上限(对标 godot-ai MAX_OUTPUT_TOKENS=300,200 词描述足够)。 */
const MAX_OUTPUT_TOKENS = 300;

/**
 * 构建 prompt(对标 godot-ai vision_routing.gd:313-327,通用化处理)。
 *
 * godot-ai 的 prompt 偏 "Godot editor viewport",godot-mcp-enhanced 的截图
 * 可能是任意场景(游戏运行时/editor/headless),改为通用描述。
 *
 * @param question 可选上下文(agent 传入,如"我在调试 Player 走路动画")
 */
export function buildPrompt(question?: string): string {
  const lines = [
    'You are the vision module of a text-only AI agent working on a Godot game project.',
    'Describe this screenshot so the agent can act without seeing it. Report:',
    '- What is shown: game scene, editor viewport, UI panel, dialog, console output, or other.',
    '- Objects: characters, nodes, sprites, 3D models — position, color, size, labels (quote text exactly).',
    '- UI text: menus, buttons, error messages, warnings, HUD values, debug overlays.',
    '- State: play/stop status, selected items, highlighted elements, panels open.',
    '- Problems: errors, red highlights, missing textures, black screens, glitches, visual bugs.',
    'Be concise (under 200 words), factual, use exact quotes. Do not give advice.',
  ];
  if (question && question.trim().length > 0) {
    lines.push(`Context from the agent: ${question.trim()}`);
  }
  return lines.join('\n');
}

/**
 * 从视觉模型响应解析描述(对标 godot-ai _parse_openai + _strip_think)。
 *
 * groq(OpenAI dialect)响应格式:
 *   { choices: [{ message: { content: "..." } }] }
 *
 * 推理模型可能把输出包在 `<think>...</think>` 块里,需 strip。
 */
export function parseDescription(responseJson: unknown): string | null {
  if (!responseJson || typeof responseJson !== 'object') return null;
  const root = responseJson as { choices?: unknown };
  const choices = root.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  const content = first?.message?.content;
  if (typeof content !== 'string' || content.length === 0) return null;
  return stripThinkBlocks(content).trim();
}

/**
 * 剥离 `<think>...</think>` 块(对标 godot-ai _strip_think)。
 * 推理模型(如 llama-4-scout)有时把 Chain-of-Thought 包在此块里。
 */
export function stripThinkBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/**
 * 把图片路由到视觉模型,返回文字描述。
 *
 * 调用方(screenshot.ts analyze action)负责:
 *   1. 检测 vision_route=true
 *   2. 提供 apiKey(从 GODOT_MCP_VISION_KEY)
 *   3. 失败时 fallback 到现有 detail 分层 + 追加 note
 *
 * @param imageBase64 图片 base64(不含 data: 前缀)
 * @param mimeType 图片 MIME 类型('image/png' 或 'image/jpeg')
 * @param options 路由选项
 * @returns VisionRouteResult(success 时有 description + routedVia;失败时有 error)
 */
export async function routeImage(
  imageBase64: string,
  mimeType: 'image/png' | 'image/jpeg',
  options: VisionRouteOptions,
): Promise<VisionRouteResult> {
  const model = options.model || DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseUrl = options.baseUrl || DEFAULT_BASE_URL;

  if (!options.apiKey) {
    return { success: false, error: 'No API key (set GODOT_MCP_VISION_KEY)' };
  }

  const prompt = buildPrompt(options.question);
  const body = JSON.stringify({
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
        ],
      },
    ],
    max_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0.2,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      // 常见错误:401(key 错)、429(限流)、404(模型 id 退役)
      const errText = await response.text().catch(() => '');
      return {
        success: false,
        error: `HTTP ${response.status}${errText ? `: ${errText.slice(0, 200)}` : ''}`,
      };
    }

    const json: unknown = await response.json();
    const description = parseDescription(json);
    if (!description) {
      return { success: false, error: 'Empty or unparseable description from vision model' };
    }

    return {
      success: true,
      description,
      routedVia: `groq:${model}`,
    };
  } catch (err) {
    // 区分超时(abort)和其他网络错误
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      success: false,
      error: isAbort ? `Timeout after ${timeoutMs}ms` : (err instanceof Error ? err.message : String(err)),
    };
  } finally {
    clearTimeout(timer);
  }
}
