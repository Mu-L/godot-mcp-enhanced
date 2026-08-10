# 第三方审查:SEC-P2-6 serializeGdValue 与 gdEscape 字符串转义合并

**审查日期**:2026-08-10
**审查对象**:4 个文件的工作区改动(未提交)
**审查者**:code-reviewer 子 agent(所有声明 grep/read 实测复核)

## 总体判定:**SHIPPED WITH NITS**(0 Blocking + 2 Nit + 1 观察项)

设计正确,转义序列等价性成立,测试有效区分两个入口,无回归。本次合并消除了 scene-commit serializeGdValue 与 gdEscape 之间的字符串转义漂移(IMP-2 注释曾声称"同步"但 `\r` 处理实际未同步)。

## 改动摘要

消除两份独立字符串转义实现的漂移:提取共享 `escapeGdStringCore(s, escapePercent, escapeQuote)`,gdEscape 调 `core(true, true)`(签名不变,30 调用点零影响),新导出 `escapeForGdLiteral` 调 `core(false, false)`(不转义 `%`/`'`),scene-commit serializeGdValue string 分支改调 escapeForGdLiteral。

## 逐维度核实

### 1. 设计正确性 — PASS

**escapeGdStringCore 完整覆盖原 gdEscape**:逐行核对 `value-serializer.ts:29-42`,core 含 10 项转义(8 无条件 + 2 条件),与原 gdEscape 一一对应:
- 无条件:`\r\n`→`\n`(:31)、`\r`→`\n`(:32)、LS/PS→`\n`(:33)、`\\`→`\\\\`(:34)、`\n`→`\\n`(:35)、`\t`→`\\t`(:36)、`"`→`\\"`(:37)、`\0`→删除(:38)
- 条件:`%`→`%%`(:39,escapePercent)、`'`→`\'`(:40,escapeQuote)

`gdEscape` 调 `core(true, true)`(:47)等价原实现。

**转义顺序正确**:`\r\n` 先于 `\r`(否则 `\r\n` 被拆成 `\n\n`);`\\` 翻倍先于 `\n`→`\\n`(否则字面 `\n` 被错误双写);`%`/`'` 在 `\\` 翻倍之后处理,`\'` 引入的新 `\` 不会被前序规则二次处理。无缺陷。

**escapeForGdLiteral(false, false) 精确跳过 %/'**:`value-serializer.ts:54` 调 `core(false, false)`,39-40 行条件不触发,其余 8 项与 gdEscape 一致。

**行为差异清单(逐项核实)**:

| 字符 | 改前(serializeGdValue) | 改后 | 影响 |
|---|---|---|---|
| `\r\n` | `\\r\\n` | `\\n` | 等价(GDScript 都转义,统一更干净) |
| `\r` | `\\r` | `\\n` | 等价(IMP-2 漂移修正) |
| `\0` | 原样保留 | 删除 | **更安全**(原行为有控制字符风险) |
| `%` | 不转义 | 不转义 | 不变 |
| `'` | 不转义 | 不转义 | 不变 |
| `\` `"` `\n` `\t` LS/PS | 转义 | 转义 | 不变 |

### 2. TS-GD 一致性 — PASS

生成字面量如 `"a\\nb"`、`"a\\tb"`、`"say \\"hello\\""`,均为合法 GDScript 双引号转义。`%`/`'` 在 GDScript 双引号字符串里非特殊,保留正确。`\0` 删除对 GDScript 安全。

### 3. 测试质量 — PASS

**escapeForGdLiteral 12 个新测试**(实测 12,非 plan 笔误的 13)覆盖:共享转义 9 个(backslash/newline/CRLF/CR/tab/quote/LS-PS/null/empty)+ 用途差异 2 个(% 不转义、' 不转义)+ 综合 1 个。综合用例(:202-219)对照 gdEscape 综合用例精确验证 `%`/`'` 差异。

**scene-commit 3 个新测试有效区分两入口**:
- `:338-346` `%` 保留:断言 `not.toContain('%%')`,误调 gdEscape 会产生 `%%` 失败。
- `:348-355` 单引号保留:断言 `toContain("\"it's\"")`,误调 gdEscape 产生 `it\'s` 不含 `it's` 失败。
- `:357-364` 删 null:断言 `toContain('"beforeafter"')`,core 漏删会含 NUL 不匹配。

三个测试都能真正捕获 escapeForGdLiteral vs gdEscape 误用。

**旧 \r 断言更新正确**:输入 `'a\tb\rc'` 断言 `toContain('"a\\tb\\nc"')`。推导:`\r`→`\n`(core:32)→`\\n`(:35);`\t`→`\\t`。正确反映新行为。

### 4. 仓库级约束核查 — PASS

- **gdEscape 30 调用点零影响**:签名 `(s: string) => string` 不变,scene-commit 内 13 处 gdEscape 调用全保留,仅 serializeGdValue string 分支改调 escapeForGdLiteral。
- **valueToGd 与 serializeGdValue 保持独立**:valueToGd(`value-serializer.ts:137`)string 分支仍调 gdEscape(`:164`),未误合并。两者语义差异正确保留。
- **无遗漏的字符串转义实现**:grep 确认其他 `\\` replace 命中均为路径转义或 .tscn 格式语法,非 GDScript 字面量,不在本范围。

### 5. 验证完整性 — PASS(实测)

| 验证项 | 结果 |
|---|---|
| `npm run lint` | 0 error |
| `npm run build` | tsc strict 0 error |
| `npm test` | **4855 passed / 0 failed**(原 4840 + 新增 15 测试) |
| `npm run check:gdscript` | **0 errors / 0 warnings**(GODOT_PATH=4.6.3) |
| 反向验证(临时破坏 core LS/PS) | gdEscape + escapeForGdLiteral LS/PS 测试**同时失败**,确认共享 core 真生效;还原后恢复绿 |

## Nits

### Nit-1:测试计数描述误差(已记录,非代码问题)
plan 笔误写"13 个新测试",实测 escapeForGdLiteral 块 12 个 it(grep 精确计数)。无功能影响,仅文档描述。

### Nit-2:valueToGd string 分支调 gdEscape 可能过度转义 %(预存在,非本次引入)
`value-serializer.ts:164` valueToGd 的 string 分支调 gdEscape(转义 `%`→`%%`)。valueToGd 用于 `node.set("k","100%")` 等属性赋值,`%` 无格式化语义,转义成 `%%` 让实际值变 `100%%`(双百分号)。**本次未引入此问题**(valueToGd 行为不变),但与 serializeGdValue 形成不对称。建议后续单独评估 valueToGd 是否也改调 escapeForGdLiteral。不属本次范围。

## memory 教训
1. **"两个相似函数合并"前必须先列语义差异矩阵**:SEC-P2-6 待办正确识别 `%`/`'` 两个差异点,plan 据此用 `escapePercent`/`escapeQuote` 布尔参数化 core,非简单合并(直接合并会改行为)。合并重复实现前,差异点必须显式枚举为参数。
2. **测试区分性比数量重要**:scene-commit 3 个集成测试都能区分 escapeForGdLiteral vs gdEscape 误用——比单纯测函数自身行为更能防回归。集成测试断言要选能区分"正确实现"与"常见误用"的输入。
3. **IMP-2 注释漂移是反面教材**:value-serializer.ts 原 IMP-2 注释声称"与 scene-commit serializeGdValue 同步",但 `\r` 处理实际未同步(`\r\n`→`\n` vs `\\r\\n`)。注释的可信度低于代码,合并后 core 成单一真相源,注释改为"经 escapeForGdLiteral 调同一 core,无需手动同步"。

## 验证
- lint 0 / build 0 / test 4855 passed(+15 新) / check:gdscript 0/0
- 反向验证:破坏 core LS/PS → gdEscape + escapeForGdLiteral 测试同时失败 → 还原恢复
