# 第三方审查:TileSet 碰撞配置两 op(feat/tileset-collision-ops)

> **审查对象**:`D:\GitHub\godot-mcp-series\godot-mcp-enhanced` 分支 `feat/tileset-collision-ops`
> **审查时 HEAD**:8f9cf00(feat)+ 36fbd22(release);Nit 处置追加 4844a73
> **审查者**:code-reviewer 子代理(独立上下文,不预设实现者声明为真,全部结论 grep/read 实测)
> **审查日期**:2026-08-19
> **依据 spec**:`D:\workspace\Obsidian\GodotMCP\系统文档\可行性评估-TileSet碰撞配置工具-2026-08-18.md`

## 总体判定:SHIPPED WITH NITS(无 Blocking Issue)

## 改动清单

| commit | 内容 |
|---|---|
| 8f9cf00 | feat: `tileset_physics_layer_add` + `tile_collision_set` 两 op(生成器 + handler 安全校验 + schema + 测试) |
| 36fbd22 | chore(release): 0.32.7 版本链 + matrix + tool-docs + CHANGELOG/README |
| 4844a73 | test: 审查 Nit-1/2/4 处置 |

- `src/tools/scene/scene-commit.ts`:COMMIT_OPERATIONS 7→9、validateOpFields 两 case(needResPath/optBool)、generateOpBlock 两 case、collectTilesetPaths、save 分支扩展(`_save_resource` helper,仅有碰撞 op 时生成)
- `src/tools/scene/scene-commit-tool.ts`:handler 层已存在 `.tres` 的 resolveWithinRoot realpath 纵深校验
- `src/tools/scene/index.ts`:scene 工具 schema operations enum/新字段
- `test/scene-commit.test.ts` +25 用例;`test/tools/scene-commit-tileset-ops.test.ts` 新建 6 用例

## 逐维度结论(审查者实测证据摘要)

### 1. 设计正确性 — 通过
- 嵌套缩进逐 tab 人工展开核验(physics_layer_add 1→2 层;collision_set 1→2→3→4 层 elif 链 + td 守卫 else)全部对齐;stopOnError=false 时 errAction 退化为注释但块体仍有 append 语句,语法成立。
- 守卫链顺序正确:资源→source→TileSetAtlasSource→has_tile→physics_layer 越界→TileData null,越界检查先于写操作。
- layer_id = 添加前 `get_physics_layers_count()`,即新层索引,语义正确。
- save 分支:场景失败后仍逐 tileset 尝试保存(独立资源),err last-error-wins 不被后续成功覆盖;`"success": err == OK` 绑定。
- **纯节点 commit 生成物零变化**:`tilesetSaveBlock`/`saveResHelper` 均以 `save && tilesetPaths.length > 0` 为条件,有测试锁定。

### 2. TS-GD 一致性 — 通过
- 真实 schema(index.ts)与生成器行为逐项一致;DEPRECATED 副本 enum 完全同步(描述措辞 Nit-2 已处置);capability-matrix.json 取的是 index.ts 真实 schema。

### 3. 测试质量 — 通过
- **%2e%2e 用例真判别**(审查者推演):删掉 handler 校验则该测试红(浅校验只查明文 `..`,编码形态放行;handler resolveWithinRoot iterativeDecode 拦截)。
- existsSync mock 按路径定制,不误伤其它守卫;"不存在放行"用例真实走透传路径并断言生成脚本内容。
- dedup 用例正则锁定 save 数组字面量仅一次。

### 4. 部署同步/仓库级约束(AGENTS.md 独立核查)— 通过
- rule-templates.ts 仅 :759 一处非穷举列举提及 scene_commit,双副本一致,无需同步(Nit-6 不改)。
- capability-matrix json/md 与源一致(43 工具 v0.32.7);gen:tool-docs 43 文件含 scene.md 新 enum。
- 版本链四处一致(0.32.7);check:gdscript 不适用判断成立(改动无 .gd 文件;碰撞 GD 代码是运行时生成模板)。

### 5. 验证完整性 — 声明可信
- build 产物实测同步;端到端声明(正向/负向/幂等/重载断言)无法复跑(产物已清理),但生成代码引用的全部引擎 API 签名与 Godot 4 实际一致 + 缩进人工核验,采信。
- 实现者声明"+20 用例"实测 +25(Nit-5,多不少写)。

### 6. 安全 — 通过,三层拦截成立
- 生成器层(res:// 前缀 + 明文 .. 段 + 类型校验堵 `${}` 注入 + escapeForGdLiteral 字符串转义)→ handler 层(已存在 .tres 的 realpath 纵深,UNC/设备名/URL 解码/symlink 全拦)→ GD 侧(res:// 语义限项目内 + load null 不进 ResourceSaver)。
- 不存在路径放行理由成立:无覆写面。TOCTOU 为本地 MCP 已接受风险(注释明示)。

## Blocking Issues

无。

## Nits 与处置

| # | 问题 | 处置 |
|---|---|---|
| 1 | tile_collision_set 的 handler realpath 分支缺 %2e%2e 专属用例(原用例被浅校验拦截) | ✅ 已修(4844a73):补文件存在形态用例 |
| 2 | DEPRECATED 副本 tileset_path 描述缺"限 res:// 项目内"限定语 | ✅ 已修(4844a73) |
| 3 | physics_layer 允许非整数浮点(GD 截断但上报原值) | 不改:与既有 tile op(coords/atlas)语义一致,非本次引入 |
| 4 | stopOnError=false 部分失败写盘语义未文档化 | ✅ 已修(4844a73):schema stop_on_error 描述补写 |
| 5 | 用例计数声明 +20 实为 +25 | 不改:记录声明精度 |
| 6 | rule-templates.ts:759 非穷举列举未提新 op | 不改:双副本一致、CI 不拦、语境非穷举 |

## 工程教训(已登 memory)

1. **端到端验证产物不留痕 = 审查不可复核**:COMMIT_RESULT 原文已清理,第三方只能退到 API 签名比对 + 人工核验。后续 scene_commit 类新 op 的端到端证据应归档 docs/reviews/。
2. **"浅校验放行 + realpath 纵深"双层模式的负向测试必须构造字面形态真实存在的文件**(如字面 `%2e%2e` 目录),否则 existsSync=false 走放行分支,handler 校验零执行,测试退化为只测浅校验——判别"接线零验证"的关键手法。
3. **运行时生成 GD 代码的改动,check:gdscript 门禁天然不覆盖**(无 .gd 文件),语法正确性只能靠真实 Godot 执行或逐缩进人工核验——本类改动验证清单应默认含一次真实执行。本次端到端抓出两处文档与实现偏差(PackedVector2Array 只收 Array;has_tile 实收 1 参),单测字符串断言均无法发现。

## 最终验证(合并门禁,主会话实测)

```
npm run lint        → 0 错误
npm run build       → 0 TS 错误
npm test            → 5826 passed / 0 failed(全量,Nit 修复前)+ 76/76(commit 相关,Nit 修复后)
node scripts/check-tool-count.mjs → 24 处口径全过(matrix version=0.32.7)
npm run version-check → 版本元数据一致(0.32.7)
npm run check:budget → 3 既有 warn(engine/game/ui 描述长度,历史遗留)/ 0 error
端到端 Godot 4.6.3   → 正向/负向/幂等/重载断言全过(详见上文;证据链留痕改进见教训 1)
```
