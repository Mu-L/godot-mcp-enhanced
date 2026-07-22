// 模拟 ZCode 接入 godot-mcp-enhanced（stdio 客户端 → initialize → tools/list）
// ZCode 是 stdio MCP 客户端，行为与官方 JS SDK 等价（都遵循 MCP spec）。
// 能被这个脚本列出的工具，ZCode 也能列出。
//
// 用法：先 `npm run build`，再 `node docs/zcode-protocol-verify.mjs`
// 来源范式：docs/使用指南-Warp.md §6.2（协议层验证脚本）
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['build/index.js'],
  env: { ...process.env, ALLOWED_PROJECT_PATHS: process.cwd() },
});
const client = new Client({ name: 'zcode-sim', version: '0.0.1' }, { capabilities: {} });

const t0 = Date.now();
await client.connect(transport);
console.log(`[OK] initialize 握手成功 (${Date.now() - t0}ms)`);

const { tools } = await client.listTools();
console.log(`[OK] tools/list 返回 ${tools.length} 个工具`);
console.log(`[OK] 含 inputSchema: ${tools.filter(t => t.inputSchema).length}/${tools.length}`);
console.log(`[INFO] 含 integer 参数的工具: ${tools.filter(t => JSON.stringify(t.inputSchema).includes('"integer"')).length}    ← godot-mcp 用 number 类型，无 f64→i64 强转风险`);
console.log('工具名:', tools.map(t => t.name).join(', '));

await client.close();
console.log(`[OK] 优雅关闭 (总耗时 ${Date.now() - t0}ms)`);
