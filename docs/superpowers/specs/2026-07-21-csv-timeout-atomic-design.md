# csv_to_resources 超时残留修复设计（P2-1）

> 日期：2026-07-21
> 状态：设计待审
> 关联：核实见 `D:\workspace\Obsidian\GodotMCP\开发日志\2026-07-21 P2 核实（csv 残留真+completion 误报）.md`

## 背景

P2-1（核实结论：真问题 IMPORTANT）：`csv_to_resources` 在写入 .tres 时若 60s 超时（Godot 进程被 kill），产生两类残留：
1. **完整但意外 .tres**（kill 前已 save 成功的若干行）——filename 碰撞，重跑覆盖语义混乱
2. **半截损坏 .tres**（kill 落在某次 save 中途）——Godot 启动 `ResourceLoader` 扫 res:// parse error，**可能阻塞整个项目加载**

根因（源码核实）：
- timeout 60 硬编码 `src/tools/data-import.ts:336`（schema 无 timeout 字段）
- 超时 kill `src/gdscript-executor.ts:1201` 只清 sessionDir（临时脚本），不动 output_dir .tres
- GDScript `ResourceSaver.save`（`data-import.ts:175`）直写目标 full_path，无原子提交
- handler finally（`data-import.ts:329-364`）只清 CSV，无 .tres 回滚

## 目标

- **核心**：超时 kill 不产半截损坏 .tres（消除阻塞项目加载风险）
- **附带**：timeout 可配（大批量 CSV 调大减少触发）
- **非目标**（YAGNI）：handler 事务回滚、分页导入

## 架构（4 处改动）

| # | 文件 | 改动 | 职责 |
|---|------|------|------|
| A | `src/tools/data-import.ts` GDScript 模板 | save 循环改 tmp+rename + 脚本开头清 .tmp | 原子提交 |
| B | `src/tools/data-import.ts` handler :336 | timeout 改 `args.timeout ?? 60` | 可配 |
| C | csv_to_resources schema | 加可选 timeout 字段（default 60） | DX |
| D | `test/regression/defects.ts` | 登记 detect 闭包 | 防复发 |

## 详细设计

### A. GDScript 原子提交（核心）

**A.1 脚本开头清 .tmp 残留**（mkdir 守卫后、CSV 循环前）

清上次 kill 留在 output_dir 的 `.tres.tmp`（半截无害但占空间，堆积影响）：

```gdscript
var clean_dir = DirAccess.open(_output_dir)
if clean_dir:
    clean_dir.list_dir_begin()
    var clean_fn = clean_dir.get_next()
    while clean_fn != "":
        if clean_fn.ends_with(".tres.tmp"):
            clean_dir.remove(clean_fn)
        clean_fn = clean_dir.get_next()
    clean_dir.list_dir_end()
```

范围：仅 output_dir 顶层（csv_to_resources 只写顶层 .tres，不递归）。

**A.2 save 循环改 tmp+rename**（`data-import.ts:173-180`）

```gdscript
var full_path: String = _output_dir + "/" + filename + ".tres"
var tmp_path: String = full_path + ".tmp"
var save_err: int = ResourceSaver.save(res, tmp_path)
if save_err != OK:
    _errors.append({"row": _row_count, "value": filename, "reason": "save failed: " + str(save_err)})
    _failed += 1
    continue
var rename_err: int = DirAccess.rename_absolute(tmp_path, full_path)
if rename_err != OK:
    DirAccess.remove_absolute(tmp_path)
    _errors.append({"row": _row_count, "value": filename, "reason": "rename failed: " + str(rename_err)})
    _failed += 1
    continue
_generated.append(full_path)
```

**原子性论证**：
- kill 落在 `save(res, tmp_path)` 中途 → tmp_path 半截，full_path 保持旧版本（或不存在）→ **full_path 不损**
- kill 落在 `rename_absolute` 之后 → full_path 已是新完整版本
- kill 落在 save 与 rename 之间 → tmp_path 完整但未 rename，full_path 旧 → 不损
- 所有 kill 时刻：**full_path 永不半截** → Godot ResourceLoader 不 parse error → 不阻塞加载

**rename 覆盖策略**：
- 主路径：`DirAccess.rename_absolute` 原子覆盖已存在（Godot 4.x：Windows `MoveFileExW(MOVEFILE_REPLACE_EXISTING)` / POSIX `rename()`，同文件系统原子）
- plan 实现时**实测验证** 4.6.2 + 4.7 覆盖行为
- 降级（若某版本不覆盖）：`if file_exists(full_path): remove(full_path)` 再 `rename`。remove+rename 间窗口 full_path 不存在，kill 仍不产半截（损失旧文件但不阻塞加载），可接受

### B. handler timeout 可配（`data-import.ts:332-338`）

```ts
const r = await executeGdscript({
    godotPath: godot,
    projectPath,
    code: script,
    timeout: args.timeout ?? 60,
    loadAutoloads: false,
});
```

### C. schema 可选 timeout

csv_to_resources 工具 schema 加：

```ts
timeout: {
    type: 'number',
    optional: true,
    default: 60,
    description: 'GDScript 执行超时秒数（大批量 CSV 可调大，默认 60）'
}
```

handler 须从 args 取 timeout（确认 args 解析路径，与现有 filenameCol/outputDir 同层）。

### D. defects.ts 登记

数据导入段（`test/regression/defects.ts:334-377` 附近）加 FIXED detect 闭包（修复后 detect=0 防复发）：

```ts
{ key: 'csv-import-timeout-no-atomic-write', status: 'fixed', severity: 'IMPORTANT', dimension: 'Reliability',
    // P2-1(2026-07-21 核实): ResourceSaver.save 直写目标,超时 kill 产半截损坏 .tres 阻塞项目加载。
    // 修复:tmp+rename 原子提交(DirAccess.rename_absolute)。detect 查 tmp_path + rename_absolute 模式存在。
    detect: () => {
        const f = readSrc('src/tools/data-import.ts');
        const hasTmp = /var\s+tmp_path\s*:\s*String\s*=\s*full_path\s*\+\s*"\.tmp"/.test(f);
        const hasRename = /DirAccess\.rename_absolute\(\s*tmp_path\s*,\s*full_path/.test(f);
        return hasTmp && hasRename ? 0 : 1;
    } },
```

detect 查 tmp_path 赋值 + rename_absolute 调用（删任一 → detect=1 复发）。

## 错误处理

| 场景 | 行为 |
|------|------|
| save(tmp) 失败 | 记 error + failed + continue（无 full_path 残留，tmp 未生成） |
| rename 失败 | 清 tmp + 记 error + failed + continue（full_path 旧不损） |
| 超时 kill | .tmp 残留（下次调用 A.1 清），full_path 不半截 |
| 用户调大 timeout | 减少超时触发 |

## 测试策略

1. **TS handler timeout 透传**（`test/tools/data-import.test.ts`）：mock executeGdscript，断言：
   - 不传 timeout → 收到 60（默认）
   - 传 timeout=120 → 收到 120
2. **GDScript 模板含原子模式**（静态断言）：generateImportScript 输出含 `tmp_path` + `rename_absolute` + `.tres.tmp` 清理（防模式回归）
3. **defects.ts detect**：detect 闭包返回 0（模式存在），删除模式返回 1（防复发验证）
4. **回归**：现有 data-import.test.ts 全绿（tmp+rename 不变成功路径语义，_generated/errors/stats 输出不变）

> 注：headless 真跑 Godot 中途 kill 难控（timer 60s 不可靠复现），不写"真超时残留"端到端测试。改测逻辑分支（handler timeout 透传 + GDScript 模板静态断言 + detect 防复发）。原子性的信心来自 DirAccess.rename_absolute 的 OS 级语义 + plan 实现时 4.6.2/4.7 覆盖行为实测。

## 验收标准

- [ ] GDScript 模板含 tmp_path + rename_absolute 原子提交
- [ ] 脚本开头清 .tres.tmp 残留
- [ ] handler timeout 可配（args.timeout ?? 60）
- [ ] schema 含可选 timeout 字段（default 60）
- [ ] defects.ts 登记 csv-import-timeout-no-atomic-write（FIXED，detect=0）
- [ ] tsc 0 error
- [ ] vitest 全量绿（含新增测试）
- [ ] 现有 data-import 测试无回归
- [ ] Godot 4.6.2 + 4.7 DirAccess.rename_absolute 覆盖行为实测（或降级 remove+rename）

## YAGNI 边界

- **不加 handler 事务回滚**（方案 2）：方案 1 原子性在 GDScript 侧，Node 崩溃也防半截；handler 回滚仅"可恢复失败"时生效，边际价值
- **不加分页导入**（方案 3b）：复杂度高，timeout 可配 + 残留无害已够
- **.tmp 清理不递归**：csv 只写顶层
- **不加 .tmp 清理的独立工具**：嵌入 csv_to_resources 脚本开头足够（每次调用自清）

## 关联

- 核实日志：`D:\workspace\Obsidian\GodotMCP\开发日志\2026-07-21 P2 核实（csv 残留真+completion 误报）.md`
- 原始 SDD（未含超时回滚）：`docs/superpowers/specs/2026-07-01-csv-to-resource-design.md`
- 数据导入 defects 段：`test/regression/defects.ts:334-377`
