import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const godotServerSrc = readFileSync(join(here, '../../src/GodotServer.ts'), 'utf8');
const dispatcherSrc = readFileSync(join(here, '../../src/core/ToolDispatcher.ts'), 'utf8');

// 项目惯例不实例化 GodotServer（依赖重），接线是确定性赋值，用静态断言验证。
// elicitFn→elicitInput 行为由 elicit.test.ts 单元 + middleware.test.ts 集成覆盖。
describe('Elicitation 接线（静态断言）', () => {
  it('GodotServer import 了 elicit 模块', () => {
    expect(godotServerSrc).toMatch(/from ['"]\.\/core\/elicit\.js['"]/);
  });
  it('GodotServer 构造时 setElicitServer(this.server)', () => {
    expect(godotServerSrc).toMatch(/setElicitServer\(this\.server\)/);
  });
  it('GodotServer close 时 setElicitServer(null)', () => {
    expect(godotServerSrc).toMatch(/setElicitServer\(null\)/);
  });
  it('ToolDispatcher elicitFn 非 null（createElicitFn）', () => {
    expect(dispatcherSrc).toMatch(/createElicitFn\(\)/);
    expect(dispatcherSrc).not.toMatch(/createElicitationMiddleware\(\s*[^,]+,\s*null/);
  });
});
