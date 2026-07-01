# CSV → Resource 批量建模 设计

> **Date**: 2026-07-01
> **Status**: Design（待用户复审）
> **Type**: 新功能（新 MCP action）
> **关联**: 项目待办「CSV/Excel → Resource 批量导入调研」（2026-06-28）；续 frame-grounded 之后的下一个技术子项目

## 1. 背景与目标

### 痛点
游戏开发中，游戏数据（物品/敌人/技能/对话表）通常用表格（CSV/Excel）维护。Godot 项目需把这些数据转成 Resource（.tres）供游戏加载。现状：
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
- `parseCsv(text)`：text → 行列矩阵（处理引号/转义/逗号/换行）
- `generateImportScript(rows, classPath, outputDir, filenameCol, opts)`：生成 GDScript 脚本字符串

### GDScript 侧（executeGdscript 执行）
- `load(class_path)` → Class
- 反射读 @export 字段（名+类型，ClassDB / scripting API）
- 每行：`Class.new()` → CSV 列名匹配字段 → 类型转换 `set` → `ResourceSaver.save(output_dir/<filename>.tres)`
- 错误聚合（不中断）

### 为什么 GDScript 做「实例化+保存」重活
`.tres` 自定义类格式复杂（ext_resource 引用 .gd + sub_resource 嵌套），`ResourceSaver` 保证格式正确 + 原生类型检查；TS 拼文本易出错。符合项目 headless executeGdscript 做重活惯例（frame-verify 同模式）。

## 3. 数据流

```
AI 调 csv_to_resources({
  csv_path | csv_content,   // CSV 来源（二选一）
  class_path,               // res://resources/item_resource.gd
  output_dir,               // res://resources/items/
  filename_column,          // 用哪列作文件名（如 "id" / "name"）
  // 可选: strict_missing_column, overwrite_strict
})
  → TS: parseCsv → string[][]
  → TS: generateImportScript(rows, class_path, output_dir, filename_column) → GDScript 字符串
  → executeGdscript(GDScript):
      var Class = load(class_path)
      var fields = 反射 @export 字段({name, type})
      DirAccess.make_dir_recursive(output_dir)
      for row in rows:
        var filename = row[filename_column]
        if filename 空: errors.push({row, reason:"empty filename"}); continue
        var res = Class.new()
        for field in fields:
          if row 有 field.name 列:
            var converted = 类型转换(row[field.name], field.type)
            if 失败: errors.push({row, field, value, reason}); continue
            res.set(field.name, converted)
        ResourceSaver.save(res, output_dir + "/" + filename + ".tres")
        generated.push(...)
  → 返回 {generated, errors, stats}
```

## 4. 类型转换（CSV 字符串 → Godot 类型）

反射拿到字段类型后，CSV 字符串按类型转换：

| Godot 类型 | 转换 |
|---|---|
| `int` | `int(s)`；空 → 0（可选 error） |
| `float` | `float(s)` |
| `bool` | `"true"/"1"` → true；`"false"/"0"/""` → false（可选严格 error） |
| `String` | 原样 |
| `Vector2` / `Vector2i` | `"x,y"` split → parse |
| `Color` | `"#rrggbb"` 或 `"r,g,b"` → Color |
| `Array` / `PackedStringArray` | `"a,b,c"` split |
| 枚举 | 原样字符串（Godot `set` 自动匹配枚举值） |
| 其他未知类型 | 跳过该字段 + 记 error（reason: unsupported type） |

**转换失败**：该字段跳过 + 记 error（行+字段+值+期望类型），**不中断整行**（部分 set）。

## 5. 错误处理（聚合，不抛异常中断）

| 场景 | 处理 |
|---|---|
| CSV 列数不一致 | error（行号），跳过该行 |
| 缺失列（CSV 无某 @export 字段） | 用类默认值（可选 `strict_missing_column` 报错） |
| 多余列（CSV 有字段不存在） | 忽略（可选警告） |
| `filename_column` 空/缺失 | error，跳过该行 |
| 文件名冲突（同目录同名） | overwrite（Godot 默认；可选 `overwrite_strict` 报错） |
| 输出目录不存在 | 自动 `make_dir_recursive` |

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
- `parseCsv(text: string): string[][]` 纯函数
- `generateImportScript(rows, classPath, outputDir, filenameCol, opts): string`
- GDScript 模板（内联或加 `gdscript-templates.ts`）
- 类型转换 + 错误聚合 inline 在 GDScript 脚本（反射后处理）

**工具元数据**：action `csv_to_resources`；风险 = `write`（生成文件）；声明 actionRisks（对齐项目 guard 惯例，需确认令牌）。

## 7. 测试策略（TDD）

### 纯函数单测
- `parseCsv`：引号 / 转义 / 逗号内嵌 / 换行 / 空行 / 空文件 / 单行列 / CRLF
- `generateImportScript`：生成脚本含 `load(class_path)` / 反射 / 每行实例化 / `ResourceSaver.save` 关键片段（字符串断言）

### 集成测试（真 Godot，复用 real-project 靶子）
- 建 `test/fixtures/real-project/resources/test_resource.gd`（`class_name TestResource`，`@export var name:String, var damage:int, var enabled:bool, var color:Color`）
- CSV 数据 → 执行 `csv_to_resources` → 读回 .tres 验证字段值
- 边界：类型不匹配行（记 error，跳过该字段）、空 filename 行（跳过）、缺失列（用默认）

## 8. 风险与备选

### 风险 1：headless Godot 反射自定义 class + ResourceSaver
headless executeGdscript 能否 `load` 自定义 Resource 类（需 `class_name` 注册）+ 反射字段 + `ResourceSaver.save`？
**验证**：实现 Task 1 首先验证（建 TestResource + 最小 CSV，跑通最小链路）。
**备选**：若反射/load 不通，降级到 TS 拼 .tres 文本（自定义类 .tres 格式：ext_resource 引用 .gd + sub_resource；复杂但可行）。

### 风险 2：类型转换边界
空值、locale 数字格式、Color/Vector2 格式变体。
**缓解**：TDD 覆盖各类型边界；错误聚合（失败记 error 不中断）。

## 9. 验收标准

- [ ] `csv_to_resources` action 工作：CSV + class_path → N 个 .tres
- [ ] 类型安全：@export 字段类型正确转换（int/float/bool/String/Vector2/Color/Array）
- [ ] 同名映射：CSV 列名 = 字段名自动匹配
- [ ] 错误聚合：类型不匹配/空 filename 等记 error 不中断
- [ ] 集成测试真 Godot 验证（读回 .tres 字段值）
- [ ] TDD：parseCsv / generateImportScript 纯函数单测 + 集成
- [ ] 全套测试不回归
- [ ] actionRisks 声明（write 风险，需确认令牌）
- [ ] capability-matrix 同步（新工具，build-matrix + lite profile）

## 10. 实现任务拆分（供 writing-plans）

- **T1**：验证 headless 反射 + ResourceSaver 可行性（风险 1 最小 PoC；不通则切备选）
- **T2**：`parseCsv` 纯函数 + TDD（CSV 各边界）
- **T3**：`generateImportScript` + GDScript 模板 + TDD
- **T4**：`csvToResources` action handler + actionRisks 声明
- **T5**：类型转换 + 错误聚合（GDScript inline）
- **T6**：集成测试（real-project TestResource 靶子，真 Godot 读回验证）
- **T7**：capability-matrix 同步 + `verify_delivery`
