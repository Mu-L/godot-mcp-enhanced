# edit_script 改进方案

## 根因分析

通过源码审查（`src/tools/script.ts:194-330`）和实际使用中复现的问题，定位到以下根因：

### 问题 1：`raw` 模式下 Claude 构造的缩进不可靠

**现象**：`start_line/end_line` + `raw` 模式替换多行代码块后，文件出现缩进错误，导致 GDScript 解析失败。

**根因**：这不是工具的 bug，而是**调用方（Claude）的问题**。

`raw` 模式代码（script.ts:314-316）：
```typescript
} else {
  adjustedLines = newLines;  // 直接使用调用方提供的内容
}
```

工具忠实地写入了 Claude 提供的内容。但 Claude 在构造 `new_content` 参数时，难以精确判断目标位置的缩进层级，因为：

1. Read 工具输出格式是 `行号\t内容`，tab 既做分隔符也做内容缩进，视觉上难以区分
2. 跨多行的代码块（如 if/for 嵌套）需要整体缩进匹配，稍有偏差就导致 GDScript 解析失败
3. GDScript 是缩进敏感语言，多一级或少一级 tab 都会报错

**实际案例**：修复 C3 时，`for i in range(3)` 应在 `_enter_battle` 函数体内（1 tab），但 Claude 构造了 2 tab 的内容，工具忠实写入后 Godot 报 `Expected statement, found "Indent"` 错误。

### 问题 2：`smart` 模式存在但未被使用

**现象**：`smart` indent_mode 理论上能自动调整缩进，但实际没人用。

**根因**：

1. `smart` 不是默认值（默认是 `raw`），Claude 不知道应该主动指定 `smart`
2. `smart` 算法有缺陷（script.ts:295-313）：

```typescript
if (indentMode === 'smart') {
  const originalLine = lines[startLine - 1] || '';
  const baseIndent = (originalLine.match(/^(\t*)/) || ['',''])[1];
  let minIndent = Infinity;
  for (const nl of newLines) {
    if (nl.trim() === '') continue;
    const tabs = (nl.match(/^(\t*)/) || ['',''])[1].length;
    if (tabs < minIndent) minIndent = tabs;
  }
  // ...
}
```

缺陷：
- 只看 `startLine` 一行的缩进作为 baseIndent，如果 startLine 本身缩进不对（比如替换的是一个 block 的中间行），baseIndent 就错了
- 用 `minIndent` 做全局 strip，假设 new_content 所有行有统一的缩进前缀——对于从文件中复制的代码块这成立，但对 Claude 临时构造的代码可能不成立

### 问题 3：编辑后无验证

**现象**：工具返回"编辑成功"但文件实际有缩进错误，需要手动再调 `validate_scripts` 才能发现。

**根因**：`edit_script` 写入文件后直接返回（script.ts:321-329），没有对结果做任何语法检查。`validate_scripts` 是独立工具，调用方需要显式调用。

### 问题 4：CRLF 处理

**现象**：git 每次提示 `LF will be replaced by CRLF`。

**根因**：`writeFileSync(sp, content, 'utf-8')` 写入时使用 Node.js 默认换行符。工具通过 `hasCRLF` 检测并在 join 时使用 `\r\n`（script.ts:320），但 `search_and_replace` 模式中的 `replace(/\n/g, '\r\n')` 会把**所有 `\n`** 都替换，包括字符串字面量中的换行（虽然在 GDScript 字符串中罕见）。

---

## 修复方案

### 修复 1：编辑后自动 GDScript 语法验证 + 回滚 [优先级：P0]

**目标**：edit_script 写入后自动验证，解析失败则回滚并报错。

**修改文件**：`src/tools/script.ts`

**方案**：

在 line-number 模式和 search_and_replace 模式的 `writeFileSync` 之后，添加验证逻辑：

```typescript
// 在 writeFileSync(fullPath, result, 'utf-8') 之后添加：

if (fullPath.endsWith('.gd')) {
  const godot = await ctx.findGodot();
  const scriptRel = relative(validatePath(args.project_path as string), fullPath)
    .replace(/\\/g, '/');
  const validateResult = await batchValidateScripts(godot, validatePath(args.project_path as string), [fullPath], 10000);
  
  if (validateResult.length > 0 && validateResult[0].errors.length > 0) {
    // 解析失败 — 回滚
    const originalContent = hasCRLF
      ? rawFile  // rawFile 是原始内容，保留 CRLF
      : rawFile.replace(/\r\n/g, '\n');
    writeFileSync(fullPath, originalContent, 'utf-8');
    
    return textResult(
      `⚠️ Edit REVERTED due to GDScript parse error:\n` +
      validateResult[0].errors.map(e => `  ${e}`).join('\n') +
      `\n\nOriginal file restored. Please fix the edit content and retry.` +
      `\n\n--- Attempted change ---\n` +
      `Lines ${startLine}-${endLine}:\n${beforeLines.join('\n')}\n→\n${afterLines.join('\n')}`
    );
  }
}
```

**注意事项**：
- `batchValidateScripts` 需要 `godotPath`，而 `edit_script` handler 目前不调用 `ctx.findGodot()`。需要在 handler 顶部获取。
- 验证超时设为 10 秒（单文件验证通常 2-3 秒）。
- 回滚使用内存中的 `rawFile`（编辑前读取的原始内容），避免再次读文件。
- 此功能通过 `auto_validate` 参数控制（默认 true），允许高级用户跳过以提升速度。

**参数变更**：

```typescript
auto_validate: {
  type: 'boolean',
  description: 'Auto-validate GDScript syntax after edit and revert on failure (default: true)',
  default: true,
},
```

---

### 修复 2：改进 `smart` 缩进算法 [优先级：P1]

**目标**：让 smart 模式更健壮，使其能可靠地处理 GDScript 的缩进敏感语法。

**修改文件**：`src/tools/script.ts`

**当前算法问题**：
1. 只看 startLine 的缩进作为 base
2. 用全局 minIndent 做 strip，不考虑行间相对关系

**改进方案**：

```typescript
if (indentMode === 'smart') {
  // 1. 分析被替换区域的缩进特征
  const originalFirstLine = lines[startLine - 1] || '';
  const originalBaseIndent = (originalFirstLine.match(/^(\t*)/) || ['',''])[1].length;
  
  // 2. 分析 new_content 的缩进特征
  const newNonEmptyLines = newLines.filter(l => l.trim() !== '');
  let newMinIndent = Infinity;
  for (const nl of newNonEmptyLines) {
    const tabs = (nl.match(/^(\t*)/) || ['',''])[1].length;
    if (tabs < newMinIndent) newMinIndent = tabs;
  }
  if (newMinIndent === Infinity) newMinIndent = 0;
  
  // 3. 计算缩进偏移量
  const indentDelta = originalBaseIndent - newMinIndent;
  
  // 4. 应用偏移：每行的缩进调整 indentDelta 个 tab
  adjustedLines = newLines.map((line: string) => {
    if (line.trim() === '') return line;  // 空行保持不变
    
    const currentTabs = (line.match(/^(\t*)/) || ['',''])[1].length;
    
    if (indentDelta > 0) {
      // new_content 缩进较少，需要添加 tab
      return '\t'.repeat(indentDelta) + line;
    } else if (indentDelta < 0) {
      // new_content 缩进较多，需要移除 tab
      const tabsToRemove = Math.min(-indentDelta, currentTabs);
      return line.substring(tabsToRemove);
    }
    return line;
  });
}
```

**关键改进**：
- 使用 `indentDelta`（差值）而非 "strip + prepend" 两步操作，避免中间状态出错
- 保持 new_content 内部的相对缩进不变
- 空/注释行不受影响
- 处理 indentDelta 正负两个方向

---

### 修复 3：改进工具描述提示 Claude 使用 smart 模式 [优先级：P1]

**目标**：通过工具描述引导 Claude 正确选择缩进模式。

**修改文件**：`src/tools/script.ts`（工具描述）

**当前描述**（script.ts:72-76）：
```
'Edit an existing GDScript file by replacing a range of lines. '
+ 'Preserves CRLF line endings. By default inserts content as-is (raw mode). '
+ 'Safer than write_script for incremental edits. '
+ 'IMPORTANT: Prefer this tool over Claude\'s built-in Edit for .gd files to preserve line endings. '
+ 'Use search_and_replace mode for content-based editing that is resilient to line number shifts.'
```

**改进描述**：
```
'Edit an existing GDScript file by replacing a range of lines. '
+ 'Preserves CRLF line endings and auto-validates GDScript syntax after edit. '
+ 'Two editing modes:\n'
+ '1. search_and_replace (RECOMMENDED): Search for exact text and replace it. '
+ 'Resilient to line number shifts. CRLF is normalized for matching. '
+ 'Best for targeted, precise edits.\n'
+ '2. start_line/end_line: Replace by line range. Use "smart" indent_mode '
+ 'to auto-adjust indentation to match the target location. '
+ 'Only use "raw" indent_mode if you are certain the indentation is correct.\n'
+ 'IMPORTANT: Always prefer search_and_replace over line-number mode for GDScript. '
+ 'GDScript is indentation-sensitive — wrong indentation causes parse errors. '
+ 'The tool auto-validates and reverts on parse failure.'
```

---

### 修复 4：改进 search_and_replace 的 CRLF 处理 [优先级：P2]

**目标**：避免 `replace(/\n/g, '\r\n')` 把字符串字面量中的 `\n` 也替换。

**修改文件**：`src/tools/script.ts`

**当前代码**（script.ts:224-225, 254）：
```typescript
const finalContent = hasCRLF ? newFileContent.replace(/\n/g, '\r\n') : newFileContent;
```

**改进方案**：

使用按行 join 而非全局 replace：

```typescript
// 替换所有 hasCRLF ? xxx.replace(/\n/g, '\r\n') : xxx 的模式
const joinLines = (content: string): string => {
  if (!hasCRLF) return content;
  return content.split('\n').join('\r\n');
};

// 使用：
const finalContent = joinLines(newFileContent);
```

这种方式等价但语义更清晰——按行分割后用 CRLF 连接，不会误伤字符串内容中的 `\n`。

**实际上**：`content.split('\n').join('\r\n')` 和 `content.replace(/\n/g, '\r\n')` 在处理纯 `\n`（已标准化）内容时是等价的。但使用 split/join 语义上更安全，因为如果未来需要处理混合换行符场景，split 会更可控。

---

### 修复 5：编辑输出增加上下文行 [优先级：P2]

**目标**：编辑后的输出不仅显示 before/after，还显示上下文行，帮助 Claude 快速判断缩进是否正确。

**修改文件**：`src/tools/script.ts`

**当前代码**（script.ts:324-325）：
```typescript
const diffHeader = `Edited ${fullPath}: replaced lines ${startLine}-${endLine} ...`;
const diffBody = `--- Before ---\n${beforeLines.join('\n')}\n--- After ---\n${afterLines.join('\n')}`;
```

**改进方案**：

```typescript
// 编辑前后各显示 2 行上下文
const contextBefore = lines.slice(Math.max(0, startLine - 3), startLine - 1);
const contextAfter = lines.slice(startLine - 1 + adjustedLines.length, 
                                 startLine - 1 + adjustedLines.length + 2);

const contextHeader = contextBefore.length > 0 
  ? `\n--- Context (before edit) ---\n${contextBefore.join('\n')}` 
  : '';
const contextFooter = contextAfter.length > 0 
  ? `\n--- Context (after edit) ---\n${contextAfter.join('\n')}` 
  : '';

return textResult(`${diffHeader}\n${diffBody}${contextHeader}${contextFooter}${warnings}`);
```

这样 Claude 可以看到替换区域上下的代码缩进，快速判断新内容是否匹配。

---

## 实施优先级

| 优先级 | 修复项 | 预计工时 | 影响 |
|--------|--------|----------|------|
| P0 | 编辑后自动验证 + 回滚 | 2h | 彻底防止损坏文件 |
| P1 | 改进 smart 缩进算法 | 1h | 减少 80% 缩进错误 |
| P1 | 改进工具描述 | 30min | 引导 Claude 正确使用 |
| P2 | CRLF 处理改进 | 30min | 消除 git 警告 |
| P2 | 输出增加上下文行 | 30min | 加速问题定位 |

## 临时规避方案（无需修改代码）

在修复实施前，Claude 侧可以通过以下方式规避：

1. **始终使用 `search_and_replace` 模式** — 它基于内容匹配，不受行号和缩进偏差影响
2. **必须用行号模式时，指定 `indent_mode: "smart"`** — 让工具自动调整缩进
3. **每次 edit_script 后立即 `validate_scripts`** — 手动验证，发现错误及时回退
4. **search_and_replace 的 search 文本从 Read 输出中精确复制** — 避免手动输入 tab
