import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// P2-5 (SEP-2133) 回归契约:GodotServer capabilities 必须声明 io.godot-mcp/runtime-bridge extension。
// 让 modern-era 客户端发现 enhanced 的 runtime-bridge 能力(TCP 通道 + 确定性 playtest)。
// 参 headless-whitelist.test.ts F2 模式:读 .ts 源码做字面量断言,防回退。
const TS = readFileSync(join(__dirname, '..', '..', 'src', 'GodotServer.ts'), 'utf-8');

describe('P2-5 extensions declaration (SEP-2133)', () => {
  it('capabilities 含 extensions 字段', () => {
    expect(TS).toMatch(/extensions:\s*\{/);
  });

  it('声明 io.godot-mcp/runtime-bridge extension(反向 URI 命名空间)', () => {
    // MCP extensions 用反向 URI(如 io.godot-mcp/...),区别于 experimental(临时实验)
    expect(TS).toMatch(/['"]io\.godot-mcp\/runtime-bridge['"]\s*:/);
  });

  it('extension 含 description + version + capabilities', () => {
    expect(TS).toMatch(/description:\s*['"].*runtime bridge/i);
    expect(TS).toMatch(/version:\s*['"]\d+['"]/);
    expect(TS).toMatch(/capabilities:\s*\[/);
  });

  it('extension capabilities 含 game_playtest(P2-4 确定性原语发现性)', () => {
    // extension 声明 P2-4 的确定性 playtest 能力,让客户端知道 server 支持
    const extBlock = TS.match(/'io\.godot-mcp\/runtime-bridge'[\s\S]{0,800}?\}\s*,\s*\}/);
    expect(extBlock, 'runtime-bridge extension block found').toBeTruthy();
    expect(extBlock![0]).toMatch(/game_playtest/);
    expect(extBlock![0]).toMatch(/install_override/);
  });

  it('extension 注释标注 era-gated(modern-era only,legacy SDK strip)', () => {
    // extensions 是 2026-07-28 引入,legacy-era 客户端不认识 → SDK encode strip 无害
    expect(TS).toMatch(/era-gated|legacy-era.*strip|2026-07-28/i);
  });
});
