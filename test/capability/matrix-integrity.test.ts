// test/capability/matrix-integrity.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { registerAllModules } from '../../src/core/module-loader.js';
import { getAllToolDefinitions } from '../../src/core/tool-registry.js';
import { extractCapabilities } from '../../src/capability/extract.js';
import { GROUP_SOURCE_FILES, scanDangerApi } from '../../src/capability/static-grep.js';

// test/capability/ → 项目根：去掉文件名 + capability/ + test/ = 上 3 级。
// 注：new URL('../', fileUrl) 第一个 ../ 仅移除文件名，故用 '../../' 等价"目录上 3 级"。
// 与 src/capability/build-matrix.ts:40 的 '../../'（src/capability/ → 根）同语义。
const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));

describe('capability matrix integrity (spec §10 L1)', () => {
  it('matrix covers every registered tool, 0 hand-written entries', () => {
    registerAllModules();
    const registryNames = new Set(getAllToolDefinitions().map(t => t.name));
    const caps = extractCapabilities(PROJECT_ROOT);
    const matrixNames = new Set(caps.map(c => c.name));
    // 双向一致：registry 的工具全在矩阵，矩阵无多余
    for (const n of registryNames) expect(matrixNames.has(n)).toBe(true);
    expect(caps.length).toBe(registryNames.size);
  });

  it('committed docs/capability-matrix.json is in sync with live extraction', () => {
    registerAllModules();
    const live = extractCapabilities(PROJECT_ROOT).map(c => c.name).sort();
    const committed = JSON.parse(readFileSync(join(PROJECT_ROOT, 'docs/capability-matrix.json'), 'utf8'));
    const committedNames = committed.tools.map((c: any) => c.name).sort();
    expect(live).toEqual(committedNames); // 不同步 → 忘跑 build-matrix，CI 应红
  });

  it('invariant: every securityLevel=danger-api tool is reproducible from GROUP_SOURCE_FILES', () => {
    registerAllModules();
    const caps = extractCapabilities(PROJECT_ROOT);
    const danger = caps.filter(c => c.securityLevel === 'danger-api');
    // 每个 danger-api 工具都有 group（可追溯到源文件）+ 源文件真实存在且能扫到 danger API
    // R1-I-2: 防 GROUP_SOURCE_FILES 路径过时（重构未跟）导致 danger 组 silent 漏扫
    for (const c of danger) {
      expect(c.group, `${c.name} group=unknown`).not.toBe('unknown');
      const files = GROUP_SOURCE_FILES[c.group] ?? [];
      const existsCount = files.filter(f => existsSync(join(PROJECT_ROOT, 'src', 'tools', f))).length;
      expect(existsCount, `${c.name} (group=${c.group}): GROUP_SOURCE_FILES 列的文件全不存在 —— 路径过时(重构未跟?)`).toBeGreaterThan(0);
      const hits = scanDangerApi(files, PROJECT_ROOT);
      expect(hits.length, `${c.name} (group=${c.group}): 源文件存在但 scanDangerApi 无命中`).toBeGreaterThan(0);
    }
  });

  it('invariant (reverse, M-2): GROUP_SOURCE_FILES 命中 danger 的组, 组内工具须标 danger-api', () => {
    registerAllModules();
    const caps = extractCapabilities(PROJECT_ROOT);
    // 反向: 防 GROUP_SOURCE_FILES 命中 danger 但 matrix 未标 → silent 漏扫(R1-I-1 教训)
    for (const [group, files] of Object.entries(GROUP_SOURCE_FILES)) {
      const hits = scanDangerApi(files, PROJECT_ROOT);
      if (hits.length === 0) continue;
      const toolsInGroup = caps.filter(c => c.group === group);
      for (const c of toolsInGroup) {
        expect(c.securityLevel, `${c.name} (group=${group}) 源文件 danger 命中 ${hits.join(',')} 但未标 danger-api`).toBe('danger-api');
      }
    }
  });
});
