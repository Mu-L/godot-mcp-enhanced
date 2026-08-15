// test/p1-4-cache-hints.test.ts
// P1-4 (SEP-2549): 验证 GodotServer 的 cacheHints 配置 + listChanged capabilities 声明。
// 采用源码字面量断言模式(对齐 godot-server-degrade.test.ts F2 模式),
// 避免实例化 GodotServer 的高 mock 成本(cacheHints 是 SDK 内部行为,实例化需连 stdio)。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('P1-4 SEP-2549 cacheHints + listChanged capabilities', () => {
  const src = readFileSync('src/GodotServer.ts', 'utf8');

  describe('listChanged capabilities 声明(配 cacheHints 必需)', () => {
    it('tools.listChanged: true 已声明(manage_tools 切组时通知客户端)', () => {
        // SEP-2549: 配 ttlMs 时最好同时声明 listChanged,否则客户端不订阅通知,
        // 切组后要等 TTL 过期才看到变化。enhanced 实际发 notifications/tools/list_changed。
        expect(src).toMatch(/tools:\s*\{\s*listChanged:\s*true\s*\}/);
      });

    it('resources.listChanged: true 已声明', () => {
      // K-1 (:942①): resources 对象追加 subscribe: true(push 订阅声明),
      // 断言放宽为"listChanged: true 后跟逗号(有后续字段)或闭括号(无后续字段)"两种形态。
      expect(src).toMatch(/resources:\s*\{\s*listChanged:\s*true\s*(?:,|\})/);
    });

    it('prompts.listChanged: true 已声明', () => {
      expect(src).toMatch(/prompts:\s*\{\s*listChanged:\s*true\s*\}/);
    });
  });

  describe('cacheHints 配置(SEP-2549 ttlMs + cacheScope)', () => {
    it('cacheHints 字段已配置在 ServerOptions', () => {
      expect(src).toMatch(/cacheHints:\s*\{/);
    });

    it('tools/list 配置 ttlMs + cacheScope=public(工具清单所有用户相同)', () => {
      // 5min TTL:工具清单仅 manage_tools 主动切组时变,listChanged 通知立即失效缓存
      expect(src).toMatch(/'tools\/list':\s*\{\s*ttlMs:\s*300_000,\s*cacheScope:\s*'public'\s*\}/);
    });

    it('prompts/list 配置 ttlMs + cacheScope=public(prompts 启动后静态)', () => {
      expect(src).toMatch(/'prompts\/list':\s*\{\s*ttlMs:\s*600_000,\s*cacheScope:\s*'public'\s*\}/);
    });

    it('resources/list 配置 cacheScope=private(依赖 project_path,用户特定)', () => {
      expect(src).toMatch(/'resources\/list':\s*\{\s*ttlMs:\s*60_000,\s*cacheScope:\s*'private'\s*\}/);
    });

    it('resources/read 配置 cacheScope=private + 短 TTL(读取特定资源)', () => {
      expect(src).toMatch(/'resources\/read':\s*\{\s*ttlMs:\s*30_000,\s*cacheScope:\s*'private'\s*\}/);
    });

    it('所有 cacheable method 都有配置(无遗漏)', () => {
      // SEP-2549 CACHEABLE_RESULT_METHODS: tools/list, prompts/list, resources/list,
      // resources/templates/list, resources/read, server/discover
      const methods = ["'tools/list'", "'prompts/list'", "'resources/list'",
                       "'resources/templates/list'", "'resources/read'", "'server/discover'"];
      const missing = methods.filter(m => !src.includes(m));
      expect(missing, `cacheHints 缺少 method: ${missing.join(', ')}`).toEqual([]);
    });

    it('所有 ttlMs 值为正数(SEP-2549 要求 >=0,本项目用正值启用缓存)', () => {
      // 提取 cacheHints 块内的 ttlMs: N 形式值,全部应 > 0(0 等于不缓存,失去 P1-4 意义)
      // 用 cacheHints 块定位,避免匹配注释里的 SDK 默认值说明(ttlMs:0)
      const cacheHintsBlock = src.match(/cacheHints:\s*\{([\s\S]*?)\n\s*\},/);
      expect(cacheHintsBlock, 'cacheHints 块未找到').toBeTruthy();
      const block = cacheHintsBlock![1];
      const ttlMatches = [...block.matchAll(/ttlMs:\s*(\d[\d_]*)/g)];
      expect(ttlMatches.length, 'cacheHints 块内应至少有 6 个 ttlMs').toBeGreaterThanOrEqual(6);
      for (const m of ttlMatches) {
        const val = parseInt(m[1].replace(/_/g, ''), 10);
        expect(val, `ttlMs ${m[1]} 应为正数`).toBeGreaterThan(0);
      }
    });
  });
});
