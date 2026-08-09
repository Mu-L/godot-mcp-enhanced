import { isAbsolute, resolve, join, extname } from 'path';
import { existsSync, readFileSync, statSync } from 'fs';
import type { Tool } from "@modelcontextprotocol/server";
import type { ToolContext, ToolResult } from '../types.js';
import type { RiskLevel } from '../core/tool-registry.js';
import { textResult } from '../types.js';
import { opsErrorResult } from './shared.js';
import { captureScreenshot } from '../screenshot.js';
import { parseDetailLevel, downsampleToThumbnail, downsampleToAscii } from './screenshot-detail.js';
import { validatePath, requireProjectPath, resolveWithinRoot, normalizeUserProjectPath, allowOutsideProjectPaths, isPathInAllowedRoots } from '../helpers.js';

const TOOL_NAMES = ['screenshot'] as const;

export { TOOL_NAMES };

// ─── Tool definitions ──────────────────────────────────────────────────────

export function getToolDefinitions(): Tool[] {
  return [
    {
      name: 'screenshot',
      description: 'Screenshot capture and image analysis handoff. capture: capture a Godot scene screenshot in headless mode (experimental). analyze: return the image as MCP image content (base64) for the client vision capability to examine — returns image data, NOT a text description.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          project_path: { type: 'string', description: 'Path to Godot project directory' },
          action: {
            type: 'string',
            enum: ['capture', 'analyze'],
            description: 'Action type: capture (take a screenshot) or analyze (AI visual analysis of an image)',
          },
          // capture params
          scene: { type: 'string', description: 'capture: Scene file path relative to project (res://scenes/main.tscn). If omitted, captures the default scene or an empty viewport.' },
          output_path: { type: 'string', description: 'capture: Output PNG path (absolute). Defaults to <project_path>/screenshot.png' },
          frame_delay: { type: 'number', description: 'capture: Frames to wait before capture (default: 15)', default: 15 },
          viewport_width: { type: 'number', description: 'capture: Viewport width in pixels (default: 1280)', default: 1280 },
          viewport_height: { type: 'number', description: 'capture: Viewport height in pixels (default: 720)', default: 720 },
          wait_node: { type: 'string', description: 'capture: 等待该节点(名或 /root/... 路径)出现在场景树再截图。对分帧构建/异步初始化场景,优先于 frame_delay 生效;超时(固定 300 帧≈5s@60fps,独立于 max_frames)后放弃等待直接截图' },
          wait_text: { type: 'string', description: 'capture: 等待任一 Label/RichTextLabel 的 text 包含该子串再截图;超时同 wait_node(固定 300 帧≈5s@60fps,独立于 max_frames)' },
          // analyze params
          image_path: { type: 'string', description: 'analyze: Absolute path to the image file (PNG or JPG)' },
          question: { type: 'string', description: 'analyze: Question for the AI to answer about the image. Default: "Describe what you see in this game screenshot."', default: 'Describe what you see in this game screenshot. Focus on: UI elements, character positions, any visual issues or bugs.' },
          // P1-5 视觉成本层级:full(完整 base64)/ thumbnail(缩略图)/ ascii(ASCII art 文本)
          detail: {
            type: 'string',
            enum: ['full', 'thumbnail', 'ascii'],
            description: 'P1-5 视觉成本层级:full(完整 base64 图像,高 token) / thumbnail(缩放至 thumbnail_width 的 PNG,中 token) / ascii(ASCII art 文本,低 token)。默认 full。',
            default: 'full',
          },
          thumbnail_width: { type: 'number', description: 'detail=thumbnail: 目标宽度像素(默认 256,保持纵横比)', default: 256 },
          ascii_cols: { type: 'number', description: 'detail=ascii: 字符列数(默认 80)', default: 80 },
          ascii_rows: { type: 'number', description: 'detail=ascii: 字符行数(默认 40)', default: 40 },
          godot_path: { type: 'string', description: '覆盖 Godot 二进制路径（可选，优先于项目配置和环境变量）' },
        },
        required: ['action'],
      },
    },
  ];
}

// ─── Tool handler ───────────────────────────────────────────────────────────

export async function handleTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult | null> {
  if (name !== 'screenshot') return null;

  const action = args.action as string;
  if (!action) return opsErrorResult('INVALID_PARAMS', '"action" is required (capture or analyze).');

  switch (action) {
    case 'capture': {
      const projectPath = requireProjectPath(args);
      const scene = args.scene as string | undefined;
      const outputPathRaw = args.output_path as string | undefined;
      const normalizedOutput = normalizeUserProjectPath(outputPathRaw ?? '');
      const outputPath = outputPathRaw?.trim()
        ? (allowOutsideProjectPaths()
            ? (() => {
                const p = validatePath(outputPathRaw);
                if (!isPathInAllowedRoots(p)) {
                  throw new Error(`Output path is outside allowed project roots: ${p}`);
                }
                return p;
              })()
            : resolveWithinRoot(projectPath, normalizedOutput))
        : join(projectPath, 'screenshot.png');
      const frameDelay = (args.frame_delay as number) || 15;
      const viewportW = (args.viewport_width as number) || 1280;
      const viewportH = (args.viewport_height as number) || 720;
      const waitNode = (args.wait_node as string | undefined)?.trim() || undefined;
      const waitText = (args.wait_text as string | undefined)?.trim() || undefined;
      const godot = await ctx.findGodot();

      const result = await captureScreenshot({
        godotPath: godot,
        projectPath,
        scene,
        outputPath,
        frameDelay,
        viewportSize: { width: viewportW, height: viewportH },
        timeout: 30,
        waitNode,
        waitText,
      });

      if (result.success) {
        // 双层空白检测：GDScript BLANK_DETECTED + TS 侧 fileSize 阈值
        let blankWarning = '';

        if (result.godotOutput?.includes('BLANK_DETECTED')) {
          blankWarning = '\n⚠ Screenshot may be blank (headless RendererDummy 无 GPU 渲染，2D/3D 均空白).\n' +
            '替代：① Bridge take_screenshot（游戏运行时 GPU viewport，2D/3D 均可）② editor/GUI 模式截图 ③ 手动 F5 运行后截图 ④ screenshot(action=analyze) 分析本地文件';
        } else if ((result.fileSize ?? 0) < 2048) {
          // 小文件（< 2KB）疑似空白，补充警告
          blankWarning = `\n⚠ Screenshot file is unusually small (${result.fileSize} bytes), possibly blank (headless RendererDummy 无 GPU 渲染，2D/3D 均空白).\n` +
            '替代：① Bridge take_screenshot（游戏运行时 GPU viewport，2D/3D 均可）② editor/GUI 模式截图 ③ 手动 F5 运行后截图 ④ screenshot(action=analyze) 分析本地文件';
        }

        return {
          ...textResult(
            `Screenshot saved to: ${result.imagePath}\n` +
            `File size: ${result.fileSize} bytes\n` +
            `Viewport: ${viewportW}x${viewportH}\n` +
            `Frames waited: ${frameDelay}` +
            blankWarning +
            '\n\nUse screenshot with action=analyze to have the AI examine this image.'
          ),
          // Tier1-1: 成功路径补 structuredContent,让 AI 无需正则解析文本即可拿元信息
          structuredContent: {
            action: 'screenshot_capture',
            image_path: result.imagePath,
            file_size: result.fileSize,
            viewport_width: viewportW,
            viewport_height: viewportH,
            frames_waited: frameDelay,
            ...(blankWarning !== '' && { blank_warning: true }),
          },
        };
      } else {
        return textResult(
          `Screenshot failed: ${result.error}\n\n` +
          (result.godotOutput ? `Godot output:\n${result.godotOutput}\n\n` : '') +
          'Note: Screenshot capture is experimental. Headless rendering may not be available on all systems.'
        );
      }
    }

    case 'analyze': {
      let imagePath = args.image_path as string | undefined;
      const projectPathRaw = typeof args.project_path === 'string' ? args.project_path : undefined;
      const projectPath = projectPathRaw?.trim() ? validatePath(projectPathRaw) : undefined;
      // #1 path-leak: projectPath 提供时校验 isPathInAllowedRoots（对齐 capture :60 requireProjectPath）。
      // analyze projectPath 可选（仅 image_path 时缺），不能直接换 requireProjectPath（强制必填）。
      if (projectPath && !isPathInAllowedRoots(projectPath)) {
        throw new Error(`project_path not in ALLOWED_PROJECT_PATHS: ${projectPath}. Check your ALLOWED_PROJECT_PATHS setting.`);
      }
      const question = (args.question as string) ||
        'Describe what you see in this game screenshot. Focus on: UI elements, character positions, any visual issues or bugs.';

      if (imagePath) {
        if (allowOutsideProjectPaths()) {
          if (!isAbsolute(imagePath) && projectPath) {
            imagePath = resolve(projectPath, normalizeUserProjectPath(imagePath));
          }
          imagePath = validatePath(imagePath);
          // #2 path-leak: allowOutside 分支补 isPathInAllowedRoots（对齐 capture :68 守卫）。
          // validatePath 只 resolve 不校验 root，allowOutside 模式可读 ALLOWED_PROJECT_PATHS 外任意绝对路径。
          if (!isPathInAllowedRoots(imagePath)) {
            throw new Error(`Image path is outside allowed project roots: ${imagePath}`);
          }
        } else {
          if (!projectPath) {
            return opsErrorResult('INVALID_PARAMS', 'project_path is required to resolve image_path (or set GODOT_MCP_UNRESTRICTED=true / ALLOWED_PROJECT_PATHS to allow arbitrary paths).');
          }
          imagePath = resolveWithinRoot(projectPath, normalizeUserProjectPath(imagePath));
        }
      } else if (projectPath) {
        imagePath = join(projectPath, 'screenshot.png');
      } else {
        return opsErrorResult('INVALID_PARAMS', 'either image_path or project_path is required.');
      }

      if (!existsSync(imagePath)) {
        return textResult(`Image not found: ${imagePath}`);
      }

      // I-02: Prevent OOM from reading huge image files (10 MB limit)
      const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
      const fileSize = statSync(imagePath).size;
      if (fileSize > MAX_IMAGE_SIZE) {
        return textResult(
          `Image file too large: ${(fileSize / 1024 / 1024).toFixed(1)} MB. ` +
          `Maximum allowed: 10 MB.`,
        );
      }

      const imageBuffer = readFileSync(imagePath);
      const ext = extname(imagePath).toLowerCase();
      const isPng = ext !== '.jpg' && ext !== '.jpeg';

      // P1-5 视觉成本层级:按 detail 参数选择返回精度
      let detail: 'full' | 'thumbnail' | 'ascii';
      try {
        detail = parseDetailLevel(args.detail);
      } catch (e) {
        return opsErrorResult('INVALID_PARAMS', (e as Error).message);
      }

      // detail=ascii:返回 ASCII art 文本(最低 token 成本)
      if (detail === 'ascii') {
        if (!isPng) {
          return opsErrorResult('INVALID_PARAMS', 'detail=ascii 仅支持 PNG 图像(当前: ' + ext + ')。');
        }
        // review Nit 3: 正数校验,0/负数 clamp 到默认
        const cols = Math.max(1, (args.ascii_cols as number) ?? 80);
        const rows = Math.max(1, (args.ascii_rows as number) ?? 40);
        const asciiArt = downsampleToAscii(imageBuffer, cols, rows);
        // review Nit 1: 用实测维度标注(可能被 clamp/纵向二次采样截断,与入参不等)
        const actualLines = asciiArt.split('\n');
        const actualCols = actualLines[0]?.length ?? 0;
        return {
          content: [
            { type: 'text' as const, text: `ASCII art (${actualCols}×${actualLines.length}, brightness mapped, requested ${cols}×${rows}):\n\`\`\`\n${asciiArt}\n\`\`\`` },
            { type: 'text' as const, text: question },
          ],
          // Tier1-1: 成功路径补 structuredContent
          structuredContent: {
            action: 'screenshot_analyze',
            image_path: imagePath,
            format: 'png',
            detail: 'ascii',
            ascii_cols: actualCols,
            ascii_rows: actualLines.length,
          },
        };
      }

      // detail=thumbnail:返回降采样 PNG base64(中等 token 成本)
      if (detail === 'thumbnail') {
        if (!isPng) {
          return opsErrorResult('INVALID_PARAMS', 'detail=thumbnail 仅支持 PNG 图像(当前: ' + ext + ')。');
        }
        // review Nit 3: 正数校验
        const targetWidth = Math.max(1, (args.thumbnail_width as number) ?? 256);
        const thumb = downsampleToThumbnail(imageBuffer, targetWidth);
        return {
          content: [
            { type: 'image' as const, data: thumb.base64, mimeType: thumb.mimeType },
            { type: 'text' as const, text: `Thumbnail ${thumb.width}×${thumb.height}px (resized to width ${targetWidth}). ${question}` },
          ],
          // Tier1-1: 成功路径补 structuredContent
          structuredContent: {
            action: 'screenshot_analyze',
            image_path: imagePath,
            format: 'png',
            detail: 'thumbnail',
            width: thumb.width,
            height: thumb.height,
          },
        };
      }

      // detail=full(默认):完整 base64 图像(当前行为,最高 token 成本)
      const base64 = imageBuffer.toString('base64');
      const mimeType = isPng ? 'image/png' : 'image/jpeg';

      return {
        content: [
          {
            type: 'image' as const,
            data: base64,
            mimeType,
          },
          {
            type: 'text' as const,
            text: question,
          },
        ],
        // Tier1-1: 成功路径补 structuredContent
        structuredContent: {
          action: 'screenshot_analyze',
          image_path: imagePath,
          format: isPng ? 'png' : 'jpeg',
          detail: 'full',
        },
      };
    }

    default:
      return textResult(`Unknown action: ${action}. Use "capture" or "analyze".`);
  }
}

export const TOOL_META: Record<string, { readonly: boolean; long_running: boolean; actionRisks: Record<string, RiskLevel> }> = {
  screenshot: {
    readonly: true,
    long_running: false,
    actionRisks: {
      capture: 'read',  // 截图写入文件，但本质是只读操作
      analyze: 'read',  // 仅读取图片文件分析
    },
  },
};
