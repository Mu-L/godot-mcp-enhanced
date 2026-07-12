# RCE 复合链修复设计

**日期**：2026-07-12
**类型**：安全 CRITICAL
**来源**：任务看板第 1 条（CRITICAL RCE 复合链）+ 全维度审查 + security-rce-review 第二轮独立对抗复核
**HEAD**：`8cbac21`

## 背景

三步联动的零确认 RCE 复合链，作者 IMPORTANT-13 注释自承未修，systematic-debugging Phase 1 独立 Read 源码全链确认：

1. **零确认写盘 + 注册 class_name**：`src\guard.ts:56-62` `dynamicRiskOverride` 把 `script.edit_script + search_and_replace` 降级为 `'read'` → `requiresConfirmation` 返 false 不生成确认令牌 → `src\tools\script.ts:498/542` `writeFileSync` 落盘任意内容 → `:517/559` `ensureClassNameImport` 触发 `godot --headless --import` 注册新 class_name
2. **create_scene root_node_type 无校验**：`src\tools\scene\index.ts:228` `params.root_node_type = args.root_node_type` 直接透传（对比 `quick_scene:257` / `add_node:141` / `batch_add_nodes:315` 都有 `^[A-Za-z0-9_]+$` 校验，create_scene 没有）
3. **godot_operations.gd 脚本分支 script.new() 无校验**：`src\scripts\godot_operations.gd:177-179` `return script.new()` 零校验（对比 ClassDB 分支 `:160-175` 有 `is_parent_class("Node")` IMPORTANT-13 修）

**攻击路径**：`edit_script search_and_replace` 注入恶意 `class_name X` 到 `.gd`（`_init` 含 `OS.execute`）→ 零确认写盘+注册 → `create_scene root_node_type="X"` → `godot_operations.gd:202` `instantiate_class("X")` → `:177-179` `script.new()` 执行恶意脚本 = **零确认 RCE**

## 修复方案（三层联动，用户已选）

### 修复点 1：`src\guard.ts:54-62` 删 dynamicRiskOverride

**问题**：`dynamicRiskOverride` 把 `script.edit_script + search_and_replace` 降级为 `'read'`，注释自述「内容匹配、非破坏性（CRLF 安全）」——此假设已被 RCE 链证伪（能写盘任意内容含 class_name 注入）。

**修复**：
- 删除 `dynamicRiskOverride` 函数（`:54-62`）
- `requiresConfirmation`（`:64-69`）简化为 `const risk = getActionRisk(toolName, action)`，去掉 `dynamicRiskOverride(...) ??` 调用
- edit_script（含 search_and_replace 模式）恢复整体 `'write'` risk（`script.ts:1061` TOOL_META 声明），正常触发确认令牌

**影响面**：search_and_replace 模式的 edit_script 调用现在需要确认令牌。这是安全设计本意——任何写盘操作都应经确认。

### 修复点 2：`src\tools\scene\index.ts:228` create_scene 补 ^[A-Za-z0-9_]+$ 校验

**问题**：create_scene 的 `root_node_type` 无校验直接透传 Godot。

**修复**：在 `scene/index.ts:226-229` 的 create_scene 分支，对 `root_node_type` 补 `^[A-Za-z0-9_]+$` 校验（与 `add_node:141` / `batch_add_nodes:315` / `quick_scene:257` 完全一致）。

```ts
if (action === 'create_scene') {
  const rootNodeType = String(args.root_node_type || 'Node2D');
  if (!/^[A-Za-z0-9_]+$/.test(rootNodeType)) {
    releaseShortRunningSlot();
    return textResult(`Error: root_node_type contains invalid characters: "${rootNodeType}"`);
  }
  params.scene_path = normalizeUserProjectPath(args.scene_path as string);
  params.root_node_type = rootNodeType;
  if (args.root_node_name) params.root_node_name = args.root_node_name;
}
```

注意：`releaseShortRunningSlot()` 在 case 入口 `:220` 已 acquire，校验失败须先 release（与 `:232` new_path 校验失败的 `releaseShortRunningSlot()` 模式一致）。

### 修复点 3：`src\scripts\godot_operations.gd:177-179` 脚本分支补 is_parent_class 对称检查

**问题**：脚本分支 `script.new()` 无校验，ClassDB 分支有 `is_parent_class("Node")`。

**修复**：在 `script is GDScript` 后、`script.new()` 前补基类检查：

```gdscript
var script = get_script_by_name(name_of_class)
if script is GDScript:
	# IMPORTANT-13 闭环: 脚本分支补对称检查（与 ClassDB 分支 :166 一致）
	# get_instance_base_type() 返回脚本 extends 的基类名（如 "Node2D"/"Control"）
	var base_type := script.get_instance_base_type()
	if base_type.is_empty() or not ClassDB.is_parent_class(base_type, "Node"):
		log_error(String("Refused: script class %s base type %s is not a Node subclass") % [name_of_class, base_type])
		return null
	return script.new()
```

**合法用法不受影响**：用户自定义脚本 `class_name X` `extends Node2D` / `extends Control` / `extends Node` 都能通过（get_instance_base_type 返 "Node2D"/"Control"/"Node"，都是 Node 子类）。

## 验收标准

1. `guard.ts` 删除 `dynamicRiskOverride` 后，`requiresConfirmation('script', {action:'edit_script', search_and_replace:{search:'x'}})` 返回 `true`
2. `scene/index.ts` create_scene 收 `root_node_type="Foo; rm -rf /"` 返回字符校验错误
3. `godot_operations.gd` 脚本分支收 `root_node_type="NonNodeScript"`（extends RefCounted 的脚本）返回 null + 错误日志
4. 合法路径不回归：`edit_script search_and_replace` 正常用法（带确认令牌）、`create_scene root_node_type="Node2D"`、`create_scene root_node_type="MyNodeScript"`（extends Node2D 的脚本 class_name）都正常工作
5. 全量测试绿（vitest + tsc + lint + check:gdscript）

## 测试计划（TDD）

- **RED**：先写 3 个失败测试断言当前漏洞
  - guard.test.ts：search_and_replace 模式 requiresConfirmation 返 true（当前返 false）
  - scene 工具测试：create_scene 收非法字符返错误（当前透传）
  - GDScript 侧通过 check:gdscript 验证语法（脚本分支校验逻辑无单测框架，靠 GDScript 编译+集成验证）
- **GREEN**：实施 3 处修复让测试通过
- **回归**：全量 vitest + 确认既有 edit_script/create_scene 测试不回归

## 不修的项

- `ensureClassNameImport` 自动 import 注册 class_name 本身是合法功能（write_script 也用），不删——根源在 guard 降级绕确认
- `get_script_by_name` 查全局 class 注册表本身合法——根源在 instantiate_class 脚本分支无 Node 校验
- 不改 quick_scene（TS 直接写 .tscn，已有 `:257` 校验，无 RCE 面）

## 影响文件

- `src\guard.ts`（删函数 + 简化 requiresConfirmation）
- `src\tools\scene\index.ts`（create_scene 分支加校验）
- `src\scripts\godot_operations.gd`（脚本分支加 is_parent_class）
- 测试文件若干（guard.test / scene-tools.test）
- `test\regression\defects.ts`（登记新 defect + baseline bump）
