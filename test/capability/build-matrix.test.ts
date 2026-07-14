import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';
import { registerAllModules } from '../../src/core/module-loader.js';
import { extractCapabilities } from '../../src/capability/extract.js';
import { buildMarkdown } from '../../src/capability/build-matrix.js';

const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));

describe('buildMarkdown token budget', () => {
  it('includes token budget summary line and TOP 5 section', () => {
    registerAllModules();
    const caps = extractCapabilities(PROJECT_ROOT);
    const md = buildMarkdown(caps);
    expect(md).toContain('token 预算：tools/list');
    expect(md).toContain('## token 预算 TOP 5');
    // TOP5 必含体积最大的工具
    const top = [...caps].sort((a, b) => b.size.totalBytes - a.size.totalBytes)[0]!;
    expect(md).toContain(`\`${top.name}\``);
    // schema 占比百分比存在
    expect(md).toMatch(/schema 占 \d+%/);
  });
});
