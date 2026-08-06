# 第三方审查:PP1-1 + P1-2 annotations 改进(2026-08-05)

**日期**:2026-08-05
**审查对象**:分支 `feat/p1-1-p1-2-annotations`(基于 master `411dd2a`)上的未提交工作区(working tree)改动
**审查者**:独立 code-reviewer 子 agent(隔离视角,不预设 plan 作者声明为真,所有声明 grep/read 实测)
**审查范围**:设计正确性 / TS-GD 一致性 / 测试质量 / 部署同步 / 仓库级约束独立核查 / 验证完整性

---

## 总体判定

**SHIPPED WITH NITS**(可合并,3 条非阻塞 nit)

P1-1 的 `isPureWrite` 判定逻辑严谨且不 over-claim,P1-2 的 annotations 单一真相源设计正确,四维改动(schema/extract/build-matrix/diff-matrix)齐备且自洽,重建产物(json/md)与源一致,仓库级约束(独立副本同步 / build 同步 / version bump)均未触发。3 条 nit 均为测试覆盖盲区或 plan 声明与代码实际不符的文档瑕疵,不影响功能正确性。

---

## 逐维度结论

### 1. 设计正确性 — ✅ 全部成立

#### 1.1 `isPureWrite` 判定逻辑(`src/core/module-loader.ts:141`)

```ts
const isPureWrite = !hasDestructive && !hasProcess && risks.every(r => r === 'write');
idempotentHint: isReadOnly || isPureWrite,
```

逻辑正确:`risks.every(r => r === 'write')` 同时蕴含「全部 write」「无 destructive」「无 process」「无 read」,配合前置 `!hasDestructive && !hasProcess` 是冗余防御(无害)。注释(`:112-117`)对「readOnly 是 idempotent 的充分条件而非定义」「混合 read+write 保守 false」「destructive/process 一律 false」的论证清晰准确。

#### 1.2 三个纯写工具的 actionRisks 实测(均全部 'write',无 over-claim)

| 工具 | 证据 file:line | actionRisks 值 | idempotent 实测 |
|------|---------------|----------------|-----------------|
| particles | `src/tools/particles.ts:521-524` | `particles_create/set_emission/set_process/load_preset/set_material` 全 'write' | json:2913 = true ✅ |
| cpp | `src/tools/cpp.ts:108` | `scaffold_gdextension: 'write'` | json:1249 = true ✅ |
| csv_to_resources | `src/tools/data-import.ts:428` | `csv_to_resources: 'write'` | json:1356 = true ✅ |

#### 1.3 混合工具保守标 false — 合理

`src/tools/audio-ops.ts:257`:`audio_play/audio_stop/audio_query: 'read'` + `audio_set_param: 'write'`(3 read + 1 write)。按新规则 `isPureWrite=false` → idempotent=false。

#### 1.4 destructive/process 工具标 idempotent=false — 一致

- scene(含 remove_node=destructive):测试 `module-loader-hints.test.ts:82-90` 覆盖
- execute_gdscript/script(含 process):测试 `module-loader-hints.test.ts:51-67` 覆盖

#### 1.5 annotations 单一真相源设计(`src/capability/extract.ts:67-72`)

优先读 `tool.annotations` 最终值(injectTags 派生 + 手动 override),降级到 `deriveMcpHints`。设计正确,保证 matrix 与 `tools/list` 推送内容一致。无 `any`。

#### 1.6 ⚠️ Plan 声明 vs 代码实际不符(非阻塞):inline tool 降级分支是 dead code

唯一 inline tool `confirm_and_execute` 只进 `metaRegistry`,`getAllToolDefinitions()`(`tool-registry.ts:131-133`)不返回它,matrix 无该条目。故 extract.ts:72 的降级分支不可达。作为防御性代码无害。

### 2. TS-GD 一致性 — N/A(无 GDScript 改动)

### 3. 测试质量 — ✅ 基本充分

8 个新用例覆盖 P1-1 核心规则(pure-write idempotent / destructive 守卫 / mixed 保守) + P1-2 字段落盘 + diff 老基线兼容。

### 4. 部署同步 — ✅ 全部就位

- `docs/capability-matrix.json` 38 工具全有 annotations,概览 `idempotent 11 = readOnly 8 + pureWrite 3` 精确吻合
- diff-matrix CI 链路安全:提交后基线含 annotations → drift 归零

### 5. 仓库级约束独立核查 — ✅ 全部未触发

- `.claude/rules/` 与 `rule-templates.ts` 无 annotations/idempotentHint 命中
- `build/` 已同步;`addons/` 不涉及;无需 version bump

### 6. 验证完整性

主 agent 已实测:`npm run lint`(零警告) + `npm run build`(零错误) + `npm test`(300 文件 4406 tests 全绿) + `npm run diff-matrix`(预期 24 条 drift)。

---

## Nits(非阻塞,主 agent 采纳并已修复)

### Nit 1:extract.ts 的 inline-tool 降级分支是 dead code

**处置**:保留代码(防御性兜底),修正 `schema.ts:56` 注释为「防御性兜底,当前不可达」。

### Nit 2(pre-existing):`help.ts:54` 的 `actionRisks: {}` 空对象致 idempotent 低估

**处置**:顺手修复。`help` 是 readonly 查询工具但 actionRisks 空 → idempotent=false(本应 true)。参考 `get-context.ts:259` 的 `_: 'read'` 模式,给 help.ts 填 `actionRisks: { _: 'read' }`。此修复与 P1-1 目标一致(让 idempotent 反映真实重试安全性)。

### Nit 3:手动 override 通道与空 risks 分支无单测

**处置**:在 `module-loader-hints.test.ts` 补 2 条单测:
1. 手动 `annotations: { destructiveHint: true }` 不被派生覆盖
2. `deriveMcpHints(undefined)` / `deriveMcpHints({})` 返回值锁定

在 `extract.test.ts` 补 1 条:`expect(c.annotations).toBeDefined()` 覆盖 F 组。

---

## 值得进 memory 的工程教训

1. **「inline tool 不进 tools/list」是 capability-matrix 的隐式边界**:`getAllToolDefinitions()` 只 flatMap modules,不返回 `registerInlineTool` 注册的 metaRegistry-only 工具。

2. **diff-matrix 双门源差异**:`npm run diff-matrix` 读 git HEAD 基线,`test/regression/defects.ts:145` 的 ts-drift 读磁盘文件。提交前表现不同(前者报 drift 预期,后者因工作区已重建通过)。

3. **idempotent 不等于 readOnly**:MCP spec 的 idempotentHint 语义是「多次执行结果一致/重试安全」,纯写亦满足。P1-1 把「idempotent = readOnly」收紧为「readOnly || isPureWrite」是对 spec 语义的正确还原。
