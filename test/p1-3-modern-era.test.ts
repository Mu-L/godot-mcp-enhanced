// test/p1-3-modern-era.test.ts
// P1-3 (SEP-2575): 验证 enhanced opt-in modern era(2026-07-28)双时代支持。
// 采用源码字面量断言模式(对齐 godot-server-degrade.test.ts F2 模式)。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('P1-3 SEP-2575 opt-in modern era 双时代', () => {
  const src = readFileSync('src/GodotServer.ts', 'utf8');

  describe('supportedProtocolVersions 配置', () => {
    it('内联 legacy 版本列表(SDK SUPPORTED_PROTOCOL_VERSIONS 快照,避免测试 mock 耦合)', () => {
      // P1-3: 不从 SDK import(测试 vi.mock 会致 undefined),内联快照 + 注释标明来源
      expect(src).toMatch(/const SUPPORTED_PROTOCOL_VERSIONS/);
      expect(src).toMatch(/'2025-11-25'/);  // SDK core LATEST
      expect(src).toMatch(/'2025-06-18'/);
    });

    it('supportedProtocolVersions 含 2026-07-28(modern era opt-in)', () => {
      // P1-3 核心:追加 '2026-07-28' 到 legacy 列表
      // SDK 检测到 modern 版本 → 自动注册 server/discover + 启用 modern codec
      expect(src).toMatch(/supportedProtocolVersions:\s*\[\.\.\.SUPPORTED_PROTOCOL_VERSIONS,\s*['"]2026-07-28['"]\]/);
    });

    it('保留 legacy 版本(不破坏 2025-era 客户端兼容)', () => {
      // spread SUPPORTED_PROTOCOL_VERSIONS 确保 legacy 版本仍在列表
      expect(src).toMatch(/\.\.\.SUPPORTED_PROTOCOL_VERSIONS/);
    });

    it('有 SDK 同步核查注释(漂移提醒)', () => {
      // 内联快照需与 SDK 同步,注释含核查命令
      expect(src).toMatch(/node -e.*SUPPORTED_PROTOCOL_VERSIONS/);
    });
  });

  describe('Roots 双时代兼容(legacy 兜底 + modern 降级)', () => {
    it('oninitialized 回调保留(legacy 客户端仍走 Roots 拉取)', () => {
      // modern 客户端不触发 oninitialized,但 legacy 客户端仍需要
      expect(src).toMatch(/this\.server\.oninitialized\s*=/);
    });

    it('initRootsIntegration 有 modern era 降级注释', () => {
      // 文档说明 modern era 的 Roots 降级行为(oninitialized 不触发 → env baseline)
      expect(src).toMatch(/P1-3.*SEP-2575.*modern era.*降级/);
    });
  });
});
