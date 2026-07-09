import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const godotServerSrc = readFileSync(join(here, '../../src/GodotServer.ts'), 'utf8');
const typesSrc = readFileSync(join(here, '../../src/types.ts'), 'utf8');

// 项目惯例不实例化 GodotServer（依赖重），接线是 3 处确定性赋值，用静态断言验证。
// emitter→notification 行为由 progress.test.ts 单元 + ToolDispatcher 透传集成测试覆盖。
describe('GodotServer progress 接线（静态断言）', () => {
  it('import 了 progress 模块', () => {
    expect(godotServerSrc).toMatch(/from ['"]\.\/core\/progress\.js['"]/);
  });
  it('构造时 setProgressSender(this.server)', () => {
    expect(godotServerSrc).toMatch(/setProgressSender\(this\.server\)/);
  });
  it('oninitialized 时 setProgressClientReady(true)', () => {
    expect(godotServerSrc).toMatch(/setProgressClientReady\(true\)/);
  });
  it('close 时 setProgressSender(null) + setProgressClientReady(false)', () => {
    expect(godotServerSrc).toMatch(/setProgressSender\(null\)/);
    expect(godotServerSrc).toMatch(/setProgressClientReady\(false\)/);
  });
});

describe('ToolContext.progress 字段（静态断言）', () => {
  it('ToolContext 含可选 progress 字段', () => {
    expect(typesSrc).toMatch(/progress\?\s*:\s*\(progress:\s*number,\s*total:\s*number/);
  });
});
