---
date: 2026-08-10
project: godot-mcp-enhanced
type: Phase 2 设计文档(Vision Routing TS 侧方案)
status: review
depends_on: Phase 1(已完成,commit 4b26af4)
---

# Phase 2 设计:TS 侧 Vision Routing

> [!check] 架构决策(2026-08-10 确认)
> - **落地点**:TS 侧 `src/tools/screenshot.ts` 的 analyze action(不放 GD addon)
> - **触发方式**:显式参数 `vision_route=true`(不自动检测客户端视觉能力)
> - **原因**:godot-mcp-enhanced 截图架构是"TS 侧 headless 子进程生成 PNG + analyze 读文件返回 image content",无 GD addon 参与,无 deferred 需求

## 一、现状分析(实测)

### 1.1 现有截图链路

```
AI 调 screenshot(action=capture)
  → TS captureScreenshot() 启动 Godot headless 子进程
  → screenshot_capture.gd 生成 PNG 文件
  → 返回文件路径(不返回图片数据)

AI 调 screenshot(action=analyze, image_path=...)
  → TS 读 PNG 文件
  → 按 detail 分层返回 image content:
     - full:完整 base64(高 token)
     - thumbnail:缩略图 base64(中 token)
     - ascii:ASCII art 文本(低 token)
  → 客户端视觉模型(Claude/GPT-4)看图分析
```

### 1.2 痛点(Phase 2 要解决的)

**工具 description 明说**:`"analyze: return the image as MCP image content (base64) for the client vision capability to examine — returns image data, NOT a text description."`

**问题**:纯文本模型(DeepSeek/Qwen 等)拿到 image content 也"看不懂"——工具链对它们断裂。现有 detail=ascii 是降级方案,但 ASCII art 信息损失大。

### 1.3 与 godot-ai 的架构差异(决定方案形态)

| 维度 | godot-ai | godot-mcp-enhanced |
|------|---------|-------------------|
| 截图来源 | 活 editor 实时 viewport | headless 子进程生成 PNG 文件 |
| 截图位置 | GD addon 侧 | TS 侧 |
| Vision Routing 落点 | GD addon(worker 线程) | **TS 侧**(直接读文件) |
| deferred 机制 | 需要(GD worker 线程) | **不需要**(TS 原生 async/await) |
| 改动范围 | GD addon + TS server | **仅 TS 侧**(~250 行) |
| 加密 key | GD OS.get_unique_id() | **TS 侧环境变量优先** |

**结论**:godot-mcp-enhanced 的方案比 godot-ai 简单得多——TS 原生 async,不需要 worker 线程、不需要 deferred、不需要改 GD addon。

## 二、设计方案

### 2.1 数据流

```
AI 调 screenshot(action=analyze, image_path=..., vision_route=true, vision_question="...")
  → TS 读 PNG 文件(已有逻辑)
  → 检测 vision_route=true
     ├─ true:调视觉模型 API(groq)把图片翻译成文字描述
     │   → 成功:返回 TextContent(vision_description + routed_via),丢弃 image block
     │   → 失败:fallback 到现有 detail 分层(透传原图 + 追加 note)
     └─ false:走现有 detail 分层(full/thumbnail/ascii)
```

### 2.2 新增参数(screenshot analyze action)

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `vision_route` | boolean | false | 显式开启 Vision Routing(调视觉模型翻译图片→文字) |
| `vision_question` | string | (固定 prompt) | 传给视觉模型的问题/上下文(可选,默认用通用描述 prompt) |

**与现有 detail 参数的关系**:`vision_route=true` 时忽略 `detail`(因为不返回 image content)。`vision_route=false`(默认)时走现有逻辑,完全向后兼容。

### 2.3 provider 抽象(MVP 单 provider)

MVP 只支持 **groq**(OpenAI dialect),后续可扩展。配置通过环境变量:

| 环境变量 | 用途 | 必填 |
|---------|------|------|
| `GODOT_MCP_VISION_KEY` | groq API key | 是(vision_route=true 时) |
| `GODOT_MCP_VISION_MODEL` | 模型 id(默认 `meta-llama/llama-4-scout-17b-16e-instruct`) | 否 |
| `GODOT_MCP_VISION_TIMEOUT_MS` | 超时(默认 30000) | 否 |

**为什么用环境变量而非加密存储**:
- godot-mcp-enhanced 是 TS server 进程,环境变量是标准做法(对标 unity-mcp-server 的 `UNITY_MCP_*` 环境变量)
- godot-ai 用加密存储是因为它在 Godot editor 进程内(EditorSettings 文件),TS server 用环境变量更自然
- CI/容器场景友好(对标 godot-ai 的 "环境变量优先级高于存储 key")

### 2.4 视觉模型 API 调用(groq OpenAI dialect)

```
POST https://api.groq.com/openai/v1/chat/completions
Authorization: Bearer ${GODOT_MCP_VISION_KEY}
Content-Type: application/json

{
  "model": "${GODOT_MCP_VISION_MODEL}",
  "messages": [{
    "role": "user",
    "content": [
      {"type": "text", "text": "${PROMPT}"},
      {"type": "image_url", "image_url": {"url": "data:image/png;base64,${BASE64}"}}
    ]
  }],
  "max_tokens": 300,
  "temperature": 0.2
}
```

响应解析:`response.choices[0].message.content`(strip `<think>...</think>` 块)。

### 2.5 prompt 模板(从 godot-ai 改编,通用化)

godot-ai 的 prompt 偏 "Godot editor viewport",godot-mcp-enhanced 的截图可能是任意场景(游戏运行时、编辑器、headless)。改为通用:

```
You are the vision module of a text-only AI agent working on a Godot game project.
Describe this screenshot so the agent can act without seeing it. Report:
- What is shown: game scene, editor viewport, UI panel, dialog, console output, or other.
- Objects: characters, nodes, sprites, 3D models — position, color, size, labels (quote text exactly).
- UI text: menus, buttons, error messages, warnings, HUD values, debug overlays.
- State: play/stop status, selected items, highlighted elements, panels open.
- Problems: errors, red highlights, missing textures, black screens, glitches, visual bugs.
Be concise (under 200 words), factual, use exact quotes. Do not give advice.
```

`vision_question` 非空时追加:`Context from the agent: ${vision_question}`

### 2.6 错误处理(对标 godot-ai 的 fallback 设计)

| 失败类型 | 处理 |
|---------|------|
| `GODOT_MCP_VISION_KEY` 未设 | fallback 到现有 detail 分层 + 追加 note: "Vision routing unavailable: no API key (set GODOT_MCP_VISION_KEY)" |
| 网络超时(默认 30s) | fallback + note: "Vision routing timeout" |
| API 返回错误(401/限流/模型退役) | fallback + note: "Vision routing failed: ${error}" |
| 响应解析失败(非预期格式) | fallback + note: "Vision routing parse error" |

**fallback 语义**:返回现有 detail 分层的结果(full/thumbnail/ascii)+ 在 text content 追加 note。工具链不破,客户端仍能拿到原图(若有视觉能力)。

### 2.7 图片预处理

复用现有 `downsampleToThumbnail`(已实现):Vision Routing 前把图片缩放到最长边 1024px(对标 godot-ai `_downscale_image_if_needed`),减少 API 调用成本。JPEG 用原尺寸(groq 支持)。

## 三、实施计划(分步骤,每步可验证)

### 步骤 1:新建 `src/core/vision-router.ts`(~150 行)

纯函数模块,便于单测。不依赖 MCP 类型,只做"图片 base64 + prompt → 视觉模型 → 文字描述"。

```typescript
// 核心接口
export interface VisionRouteOptions {
  apiKey: string;           // groq API key
  model?: string;           // 默认 meta-llama/llama-4-scout-17b-16e-instruct
  question?: string;        // 可选上下文
  timeoutMs?: number;       // 默认 30000
}

export interface VisionRouteResult {
  success: boolean;
  description?: string;     // 视觉模型返回的文字描述
  routedVia?: string;       // "groq:model" 标识
  error?: string;           // 失败原因(用于 note)
}

export async function routeImage(
  imageBase64: string,
  mimeType: 'image/png' | 'image/jpeg',
  options: VisionRouteOptions,
): Promise<VisionRouteResult>;
```

### 步骤 2:单测 `test/core/vision-router.test.ts`(~100 行)

- mock fetch(用 vitest 的 vi.fn),验证请求格式、响应解析、超时、错误处理
- 不真实调 groq API(用 mock)

### 步骤 3:集成到 `src/tools/screenshot.ts`(~50 行改动)

在 analyze action 的早期分支加 `vision_route` 检测:
```typescript
case 'analyze': {
  // ... 现有的 image_path 解析 ...
  
  // Phase 2: Vision Routing(显式开启时调视觉模型)
  if (args.vision_route === true) {
    const key = process.env.GODOT_MCP_VISION_KEY;
    if (!key) {
      // 无 key → fallback 到现有 detail 分层 + note
      return fallbackWithNote(result, 'Vision routing unavailable: set GODOT_MCP_VISION_KEY');
    }
    const vr = await routeImage(base64, mimeType, { apiKey: key, question: args.vision_question });
    if (vr.success) {
      // 成功:只返回 TextContent(描述 + routed_via),丢弃 image block(省 token)
      return textResult(JSON.stringify({
        action: 'screenshot_analyze_vision',
        vision_description: vr.description,
        routed_via: vr.routedVia,
        image_path: imagePath,
      }));
    }
    // 失败:fallback 到现有 detail 分层 + note
    return fallbackWithNote(existingDetailResult, `Vision routing failed: ${vr.error}`);
  }
  
  // ... 现有 detail 分层逻辑(full/thumbnail/ascii)...
}
```

### 步骤 4:schema 更新

analyze action 的 inputSchema 加 `vision_route` + `vision_question` 参数。

### 步骤 5:在线验证(需 groq API key)

`E2E_VISION=1 npx vitest run test/e2e-vision-routing.test.ts`——真实调 groq API 验证端到端。

## 四、风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| groq API key 获取 | 中 | 中 | 用户需自申请;有免费档;env var 配置 |
| 模型 id 退役 | 低 | 低 | 默认值会过期,但用户可 `GODOT_MCP_VISION_MODEL` 覆盖;失败时 fallback 透传 |
| 网络访问(中国大陆) | 中 | 高 | groq 在境外;用户需自配代理或用兼容 OpenAI dialect 的国内中转 |
| groq 免费档限流 | 中 | 低 | fallback 透传原图;限流时 note 提示 |
| 现有 analyze 测试破坏 | 低 | 低 | vision_route 默认 false,现有逻辑完全不变 |

## 五、验证方式

| 验证项 | 方式 | 通过标准 |
|--------|------|---------|
| 单测 | `npx vitest run test/core/vision-router.test.ts` | mock fetch 全通过 |
| 集成(离线) | vision_route=true 但无 key | fallback 到 detail 分层 + note |
| 集成(在线) | `E2E_VISION=1` + 真实 groq key | 返回文字描述,不含 image block |
| 全量回归 | `npm test` | 4988+ passed,0 failed |
| build | `npm run build` | tsc 无错 |

## 六、工作量估算

| 步骤 | 行数 | 时间 |
|------|------|------|
| vision-router.ts | ~150 | 0.5 天 |
| 单测 | ~100 | 0.5 天 |
| screenshot.ts 集成 | ~50 改动 | 0.5 天 |
| schema + 文档 | - | 0.25 天 |
| 在线验证 | - | 0.25 天 |
| **总计** | **~300** | **2 天**(比原方案 2 周 +1 周 deferred 大幅缩短) |

## 七、与 godot-ai 方案的对比

| 维度 | godot-ai | 本方案(godot-mcp-enhanced) |
|------|---------|---------------------------|
| 落点 | GD addon(worker 线程) | TS 侧(async/await) |
| 行数 | 1043 行 | ~300 行 |
| deferred 机制 | 需要(复杂) | 不需要 |
| 加密存储 | AES-256-CBC + HMAC(机器派生 key) | 环境变量(标准做法) |
| 多 provider | 3 个(groq/google/grok) | MVP 1 个(groq),可扩展 |
| 测试 | GDScript 单测 + Python 端 | vitest mock fetch |
| 集成复杂度 | 高(改 GD addon + TS server + WS 协议) | 低(仅改 TS screenshot.ts) |

**本方案的核心优势**:利用 godot-mcp-enhanced 已有的"TS 侧读文件返回 image content"链路,在最简单的位置(TS analyze action)插入视觉模型调用,**无需触碰 GD addon / WS 协议 / deferred 机制**。
