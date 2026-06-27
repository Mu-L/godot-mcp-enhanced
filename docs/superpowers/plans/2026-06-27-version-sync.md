# version-sync 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 `scripts/version-sync.mjs`(默认写 A 类 3 文件 + `--check` 校验 5 文件一致性)+ npm scripts + CI 门禁,根治版本元数据漂移。

**Architecture:** `package.json` version 为单一真相源。单脚本双模式:默认模式用最小正则替换同步 A 类(manifest/plugin.cfg/使用指南),`--check` 模式读全部 5 文件(含 B 类 CHANGELOG/README)与 package.json 比对。所有正则字符类排除 `\r`、replace 串不含行尾符(保 LF/CRLF)。`--root <dir>` 参数让脚本可在任意项目结构上跑(测试用)。测试用 `spawnSync` 端到端 + tmp fixture。

**Tech Stack:** Node.js ESM(`.mjs`)、vitest、GitHub Actions

**对应 spec:** `D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-06-27-version-drift-resolution-design.md`(v1.1,R1 审查响应后)

## Global Constraints

- Node `>=18.0.0`(package.json engines)
- ESM:`"type": "module"`,新脚本用 `.mjs`(遵循 `scripts/check-rules-version-bump.mjs`)
- **正则字符类统一排除 `\r`**(`[^"\r]`/`[^\s｜\r]`/`[^*\r]`),写入 replace 串不含行尾符 —— 保 LF/CRLF
- CHANGELOG 锚点:`^## \[(.+?)\] - \d{4}-\d{2}-\d{2}`(首个**带日期**段,跳过 `[Unreleased]`)
- 使用指南锚点用全角 `：`/`｜`:`\*\*版本\*\*：([^\s｜\r]+)`
- `tsconfig.json` include 仅 `src/**/*`,test/ 不经 `tsc --noEmit` —— 测试可自由用 `import.meta.url`/spawnSync
- 测试 fixture 放 `mkdtempSync(tmpdir())`,afterEach `rmSync`,不触碰真实仓库文件
- 风格遵循 `scripts/check-rules-version-bump.mjs`(shebang `#!/usr/bin/env node` / 0-1 退出码 / 清晰修复指引),但**比对方式不同**:用 `readFileSync` 读工作区文件(CI 有效),不照抄范本的 `git diff`/`git show`
- 所有文档引用用绝对路径(CLAUDE.md 规范);脚本内文件路径相对 `--root`

## File Structure

| 文件 | 职责 | 动作 |
|------|------|------|
| `scripts/version-sync.mjs` | CLI 单脚本:读取/写入/校验版本号 + main + exit code | Create(~130 行) |
| `test/version-sync.test.ts` | 10 用例,spawnSync 端到端 + tmp fixture | Create |
| `package.json` | 加 `version-sync`/`version-check` 两个 scripts | Modify(scripts 段) |
| `.github/workflows/ci.yml` | check job 加 `version-sync --check` 步 | Modify(check job) |

锚点正则修订总表(源自 spec §2,C1/I1/I2 响应后):

| 文件 | 读锚点 | 写(仅 A 类) |
|------|--------|----------|
| `package.json` | `JSON.parse(content).version`(期望源) | — |
| `manifest.json` | `JSON.parse(content).version` | `"version"\s*:\s*"[^"\r]*"` → `"version": "<v>"` |
| `plugin.cfg` | `^version="([^"\r]*)"` (m) | `^version="[^"\r]*"` (m) → `version="<v>"` |
| `docs/使用指南.md` | `\*\*版本\*\*：([^\s｜\r]+)` | `(\*\*版本\*\*：)[^\s｜\r]+` → `$1<v>` |
| `CHANGELOG.md` | `^## \[(.+?)\] - \d{4}-\d{2}-\d{2}` (m,首个带日期段) | — |
| `README.md` | `^\| \*\*v([^*\r]+?)\*\*` (m,版本表首行) | — |

---

## Task 1: `--check` 校验模式 + 脚本骨架 + 6 文件锚点读取

**Files:**
- Create: `scripts/version-sync.mjs`
- Create: `test/version-sync.test.ts`

**Interfaces:**
- Produces: `scripts/version-sync.mjs` 支持 `node scripts/version-sync.mjs --check [--root <dir>]`,5 文件一致 `exit 0`、漂移或锚点 miss `exit 1`。此 task 实现读取 + 校验 + CLI 骨架;写入模式留 Task 2(默认模式此 task 先占位返回错误,Task 2 填实现)。

- [ ] **Step 1: 写失败测试(`--check` 校验 + 锚点读取)**

创建 `test/version-sync.test.ts`:

```ts
/**
 * version-sync 脚本测试 — spawnSync 端到端 + tmp fixture
 *
 * 覆盖 spec §4 全部 10 用例。本 task 先覆盖校验模式(读取锚点 + 一致性)。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/version-sync.mjs', import.meta.url));

let tmpRoot: string;

/** 在 tmpRoot 下写入相对路径文件(自动建父目录) */
function fixture(files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(tmpRoot, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

/** 生成 6 文件全一致的 fixture(CHANGELOG 默认含 [Unreleased] 段) */
function baseFixture(version: string): Record<string, string> {
  return {
    'package.json': JSON.stringify({ name: 'test', version }, null, 2) + '\n',
    'manifest.json': JSON.stringify({ name: 'test', version }, null, 2) + '\n',
    'addons/godot_mcp_server/plugin.cfg': `[plugin]\n\nname="MCP Server"\nversion="${version}"\nscript="plugin.gd"\n`,
    'docs/使用指南.md': `# 使用指南\n\n> **版本**：${version} ｜ **适用 Godot**：4.x\n`,
    'CHANGELOG.md': `# Changelog\n\n## [Unreleased]\n\n## [${version}] - 2026-06-27\n\n### Fixed\n\n- test\n`,
    'README.md': `# Test\n\n| 版本 | 日期 | 说明 |\n|------|------|------|\n| **v${version}** | 2026-06-27 | test |\n`,
  };
}

/** 跑脚本:run(true)=--check,run(false)=默认写入 */
function run(check: boolean): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT, '--root', tmpRoot, ...(check ? ['--check'] : [])], {
    encoding: 'utf-8',
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'version-sync-'));
});
afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Task 1: --check 校验模式 + 锚点读取
// ---------------------------------------------------------------------------

describe('--check 校验模式', () => {
  it('一致:5 文件全一致(CHANGELOG 含 [Unreleased])→ exit 0', () => {
    fixture(baseFixture('0.19.1'));
    const r = run(true);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('一致');
  });

  it('C1: CHANGELOG [Unreleased] 不误报(首个带日期段被读取)', () => {
    // baseFixture 默认含 [Unreleased];若锚点误读 Unreleased 会 exit 1
    fixture(baseFixture('0.19.1'));
    const r = run(true);
    expect(r.status).toBe(0);
  });

  it('A 类漂移:manifest 版本不一致 → exit 1 + 错误含 manifest', () => {
    fixture(baseFixture('0.19.1'));
    writeFileSync(join(tmpRoot, 'manifest.json'), JSON.stringify({ name: 'test', version: '0.18.2' }, null, 2) + '\n');
    const r = run(true);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('manifest.json');
    expect(r.stderr).toContain('0.18.2');
  });

  it('B 类漂移:CHANGELOG 首条带日期版本号 ≠ package → exit 1', () => {
    fixture({
      ...baseFixture('0.19.1'),
      'CHANGELOG.md': `# Changelog\n\n## [Unreleased]\n\n## [0.18.2] - 2026-06-20\n`,
    });
    const r = run(true);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('CHANGELOG');
  });

  it('B 类漂移:README 版本表首行 ≠ package → exit 1', () => {
    fixture({
      ...baseFixture('0.19.1'),
      'README.md': `# Test\n\n| 版本 | 日期 | 说明 |\n|------|------|------|\n| **v0.18.2** | 2026-06-20 | old |\n`,
    });
    const r = run(true);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('README');
  });

  it('格式 miss:plugin.cfg 缺 version 键 → exit 1(不静默通过)', () => {
    fixture({
      ...baseFixture('0.19.1'),
      'addons/godot_mcp_server/plugin.cfg': `[plugin]\n\nname="No Version"\nscript="plugin.gd"\n`,
    });
    const r = run(true);
    expect(r.status).toBe(1);
  });

  it('prerelease:package=0.20.0-rc.1 + 5 文件含后缀 → exit 0(锚点接受后缀)', () => {
    fixture(baseFixture('0.20.0-rc.1'));
    const r = run(true);
    expect(r.status).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run test/version-sync.test.ts`
Expected: FAIL —— `scripts/version-sync.mjs` 不存在,spawnSync 报错或 `r.status` 非 0/1。

- [ ] **Step 3: 实现 `scripts/version-sync.mjs`(校验模式 + 骨架)**

创建 `scripts/version-sync.mjs`:

```js
#!/usr/bin/env node
// scripts/version-sync.mjs
// 版本漂移根治:package.json version 作单一真相源,同步到 A 类元数据文件,
// --check 模式校验全部 5 文件版本一致(CI 门禁)。
//
// 风格遵循 scripts/check-rules-version-bump.mjs(shebang/0-1 退出码/修复指引),
// 但比对方式不同:本脚本用 readFileSync 读工作区文件(CI 有效),不依赖 git
// (范本的 git diff 在 CI checkout 后工作区==HEAD 会失效,仅本地有效)。
//
// 用法:
//   node scripts/version-sync.mjs            # 写入:同步 A 类 3 文件到 package.json version
//   node scripts/version-sync.mjs --check    # 校验:5 文件一致 exit 0,否则 exit 1
//   node scripts/version-sync.mjs --root <dir>  # 指定项目根(默认 cwd;测试用)
// 退出码:0=成功/一致,1=失败/漂移

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// 逻辑名 → 相对项目根的路径
const TARGET_FILES = {
  packageJson: 'package.json',
  manifest: 'manifest.json',
  pluginCfg: 'addons/godot_mcp_server/plugin.cfg',
  guide: 'docs/使用指南.md',
  changelog: 'CHANGELOG.md',
  readme: 'README.md',
};

// A 类:写入目标(当前版本单值)
const WRITE_TARGETS = ['manifest', 'pluginCfg', 'guide'];
// B 类:仅校验(版本历史,首条版本号)
const CHECK_ONLY = ['changelog', 'readme'];

class AnchorError extends Error {
  constructor(filepath, message) {
    super(`${filepath}: ${message}`);
    this.name = 'AnchorError';
  }
}

// 从单个文件提取版本号(校验/写入幂等判断共用)
function readVersionFromFile(filepath, logicalName) {
  if (!existsSync(filepath)) {
    throw new AnchorError(filepath, '文件不存在');
  }
  const content = readFileSync(filepath, 'utf-8');
  switch (logicalName) {
    case 'packageJson':
    case 'manifest': {
      const obj = JSON.parse(content);
      if (typeof obj?.version !== 'string' || !obj.version) {
        throw new AnchorError(filepath, 'JSON 缺 version 字段');
      }
      return obj.version;
    }
    case 'pluginCfg': {
      const m = content.match(/^version="([^"\r]*)"/m);
      if (!m) throw new AnchorError(filepath, '未找到 version="..." 字段(格式可能被改动)');
      return m[1];
    }
    case 'guide': {
      const m = content.match(/\*\*版本\*\*：([^\s｜\r]+)/);
      if (!m) throw new AnchorError(filepath, '未找到 **版本**：... 字段(格式可能被改动)');
      return m[1];
    }
    case 'changelog': {
      // 首个带日期段,天然跳过 [Unreleased]
      const m = content.match(/^## \[(.+?)\] - \d{4}-\d{2}-\d{2}/m);
      if (!m) throw new AnchorError(filepath, '未找到 ## [x.y.z] - 日期 段(可能全是 [Unreleased] 或格式改动)');
      return m[1];
    }
    case 'readme': {
      const m = content.match(/^\| \*\*v([^*\r]+?)\*\*/m);
      if (!m) throw new AnchorError(filepath, '未找到版本表 | **vx.y.z** 行(格式可能被改动)');
      return m[1];
    }
    default:
      throw new Error(`未知逻辑名: ${logicalName}`);
  }
}

// 校验模式:5 文件版本号全 == package.json version
function checkConsistency(root) {
  const expected = readVersionFromFile(join(root, TARGET_FILES.packageJson), 'packageJson');
  const mismatches = [];
  for (const name of [...WRITE_TARGETS, ...CHECK_ONLY]) {
    const actual = readVersionFromFile(join(root, TARGET_FILES[name]), name);
    if (actual !== expected) {
      mismatches.push({ file: TARGET_FILES[name], expected, actual });
    }
  }
  return { consistent: mismatches.length === 0, version: expected, mismatches };
}

function parseArgs(argv) {
  const args = { check: false, root: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') args.check = true;
    else if (argv[i] === '--root') args.root = argv[++i];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(args.root);

  if (args.check) {
    let result;
    try {
      result = checkConsistency(root);
    } catch (e) {
      console.error(`✗ 版本元数据校验失败: ${e.message}`);
      console.error('  某文件缺失或格式被改动。检查上述文件后重试。');
      process.exit(1);
    }
    if (!result.consistent) {
      console.error(`✗ 版本元数据漂移(期望 ${result.version}):`);
      for (const m of result.mismatches) {
        console.error(`  ${m.file}: ${m.actual} ≠ ${m.expected}`);
      }
      console.error('  修复:npm run version-sync(同步 A 类 manifest/plugin.cfg/使用指南)');
      console.error('       + 手动补 CHANGELOG.md / README.md 版本表(B 类,描述需人写)');
      process.exit(1);
    }
    console.log(`✓ 版本元数据一致 (${result.version})`);
    process.exit(0);
  }

  // 默认(写入)模式 — Task 2 实现
  console.error('✗ 写入模式尚未实现(Task 2)');
  process.exit(1);
}

main();
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run test/version-sync.test.ts`
Expected: PASS —— `--check 校验模式` describe 块 7 个 it 全绿。

- [ ] **Step 5: 提交**

```bash
git add scripts/version-sync.mjs test/version-sync.test.ts
git commit -m "feat(version-sync): --check 校验模式 + 6 文件锚点读取(C1/I1 响应)

CHANGELOG 锚点首个带日期段跳过 [Unreleased];使用指南/README 正则接受
prerelease 后缀;字符类排除 \\r 保行尾。spawnSync 端到端测试 + tmp fixture。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: 默认写入模式(A 类 3 文件同步)

**Files:**
- Modify: `scripts/version-sync.mjs`(替换 main 的"写入模式尚未实现"占位 + 新增 writeVersionToFile/writeVersions)
- Modify: `test/version-sync.test.ts`(新增"写入模式" describe 块)

**Interfaces:**
- Consumes: Task 1 的 `readVersionFromFile`、`TARGET_FILES`、`WRITE_TARGETS`
- Produces: 默认模式 `node scripts/version-sync.mjs [--root <dir>]` 同步 manifest/plugin.cfg/使用指南 到 package.json version,幂等(已一致跳过),保行尾。

- [ ] **Step 1: 写失败测试(写入模式)**

在 `test/version-sync.test.ts` 末尾(Task 1 的 describe 块之后)追加:

```ts
// ---------------------------------------------------------------------------
// Task 2: 默认写入模式
// ---------------------------------------------------------------------------

describe('默认写入模式', () => {
  it('写入同步:A 类 3 文件版本各异 → 写入后 == package version', () => {
    fixture({
      ...baseFixture('0.20.0'),
      'manifest.json': JSON.stringify({ name: 'test', version: '0.19.0' }, null, 2) + '\n',
      'addons/godot_mcp_server/plugin.cfg': `[plugin]\n\nversion="0.18.2"\n`,
      'docs/使用指南.md': `# 使用指南\n\n> **版本**：0.18.2 ｜ x\n`,
    });
    const r = run(false);
    expect(r.status).toBe(0);

    const manifest = JSON.parse(readFileSync(join(tmpRoot, 'manifest.json'), 'utf-8'));
    expect(manifest.version).toBe('0.20.0');

    const cfg = readFileSync(join(tmpRoot, 'addons/godot_mcp_server/plugin.cfg'), 'utf-8');
    expect(cfg).toContain('version="0.20.0"');

    const guide = readFileSync(join(tmpRoot, 'docs/使用指南.md'), 'utf-8');
    expect(guide).toContain('**版本**：0.20.0');
  });

  it('幂等:已一致时再写入 → 文件内容不变 + stdout 含"跳过"', () => {
    fixture(baseFixture('0.19.1'));
    const before = readFileSync(join(tmpRoot, 'manifest.json'), 'utf-8');
    const r = run(false);
    expect(r.status).toBe(0);
    expect(readFileSync(join(tmpRoot, 'manifest.json'), 'utf-8')).toBe(before);
    expect(r.stdout).toContain('跳过');
  });

  it('round-trip:写入后 --check 通过', () => {
    fixture({
      ...baseFixture('0.20.0'),
      'manifest.json': JSON.stringify({ name: 'test', version: '0.19.0' }, null, 2) + '\n',
    });
    expect(run(false).status).toBe(0);
    expect(run(true).status).toBe(0);
  });

  it('prerelease 写入:package=0.20.0-rc.1,A 类漂移 → 写入接受后缀', () => {
    fixture({
      ...baseFixture('0.20.0-rc.1'),
      'manifest.json': JSON.stringify({ name: 'test', version: '0.20.0' }, null, 2) + '\n',
    });
    expect(run(false).status).toBe(0);
    const manifest = JSON.parse(readFileSync(join(tmpRoot, 'manifest.json'), 'utf-8'));
    expect(manifest.version).toBe('0.20.0-rc.1');
  });

  it('CRLF 行尾:写入后仅版本字段变化,行尾 CRLF 保持(I2)', () => {
    const eol = '\r\n';
    fixture({
      'package.json': JSON.stringify({ name: 'test', version: '0.20.0' }, null, 2).replace(/\n/g, eol) + eol,
      'manifest.json': JSON.stringify({ name: 'test', version: '0.19.0' }, null, 2).replace(/\n/g, eol) + eol,
      'addons/godot_mcp_server/plugin.cfg': `[plugin]${eol}${eol}version="0.19.0"${eol}`,
      'docs/使用指南.md': `# 使用指南${eol}${eol}> **版本**：0.19.0 ｜ x${eol}`,
      'CHANGELOG.md': `# Changelog${eol}${eol}## [Unreleased]${eol}${eol}## [0.20.0] - 2026-06-27${eol}`,
      'README.md': `# Test${eol}${eol}| **v0.20.0** | 2026-06-27 |${eol}`,
    });
    const r = run(false);
    expect(r.status).toBe(0);

    const cfg = readFileSync(join(tmpRoot, 'addons/godot_mcp_server/plugin.cfg'), 'utf-8');
    expect(cfg).toContain('version="0.20.0"');     // 版本已更新
    expect(cfg).toContain('\r\n');                  // CRLF 保持
    expect(cfg).not.toMatch(/[^\r]\n/);             // 无裸 LF(行尾未混合)
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run test/version-sync.test.ts`
Expected: FAIL —— `默认写入模式` 5 个 it 失败(脚本写入模式仍是占位 `exit 1`)。

- [ ] **Step 3: 实现写入模式**

在 `scripts/version-sync.mjs` 中:

(a) 在 `readVersionFromFile` 函数之后、`checkConsistency` 之前,新增两个函数:

```js
// 写入单个 A 类文件的版本字段(最小正则替换,保行尾/格式/字段顺序)
function writeVersionToFile(filepath, logicalName, version) {
  const content = readFileSync(filepath, 'utf-8');
  let updated;
  switch (logicalName) {
    case 'manifest':
      updated = content.replace(/"version"\s*:\s*"[^"\r]*"/, `"version": "${version}"`);
      break;
    case 'pluginCfg':
      updated = content.replace(/^version="[^"\r]*"/m, `version="${version}"`);
      break;
    case 'guide':
      updated = content.replace(/(\*\*版本\*\*：)[^\s｜\r]+/, `$1${version}`);
      break;
    default:
      throw new Error(`不可写的目标: ${logicalName}`);
  }
  if (updated === content) {
    return false; // 幂等:无变化,不写
  }
  writeFileSync(filepath, updated, 'utf-8');
  return true;
}

// 写入模式:同步 A 类 3 文件到 package.json version
function writeVersions(root) {
  const expected = readVersionFromFile(join(root, TARGET_FILES.packageJson), 'packageJson');
  const results = [];
  for (const name of WRITE_TARGETS) {
    const filepath = join(root, TARGET_FILES[name]);
    const before = readVersionFromFile(filepath, name);
    const changed = writeVersionToFile(filepath, name, expected);
    results.push({ file: TARGET_FILES[name], before, after: expected, changed });
  }
  return { version: expected, results };
}
```

(b) 在文件顶部 `import` 行,把 `readFileSync` 那行改为同时引入 `writeFileSync`:

```js
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
```

(c) 替换 `main()` 中的占位(末尾的 `// 默认(写入)模式 — Task 2 实现` 整块)为:

```js
  // 默认(写入)模式
  let result;
  try {
    result = writeVersions(root);
  } catch (e) {
    console.error(`✗ 版本同步失败: ${e.message}`);
    console.error('  某文件缺失或格式被改动。检查上述文件后重试。');
    process.exit(1);
  }
  for (const r of result.results) {
    const arrow = r.changed ? `${r.before} → ${r.after}` : `(已是 ${r.after},跳过)`;
    console.log(`  ${r.file}: ${arrow}`);
  }
  console.log(`✓ A 类元数据已同步到 ${result.version}`);
  console.error('  提醒:B 类(CHANGELOG.md / README.md 版本表)需手动追加,描述是人写。');
  process.exit(0);
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run test/version-sync.test.ts`
Expected: PASS —— 全部 12 个 it(Task 1 的 7 + Task 2 的 5)绿。

- [ ] **Step 5: 提交**

```bash
git add scripts/version-sync.mjs test/version-sync.test.ts
git commit -m "feat(version-sync): 默认写入模式(A 类 3 文件同步,最小正则保行尾)

manifest 改最小正则替换(非 JSON.stringify 全量重写,保格式/字段顺序);
幂等(已一致跳过);CRLF 行尾保持(I2);prerelease 后缀透传(I1)。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: npm scripts + CI 集成 + 真实仓库基线绿

**Files:**
- Modify: `package.json`(scripts 段加两项)
- Modify: `.github/workflows/ci.yml`(check job 加一步)

**Interfaces:**
- Consumes: Task 1/2 的 `scripts/version-sync.mjs`
- Produces: `npm run version-sync`(写入)、`npm run version-check`(校验)可用;CI check job 在 `check-rules-version-bump` 后跑 `version-check`;真实仓库 v0.19.1 状态下 `npm run version-check` 立即 `exit 0`。

- [ ] **Step 1: 加 npm scripts**

在 `package.json` 的 `"scripts"` 对象内,`"build"` 行之后追加两行(保持对象内逗号正确):

```json
    "version-sync": "node scripts/version-sync.mjs",
    "version-check": "node scripts/version-sync.mjs --check",
```

(插在 `"build": "tsc && ...",` 与 `"test": "vitest run",` 之间。)

- [ ] **Step 2: 加 CI 步**

在 `.github/workflows/ci.yml` 的 check job 中,`Check rules version bump` 步之后、`npx vitest run ...` 步之前,插入:

```yaml
      - name: Check version metadata consistency
        run: node scripts/version-sync.mjs --check
```

- [ ] **Step 3: 验证真实仓库基线绿**

Run: `npm run version-check`
Expected: `exit 0`,stdout 含 `✓ 版本元数据一致 (0.19.1)`。

> 这是 spec 验收标准的关键项 —— 修复 C1(CHANGELOG `[Unreleased]` 跳过)后,当前 v0.19.1 状态必须立即绿。若 exit 1,检查 CHANGELOG 锚点是否正确跳过了 `[Unreleased]`。

- [ ] **Step 4: 验证 lint + tsc 不引入新错误**

Run: `npm run lint && npx tsc --noEmit`
Expected: 无新错误。

> 注:`test/version-sync.test.ts` 不在 `tsconfig` include(`src/**/*`)内,故 `tsc --noEmit` 不检查它;`scripts/version-sync.mjs` 是纯 JS 不经 tsc。lint 配置若覆盖 `test/` 需确保 spawnSync/import.meta.url 用法合规(项目其他测试如 `logger.test.ts` 已用 node: 前缀 import,惯例一致)。

- [ ] **Step 5: 跑全测试套件确认无回归**

Run: `npx vitest run`
Expected: 全绿(含新 `test/version-sync.test.ts` 12 用例)。

- [ ] **Step 6: 提交**

```bash
git add package.json .github/workflows/ci.yml
git commit -m "feat(version-sync): npm scripts + CI 门禁(version-check 并列 check-rules-version-bump)

CI check job 在 Check rules version bump 后加 Check version metadata consistency
(主题互补:前者查模板变要 bump,后者查 bump 后元数据要一致)。真实 v0.19.1 基线绿。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review(plan 自审,对照 spec v1.1)

**1. Spec 覆盖:**
- spec §1 架构(单脚本双模式 + npm scripts + CI 步)→ Task 1/2/3 ✅
- spec §2 锚点表(6 文件,C1/I1/I2 修订)→ Task 1 readVersionFromFile 全部 6 锚点 ✅
- spec §2 写入(manifest 最小正则 / plugin.cfg / 使用指南)→ Task 2 writeVersionToFile ✅
- spec §2 读写同源(manifest 读 JSON/写正则权衡)→ Task 1 读 + Task 2 写,均指向 .version 语义 ✅
- spec §3 错误处理(文件缺失/锚点 miss/semver 后缀/幂等/行尾机制/退出码)→ Task 1 AnchorError + Task 2 幂等/CRLF ✅
- spec §4 测试 10 用例 → Task 1(7 用例)+ Task 2(5 用例)= 12 it,覆盖 CHANGELOG-Unreleased / prerelease / CRLF / 格式 miss / 幂等 / round-trip / A+B 类漂移 ✅
- spec CI 集成(check-rules-version-bump 后并列)→ Task 3 ✅
- spec 发版流程(publish 时序)→ spec 已文档化,plan 不改流程(属文档)✅
- spec 验收标准 8 条 → Task 3 Step 3-5 验证基线绿/round-trip/CRLF/lint/tsc + CI 步 ✅
- A2(plugin.cfg 段限定多余,YAGNI 不动)→ plan 锚点不限定段(单段文件,唯一匹配)✅
- A3(fixture 对照 test/fixtures/ 惯例)→ 探索结论:无现成多文件 fixture 模式,用 mkdtempSync 自建(logger.test.ts 同款)✅

**2. 占位符扫描:** 无 TBD/TODO。Task 1 Step 3 的"默认(写入)模式 — Task 2 实现"是**有意的两阶段占位**(Task 1 先 ship 校验、Task 2 填写入),非计划缺陷,且 Task 2 Step 3(c) 明确替换它。所有代码块完整。

**3. 类型一致性:** `readVersionFromFile(filepath, logicalName)` 签名在 Task 1/2 一致;`writeVersionToFile(filepath, logicalName, version)` 在 Task 2 定义并被 `writeVersions` 调用,签名一致;`TARGET_FILES`/`WRITE_TARGETS`/`CHECK_ONLY` 常量名跨 task 一致;测试 `run(check)`/`fixture(files)`/`baseFixture(version)` 辅助函数在 Task 1 定义、Task 2 复用,签名一致。

**4. 正则与 spec 锚点表逐一核对:** manifest 写 `"version"\s*:\s*"[^"\r]*"` ✓;plugin.cfg 写 `^version="[^"\r]*"` ✓;guide 写 `(\*\*版本\*\*：)[^\s｜\r]+` ✓(全角);CHANGELOG 读 `^## \[(.+?)\] - \d{4}-\d{2}-\d{2}` ✓;README 读 `^\| \*\*v([^*\r]+?)\*\*` ✓。全部含 `\r` 排除。

无 issue,plan 可执行。
