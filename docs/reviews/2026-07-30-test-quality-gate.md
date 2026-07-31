# E-P2 测试质量门禁 — 第三方独立审查报告

**审查对象**:`scripts/check-test-quality.mjs`(三检测器)+ `test/helpers/integration-setup.js` 删除 + `test/core/ToolDispatcher.telemetry.test.ts` 改动 + `package.json`/`ci.yml` 接线
**审查方法**:隔离视角,所有 spec 声明用 grep/read 独立核实
**审查日期**:2026-07-30
**审查者**:code-reviewer 子 agent(opus)

## 总体判定:**SHIPPED WITH NITS**

设计正确,核心逻辑(括号深度解析器 / export\* 递归追溯 / config 引用查询)经实测全部成立。telemetry 测试改动是真删除死断言(非削弱 PII 防护)。仓库级约束全部不触发。仅 1 个采纳的 nit(Nit-1),不影响 ship。

---

## 逐维度结论

### 1. 设计正确性 — **PASS**

**检测器 2 括号深度解析器 `factoryTopKeys`(`scripts/check-test-quality.mjs:105-147`)完全正确**,逐条核实 spec 关键声明:

| spec 声明 | 核实证据 | 结论 |
|---|---|---|
| 同时追踪 `{}` 和 `()` 深度,忽略箭头函数参数类型注解 `(_root: string)` 的 `_root` | `scripts/check-test-quality.mjs:112-144`:`brace`/`paren` 双计数,`if (brace===1 && paren===0 && ...)` 识别 key;实测 `test/tools/workflow.test.ts:18` 的 `resolveWithinRoot: vi.fn((_root: string, p: string) => ...)` —— `_root` 在 `paren≥1` 层被忽略;`resolveWithinRoot` 在 `brace===1 && paren===0` 层被捕获 | ✅ |
| 跳过 `//` 和 `/* */` 注释 | `scripts/check-test-quality.mjs:122-132`:行注释跳到 `\n`,块注释跳到结束符;防注释里的标识符误判(实测 `godot-server-roots.test.ts:96` 的 `// B-T4:` 注释里的 `T4` 不再误判) | ✅ |
| 处理 `export *` 递归追溯(处理 `src/tools/shared.ts` 纯 re-export) | `src/tools/shared.ts:1-7` 是纯 `export *`;`srcExports`(`:153-175`)递归 + `seen` 防环;实测 `shared.js` mock 的 `opsErrorResult`/`COMMON_ERROR_CODES` 来自 `shared/errors.ts`、`SCENE_TREE_HEADER` 来自 `shared/gdscript-templates.ts`、`wrapAssertionCode` 来自 `shared/assertions.ts`、`validateTimeout` 来自 `shared/validation.ts`、`gdEscape` 来自 `shared/value-serializer.ts`、`parseGdscriptResult` 来自 `shared/errors.ts` —— **全部经 export\* 追溯可达,0 drift** | ✅ |
| 忽略返回值嵌套字段(`getLogger: () => ({ info, debug })` 的 `info`/`debug`) | `test/core/schema-required.test.ts:24-33`:工厂顶层只有 `getLogger`(brace=1,paren=0),`debug`/`info`/`warn`/`error` 在 `mockReturnValue({...})` 内(brace≥2,paren≥1)被忽略;`getLogger ∈ src/core/logger.ts:475` exports → 0 drift | ✅ |

**检测器 1 config 引用查询(`scripts/check-test-quality.mjs:56-60`)**:
- 查 `vitest.config.ts`/`package.json`/`tsconfig.json` 含 basename
- 实测 `vitest.config.ts:7` `setupFiles: ['test/setup.js']` —— `setup.js` 判 live(code 0 + config 1),不误判 ✅
- `integration-setup.js` code 0 + config 0 → 抓为死文件 ✅

**检测器 3 阈值一致性**:
- 独立 grep:`.test.ts` = 184,`.test.js` = 1163,合计 **1347**,与 spec 基线一致
- `WEAK_ASSERTION_LIMIT = 1400` = 1347 + 53 ≈ 4% ✅

### 2. 脚本健壮性 — **PASS**

| 边界 | 核实 | 结论 |
|---|---|---|
| JSDoc 含 `*/` 致 ESM 解析崩 | 全部 `*/` 是合法块注释结束符;`:126` 的 `// 跳过 /* */ 块注释` 在行注释内无害 | ✅ |
| 空块 / 无工厂的 vi.mock | `indexOf('=>')===-1` return `[]`;找不到 `{` return `[]`;keys 空 → `continue` | ✅ |
| 循环 re-export | `srcExports` `seen` 集合防环 | ✅ |
| **mock 路径无 `.js` 后缀 → 全 drift** | 当前代码 0 命中无后缀路径,不触发;**采纳 Nit-1 加兜底** | ⚠️→✅ |
| 模板字面量/字符串内括号 | 处理 `"`/`'`/`` ` `` 三类引号 + `\` 转义 | ✅ |

### 3. telemetry 测试改动安全性 — **PASS(关键防线完整保留)**

1. **T1 PII 防泄漏实质断言完全保留**:
   - `:189`/`:211` `expect(event.error_category).toBe('TOOL_ERROR')` —— 固定枚举断言在 ✅
   - `:213` `expect(JSON.stringify(event)).not.toMatch(/home|wgt|secret|tscn|Main/i)` —— **反假绿全 event 零 PII 片段断言在**(T1 核心,未动)✅
   - 6 个 `it` 块完整

2. **删除的 `expect(mockSafeErrorCategory).not.toHaveBeenCalled()` 确是死断言**:
   - grep `src/` 全量 `safeErrorCategory`:`src/core/ToolDispatcher.ts:485` **仅出现在注释**
   - `ToolDispatcher.ts:31-37` 实际 import 行无 `safeErrorCategory`
   - 即该函数已从 src 完全移除,旧测试 mock 它 + 断言"未被调"是对一个**永不存在的函数**的空断言 —— 删掉正确,且是检测器 2 抓到的真 drift 的反向佐证 ✅

3. **测试仍通过**:`npx vitest run test/core/ToolDispatcher.telemetry.test.ts` 6/6 pass

### 4. 部署同步 — **PASS**

- `package.json:55` `"check:test-quality": "node scripts/check-test-quality.mjs"` —— 与 `check:budget`/`check:gdscript` 同列 ✅
- `ci.yml:40-41` `Check test quality (E-P2 :98)` step 位于 vitest 之前,与其他 check step 对齐 ✅

### 5. 仓库级约束独立核查(AGENTS.md) — **全部不触发**

| 约束 | 核查 | 结论 |
|---|---|---|
| 独立副本同步约束 | 未改 `.claude/rules/`(9 个 rule 文件均未动) | 不适用 ✅ |
| 分发产物与独立副本边界 | 未改 `rule-templates.ts`/`src/capability/`/`build/` | 不适用 ✅ |
| scripts/ 放置边界 | 新脚本在 `scripts/`,eslint 只查 `src/`,tsc 不编译 scripts/ | ✅ |

### 6. 验证完整性 — **PASS**

- 脚本在当前代码 exit 0(实测三检测器全过)
- TDD RED1/2/3/4 故意制造 fail 全验证(死文件/drift/超阈值各触发)

---

## Blocking Issues

**无。**

---

## Nits

### Nit-1(置信度 70,边界健壮性)— **已采纳**

mock 路径无 `.js` 后缀时 `srcPath` 落地无 `.ts` → `existsSync` false → 全部 key 误判 drift。当前代码不触发(全仓带 `.js`),但加一行兜底防未来踩坑:

```js
const srcPath = rel.replace(/\.(js|ts)$/, '.ts');
```

已采纳:见 commit。

### Nit-2(置信度 60,可读性)— **不采纳**

`extractMockCalls` 的 `indexOf('vi.mock(')` 与 `modM` 正则的 `vi\.mock\(\s*` 口径不一致(前者不允许空格)。当前代码无 `vi.mock (` 写法,非问题,跳过。

---

## 值得进 memory 的工程教训

1. **`expect(mockX).not.toHaveBeenCalled()` 是"死断言"的典型形态**:对 src 已删的导出做"未被调"断言,测试永远绿但无防护力。检测器 2 把"mock 与 src 契约 drift"从静默假绿变成 CI 可见 fail。
2. **扁平正则提取 mock 工厂 key 是已知陷阱**:必须括号深度配对(`{}`+`()` 双计数),只在 `brace===1 && paren===0` 识别 key。
3. **`export *` barrel 文件是 drift 检测的必经难点**:`shared.ts`/`helpers.ts` 纯 re-export,必须递归追溯(seen 防环)拿真实导出集。
4. **config 引用 vs import 引用的区分对死文件检测不可省**:`setup.js` 零 import 但经 `vitest.config.ts setupFiles` 引入。

---

## 相关文件清单(绝对路径)

- 脚本:`D:\GitHub\godot-mcp-enhanced\scripts\check-test-quality.mjs`
- 删除:`D:\GitHub\godot-mcp-enhanced\test\helpers\integration-setup.js`
- 改动测试:`D:\GitHub\godot-mcp-enhanced\test\core\ToolDispatcher.telemetry.test.ts`
- 接线:`D:\GitHub\godot-mcp-enhanced\package.json:55`、`D:\GitHub\godot-mcp-enhanced\.github\workflows\ci.yml:40-41`
- spec:`D:\GitHub\godot-mcp-enhanced\docs\superpowers\specs\2026-07-30-e-p2-test-quality-gate-design.md`
