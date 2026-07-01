# CSV → Resource 批量建模 设计

> **Date**: 2026-07-01
> **Status**: Design v2（复审修订：2 CRITICAL + 4 IMPORTANT 已纳入）
> **Type**: 新功能（新 MCP action）
> **关联**: 项目待办「CSV/Excel → Resource 批量导入调研」（2026-06-28）；复审报告 `D:\workspace\review\.claude\reviews\2026-07-01-godot-mcp-enhanced-csv-to-resource-spec-review.md`

## 1. 背景与目标

### 痛点
游戏开发中，游戏数据（物品/敌人/技能/对话表）通常用表格（CSV）维护。Godot 项目需把这些数据转成 Resource（.tres）供游戏加载。现状：
- Godot 编辑器无原生 CSV → Resource 批量导入（需手写 EditorImportPlugin 或逐个创建）
- 竞品 MCP 工具（godot-mcp-pro / Coding-Solo 等）无此能力（赛道空白）
- AI 通过 MCP 建模游戏数据时只能逐个手写 .tres，无法批量

### 目标
新 MCP action `csv_to_resources`：AI 给 CSV + Resource 类路径 → 批量生成 Godot Resource（.tres），类型安全（@export 字段反射 + 同名列匹配），每行一个 .tres。

### 核心场景（用户定）
**AI 批量建模游戏数据**：AI 调 `csv_to_resources`，给 CSV（物品表）+ 类路径 → 工具反射读类 @export 字段，CSV 列同名匹配，每行一个 .tres。主要调用者 = AI。

### 非目标（YAGNI，v1 不做）
- Excel `.xlsx`（二进制，用户先导出 CSV；调研结论）
- Resource → CSV 导出（单向）
- 嵌套 Resource 引用（字段是另一个 .tres）
- CSV 列 → 字段重命名 override（v1 同名约定，override 留 v2）

## 2. 架构（双轨，复用 frame-verify 惯例）

### TS 纯函数侧（可单测）
- `parseCsv(text)`：**前置格式校验**（行数一致 / filename_column 存在 / 非空）。**不嵌入值到脚本**（仅校验）。
- `generateImportScript(classPath, outputDir, filenameCol, csvTmpPath, opts)`：生成 GDScript 脚本。脚本只接这 4 个 MCP 参数（AI 提供，**全部经 `gdEscape` 转义**），CSV 数据本身不进脚本字符串。
- 写 CSV 原文到临时文件（项目 tmpdir 惯例），传 `csvTmpPath` 给脚本。

### GDScript 侧（executeGdscript 执行）
- `load(class_path)` → Class（依赖 `class_name` 注册 + `global_script_class_cache.cfg`，见 §8 风险）
- 反射读 @export 字段（名+类型，`ClassDB.class_get_property_list` / scripting API）
- `FileAccess.open(csvTmpPath).get_csv_line()` 逐行读 CSV（Godot 原生 CSV 解析，处理引号/逗号/换行）—— **CSV 值通过运行时读取，零进脚本源码字符串**
- 每行：`Class.new()` → CSV 列名匹配字段 → 类型转换 `set` → `ResourceSaver.save(output_dir/<filename>.tres)`
- 错误聚合（不中断）

### 为什么 GDScript 做「实例化+保存」+「CSV 解析」重活
1. `.tres` 自定义类格式复杂（ext_resource 引用 .gd + sub_resource 嵌套），`ResourceSaver` 保证格式正确 + 原生类型检查；TS 拼文本易出错。
2. **CSV 注入根治（CRITICAL-1）**：CSV 值通过 `FileAccess.get_csv_line()` 运行时读取（数据值赋值），不进 GDScript 源码字符串 → 零闭串注入面。frame-verify/gdscripts.ts:8 的 gdEscape 模式用于小量参数；CSV 批量数据用 FileAccess 更根治（数据与代码分离）。

## 3. 数据流

```
AI 调 csv_to_resources({
  csv_path | csv_content,   // CSV 来源（二选一）
  class_path,               // res://resources/item_resource.gd（经 gdEscape）
  output_dir,               // res://resources/items/（经 gdEscape + resolveWithinRoot）
  filename_column,          // 用哪列作文件名（如 "id"）
})
  → TS: parseCsv(text) 前置校验（行数一致 / filename_column 存在 / 非空）→ 失败即 return error
  → TS: 写 CSV 原文到临时文件 csvTmpPath（tmpdir）
  → TS: generateImportScript(classPath, outputDir, filenameCol, csvTmpPath) → GDScript 字符串
       （4 参数经 gdEscape；CSV 数据零进脚本）
  → executeGdscript(GDScript):
      var Class = load(class_path)
      var fields = 反射 @export 字段({name, type})
      var f = FileAccess.open(csvTmpPath, FileAccess.READ)
      var header = f.get_csv_line()           // 列名
      var fnIdx = header.find(filename_column)
      DirAccess.make_dir_recursive(output_dir)
      while not f.eof_reached():
        var row = f.get_csv_line()            // Godot 原生 CSV 解析(引号/逗号/换行)
        var filename = row[fnIdx]
        if not filename 白名单 ^[A-Za-z0-9_-]+$: errors.push({row, reason:"invalid filename"}); continue
        var fullPath = output_dir + "/" + filename + ".tres"
        // CRITICAL-2: filename 白名单(上行)已防 ../ 遍历;output_dir 沙箱在 TS pre(action 入口 resolveWithinRoot)
        var res = Class.new()
        for field in fields:
          var colIdx = header.find(field.name)
          if colIdx == -1: continue            // 缺失列 → 不 set(保留类默认)
          var raw = row[colIdx]
          if raw == "": continue               // 空单元格 → 不 set(见 §4 空值语义)
          var converted = 类型转换(raw, field)  // 含枚举 ClassDB 转 int
          if 失败: errors.push({row, field, value, reason}); continue
          res.set(field.name, converted)
        ResourceSaver.save(res, fullPath)
        generated.push(fullPath)
  → 返回 {generated, errors, stats}
```

## 4. 类型转换（CSV 字符串 → Godot 类型）

反射拿到字段类型后，CSV 字符串按类型转换：

| Godot 类型 | 转换 |
|---|---|
| `int` | `int(s)`；空 → 见「空值语义」 |
| `float` | `float(s)` |
| `bool` | `"true"/"1"` → true；`"false"/"0"` → false |
| `String` | 原样 |
| `Vector2` / `Vector2i` | `"x,y"` split → parse |
| `Color` | `"#rrggbb"` 或 `"r,g,b"` → Color |
| `Array` / `PackedStringArray` | `"a,b,c"` split |
| **枚举** | `ClassDB.class_get_integer_constant(class_name, enum_key)` 转 int（Godot 枚举 set 要 int，非字符串） |
| 其他未知类型 | 跳过该字段 + 记 error（reason: unsupported type） |

**转换失败**：该字段跳过 + 记 error（行+字段+值+期望类型），**不中断整行**（部分 set）。

### 空值语义（IMPORTANT，区分两种「无值」）
- **空单元格**（CSV 有该列但值为空 `""`）：视为显式空 → **跳过 set**（保留类定义的默认值）+ 记 warning（可选严格模式 error）。避免空字符串覆盖类默认（如 `damage` 默认 10 被 `""` 覆盖成 0）。
- **缺失列**（CSV header 无该字段列）：**不 set**（保留类默认），静默（可选 `strict_missing_column` 报错）。

## 5. 错误处理 + 安全防护（聚合，不抛异常中断）

### 错误聚合
| 场景 | 处理 |
|---|---|
| CSV 行内列数不一致 | `get_csv_line` 自然处理（缺列短数组），TS 前置校验 + GDScript 行级宽容 |
| 缺失列 / 空单元格 | 见 §4 空值语义 |
| 多余列（CSV 有字段不存在） | 忽略（反射字段无该名 → 不 set） |
| `filename_column` 空/缺失 | error，跳过该行 |
| 文件名冲突（同目录同名） | overwrite（Godot 默认；可选 `overwrite_strict` 报错） |
| 输出目录不存在 | 自动 `make_dir_recursive` |

### 安全防护（CRITICAL）
- **CRITICAL-1 CSV 注入**：CSV 值不进 GDScript 源码字符串（`FileAccess.get_csv_line()` 运行时读取）。脚本仅接 4 个 MCP 参数（class_path/output_dir/filename_column/csvTmpPath），全部经 `gdEscape`。
- **CRITICAL-2 filename 路径遍历**（两层分工）：
  - filename 白名单 `^[A-Za-z0-9_-]+$`（**GDScript 行级**，拒 `../` / `\` / 空格 / 特殊字符）→ 防 filename 内遍历
  - `output_dir` 过 `resolveWithinRoot(projectRoot, output_dir)`（**TS pre**，action 入口校验，realpathSync 沙箱）→ 防 output_dir 本身的遍历 + symlink（`resolveWithinRoot` 是 TS 函数，GDScript 不能调）

**返回结构**：
```typescript
{
  generated: string[],   // 生成的 .tres 路径
  errors: Array<{ row: number, col?: string, field?: string, value?: string, reason: string }>,
  stats: { rows: number, generated: number, failed: number }
}
```

## 6. 组件结构

`src/tools/data-import.ts`（新单文件，符合项目「单文件单职责」惯例；需拆再升级目录）：
- `csvToResources` action handler（MCP 入口，挂 ToolDispatcher）
- `parseCsv(text: string): { ok, rows?, error? }` 纯函数（前置格式校验，不嵌入值）
- `generateImportScript(classPath, outputDir, filenameCol, csvTmpPath, opts): string`（4 参数经 gdEscape）
- `writeTmpCsv(text): string`（写临时 CSV 文件，返回路径）
- GDScript 模板（内联或加 `gdscript-templates.ts`）
- 类型转换 + 错误聚合 + filename 白名单 inline 在 GDScript（反射后处理）；`output_dir` resolveWithinRoot 在 TS pre（action 入口）

**工具元数据**：action `csv_to_resources`；风险 = `write`（生成文件）；声明 `actionRisks: { csv_to_resources: 'write' }`（对齐项目 guard 惯例，需确认令牌）。
> 注：项目 2026-06-29 risk-level-field 已从 `GUARDED` 迁移到 `actionRisks`（`grep src GUARDED` 零残留），本工具用 actionRisks。

## 7. 测试策略（TDD）

### 纯函数单测
- `parseCsv`：行数一致 / filename_column 存在 / 空文件 / 单行列 / CRLF（格式校验语义）
- `generateImportScript`：生成脚本含 `load(class_path)` / 反射 / `FileAccess.get_csv_line` / `ResourceSaver.save` 关键片段；**4 参数经 gdEscape**（断言含转义后值）；**CSV 数据零嵌入**（断言脚本不含 CSV 行数据）
- **CRITICAL-1 注入单测**：CSV 含 `" ${ \n ;` 等闭串字符 → 脚本不含这些（数据走 FileAccess）+ 执行不逃逸
- **CRITICAL-2 路径遍历单测**：filename=`../x` / `a\b` / `a b` → 白名单拒（error）；output_dir 含 `..` → resolveWithinRoot 拒

### 集成测试（真 Godot，复用 real-project 靶子）
- 用 real-project 的 `global_script_class_cache.cfg`（class_name 已注册）建 `TestResource.gd`（`@export var name:String, var damage:int, var enabled:bool, var color:Color, var kind:int`（枚举））
- CSV 数据 → 执行 `csv_to_resources` → 读回 .tres 验证字段值（含枚举 int、Color、空单元格保留默认）
- 边界：类型不匹配行（记 error，跳过该字段）、空 filename 行（跳过）、`../` filename（拒）

## 8. 风险与备选

### 风险 1：headless Godot 反射自定义 class + ResourceSaver + class_name 缓存
headless executeGdscript 能否 `load` 自定义 Resource 类（需 `class_name` 注册）+ 反射字段 + 枚举 ClassDB 转 + `ResourceSaver.save`？
**T1 退出标准（4 项可测断言，必须全过）**：
1. `load(class_path)` 返回非 null（class_name 缓存命中 `global_script_class_cache.cfg`）
2. 反射拿到 @export 字段名+类型（`ClassDB.class_get_property_list` 非空）
3. 枚举字段 `ClassDB.class_get_integer_constant` 转 int 成功 + `res.set(enum_field, int_val)` 不报错
4. `ResourceSaver.save` 落盘 .tres + 重新 `load` 读回字段值一致

**备选**：若反射/load 不通，降级到 TS 拼 .tres 文本（自定义类 .tres 格式：ext_resource 引用 .gd + sub_resource；复杂但可行；CSV 注入防护改为 TS 侧 gdEscape 每格 + 补注入单测）。

### 风险 2：类型转换边界
空值、locale 数字格式、Color/Vector2 格式变体。
**缓解**：TDD 覆盖各类型边界；错误聚合（失败记 error 不中断）；空值语义明确（§4）。

## 9. 验收标准

- [ ] `csv_to_resources` action 工作：CSV + class_path → N 个 .tres
- [ ] 类型安全：@export 字段类型正确转换（int/float/bool/String/Vector2/Color/Array/**枚举 int**）
- [ ] 同名映射：CSV 列名 = 字段名自动匹配
- [ ] **CRITICAL-1**：CSV 值零进 GDScript 脚本（FileAccess 读），注入单测过
- [ ] **CRITICAL-2**：filename 白名单 + resolveWithinRoot，路径遍历单测过
- [ ] 空值语义：空单元格/缺失列保留类默认（不覆盖）
- [ ] 错误聚合：类型不匹配/空 filename/无效 filename 记 error 不中断
- [ ] 集成测试真 Godot 验证（读回 .tres 字段值，含枚举/Color）
- [ ] TDD：parseCsv / generateImportScript / 注入 / 路径遍历 单测 + 集成
- [ ] 全套测试不回归
- [ ] actionRisks 声明（write 风险，需确认令牌）
- [ ] capability-matrix 同步（新工具，build-matrix + lite profile）

## 10. 实现任务拆分（供 writing-plans）

- **T1**：验证 headless 反射 + ResourceSaver + 枚举 ClassDB 可行性（风险 1，4 项断言 PoC；不通则切 TS 拼 .tres 备选）
- **T2**：`parseCsv` 前置校验纯函数 + TDD（格式 / filename_column / 空文件）
- **T3**：`generateImportScript` + GDScript 模板 + TDD（含 **CRITICAL-1 A 方案设计决策**：CSV 走 FileAccess，4 参数 gdEscape；注入单测）
- **T4**：`csvToResources` action handler + actionRisks 声明 + 临时 CSV 文件管理
- **T5**：类型转换（含**枚举 ClassDB 转 int**）+ 空值语义（空单元格 vs 缺失列）+ 错误聚合（GDScript inline）
- **T6**：**CRITICAL-2** filename 白名单 + resolveWithinRoot post-check + 路径遍历单测
- **T7**：集成测试（real-project TestResource 靶子，真 Godot 读回验证，含枚举/Color/空值）
- **T8**：capability-matrix 同步 + `verify_delivery`
