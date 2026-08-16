import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { handleTool } from '../src/tools/screenshot.js';
import { isolatePathEnv } from './helpers/path-isolation.js';

// Tier1-1: 验证 screenshot 工具成功路径的 structuredContent 字段
// capture 路径:mock captureScreenshot(避免依赖真 Godot 进程)
// analyze 路径:pngjs 自生成合法 PNG(不依赖 Godot,只读文件 + downsample)

// 自生成 64x64 渐变 PNG(2026-08-15 CI 平台债:原依赖 test/fixtures/e2e-project/
// screenshot.png,被 .gitignore 的 test/fixtures/**/*.png 规则忽略 → CI 缺文件挂 3 用例)
const FIXTURE_PNG_BUFFER: Buffer = PNG.sync.write((() => {
  const png = new PNG({ width: 64, height: 64 });
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const idx = (png.width * y + x) << 2;
      png.data[idx] = (x * 4) % 256;
      png.data[idx + 1] = (y * 4) % 256;
      png.data[idx + 2] = 128;
      png.data[idx + 3] = 255;
    }
  }
  return png;
})());

// mock captureScreenshot(capture 路程依赖真 Godot 进程,这里 mock 掉)
vi.mock('../src/screenshot.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/screenshot.js')>();
  return {
    ...actual,
    captureScreenshot: vi.fn(async () => ({
      success: true,
      imagePath: '/fake/screenshot.png',
      fileSize: 12345,
      width: 1920,
      height: 1080,
    })),
  };
});

describe('screenshot structuredContent (Tier1-1)', () => {
  let dir: string;
  let restore: () => void;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'screenshot-sc-'));
    restore = isolatePathEnv({ allowed: [dir] });
  });

  afterEach(() => {
    restore();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('capture action', () => {
    it('成功路径返回 structuredContent(含元信息 + blank_warning 仅警告时出现)', async () => {
      const result: any = await handleTool('screenshot', {
        project_path: dir,
        action: 'capture',
      }, { findGodot: async () => '/fake/godot' } as any);

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toBeDefined();
      expect(result.structuredContent.action).toBe('screenshot_capture');
      expect(result.structuredContent.image_path).toBe('/fake/screenshot.png');
      expect(result.structuredContent.file_size).toBe(12345);
      // viewport_width/height 是配置(默认 1280x720,非 result.width 截图实际维度)
      expect(result.structuredContent.viewport_width).toBe(1280);
      expect(result.structuredContent.viewport_height).toBe(720);
      expect(typeof result.structuredContent.frames_waited).toBe('number'); // 默认 frameDelay
      // 正常截图(非空白)blank_warning 不应出现
      expect(result.structuredContent.blank_warning).toBeUndefined();
    });

    it('空白截图时 blank_warning=true(fileSize < 2048)', async () => {
      // 覆盖 mock 让 fileSize 小(触发 TS 侧 < 2048 警告)
      const { captureScreenshot } = await import('../src/screenshot.js');
      (captureScreenshot as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        imagePath: '/fake/blank.png',
        fileSize: 500, // < 2048 触发 blank 警告
        width: 1920,
        height: 1080,
        godotOutput: '',
      });

      const result: any = await handleTool('screenshot', {
        project_path: dir,
        action: 'capture',
      }, { findGodot: async () => '/fake/godot' } as any);

      expect(result.structuredContent.blank_warning).toBe(true);
    });

    it('capture 失败路径不带 structuredContent(负面断言)', async () => {
      // Nit-1: 验证错误路径不带 structuredContent,防回归
      const { captureScreenshot } = await import('../src/screenshot.js');
      (captureScreenshot as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: false,
        error: 'fake capture failure',
      });

      const result: any = await handleTool('screenshot', {
        project_path: dir,
        action: 'capture',
      }, { findGodot: async () => '/fake/godot' } as any);

      expect(result.structuredContent).toBeUndefined();
    });
  });

  describe('analyze action', () => {
    beforeEach(() => {
      // 自生成 PNG 写入临时目录供 analyze 读取
      writeFileSync(join(dir, 'test.png'), FIXTURE_PNG_BUFFER);
    });

    it('detail=full 返回 structuredContent(无 width/height,因代码不读图像头)', async () => {
      const result: any = await handleTool('screenshot', {
        project_path: dir,
        action: 'analyze',
        image_path: 'test.png',
      }, { findGodot: async () => '/fake/godot' } as any);

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toBeDefined();
      expect(result.structuredContent.action).toBe('screenshot_analyze');
      expect(result.structuredContent.detail).toBe('full');
      expect(result.structuredContent.format).toBe('png');
      expect(result.structuredContent.image_path).toContain('test.png');
      // full 不返 width/height(代码不读图像头)
      expect(result.structuredContent.width).toBeUndefined();
    });

    it('detail=ascii 返回 structuredContent(含 ascii_cols/rows)', async () => {
      const result: any = await handleTool('screenshot', {
        project_path: dir,
        action: 'analyze',
        image_path: 'test.png',
        detail: 'ascii',
      }, { findGodot: async () => '/fake/godot' } as any);

      expect(result.structuredContent).toBeDefined();
      expect(result.structuredContent.action).toBe('screenshot_analyze');
      expect(result.structuredContent.detail).toBe('ascii');
      expect(result.structuredContent.format).toBe('png');
      expect(typeof result.structuredContent.ascii_cols).toBe('number');
      expect(typeof result.structuredContent.ascii_rows).toBe('number');
    });

    it('detail=thumbnail 返回 structuredContent(含 width/height)', async () => {
      const result: any = await handleTool('screenshot', {
        project_path: dir,
        action: 'analyze',
        image_path: 'test.png',
        detail: 'thumbnail',
        thumbnail_width: 128,
      }, { findGodot: async () => '/fake/godot' } as any);

      expect(result.structuredContent).toBeDefined();
      expect(result.structuredContent.action).toBe('screenshot_analyze');
      expect(result.structuredContent.detail).toBe('thumbnail');
      expect(result.structuredContent.format).toBe('png');
      expect(typeof result.structuredContent.width).toBe('number');
      expect(typeof result.structuredContent.height).toBe('number');
    });
  });
});
