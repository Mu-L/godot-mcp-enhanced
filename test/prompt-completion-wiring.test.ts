import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../src/GodotServer.ts'), 'utf8');

// 项目惯例不实例化 GodotServer，handler 是 wiring（调 handleCompletion），
// 逻辑由 prompts.test.ts 的 handleCompletion 单元覆盖。静态断言验证 handler 接线。
describe('CompleteRequest handler 接线（静态断言）', () => {
  // v2 SDK：setRequestHandler 改用方法字符串，不再 import Schema 常量
  it('setRequestHandler 用 completion/complete 方法字符串', () => {
    expect(src).toMatch(/setRequestHandler\(['"]completion\/complete['"]/);
  });
  it('import 了 handleCompletion from prompts', () => {
    expect(src).toMatch(/handleCompletion.*from\s+['"]\.\/prompts\.js['"]/);
  });
  it('handler 调 handleCompletion', () => {
    expect(src).toMatch(/handleCompletion\(/);
  });
});
