# editor 路由打通后 add_node/edit_node 三个 follow-up(A 档验证发现)

**日期**:2026-07-20
**来源**:`D:\workspace\projects\CardGame2`(Godot 4.7 + godot-mcp-enhanced addon 整目录同步至 HEAD `f75ce95`)A 档 edit_node editor 路由端到端验证。验证 `835c780`(editor-method-map 登记 edit_node/batch_add_nodes)打通 editor 路由、修复 30s 超时**生效**(edit_node 即时返 + 内存改不落盘,2 判据铁证),过程暴露 3 个 editor 路由 follow-up。
**结论**:editor 路由核心修复(`835c780`/`c24db3f`/`64b18d9`/`c926748`/`0dfc29d`/`1d08a16`)已验证生效;3 个 follow-up 均有绕过,但首用体验差,建议改进。

**🔔 2026-07-20 回标更新**:F1/F2/F3 全部 🟢 实跑验证通过(CardGame2 editor 路由,`_mcp_test_en.tscn`)——F1 fixed `17066d9`、F2 docs `1db3b42`、F3 fixed `5386ff8`。CardGame2 addon 已 cp 同步并 commit(`8084d5f`)。详见下方📌状态区。

---

## ✅ 正向确认:edit_node 30s 超时已修复(editor 路径)

| 判据 | 结果 | 证据 |
|------|------|------|
| 不超时 | ✅ | editor 模式 `scene edit_node`(Sprite2D TestRect 设 `texture=res://assets/ui/u_empty.png`)即时返 `{updated:1, failed:[]}`,无 30s timeout(修前稳定超时) |
| 走 editor 内存改 | ✅ | edit_node 后 `.tscn` mtime 未变、文件无 texture 行/无 `[ext_resource]` → 走 `64b18d9` handle_edit_node 内存改,非 headless fallback |

**前提**:CardGame2 addon 源码级 diff=0(仅 `.uid` 副产物)+ build 重建含 editor-method-map(`build/core/editor-method-map.js` mtime 2026-07-20 18:32 > `835c780`)。

**根因链**:`835c780` editor-method-map 登记 edit_node → editor 模式不再经 `-32601` fallback 到 headless 的 `gdScriptSetLine`(`src/tools/scene/helpers.ts:36-51`,对资源类型生成字面赋值 `node.texture = "res://..."` 触发引擎隐式处理阻塞 30s)→ 走 editor `handle_edit_node` 内存改 → 不超时。

---

## 🟡 中(有绕过但首用易踩,editor/headless 不一致)

| # | 工具 | 问题 | 影响 | 建议 |
|---|------|------|------|------|
| F1 | `add_node` | `parent_node_path` 默认 `"root"` 在 **editor 路由失效**(工具默认值直接报错) | editor 模式首用必踩:`add_node node_type=X parent="root"` 返 `Parent not found: root`;须查源码才发现传 `""` | editor handler `parent_node_path=="root"` 识别为 `ei.get_edited_scene_root()`;或工具层 editor 路由把默认 `"root"` 规范为空串;或错误信息注明"editor 路由 parent 传空串表示场景根" |
| F2 | `add_node`/`edit_node` | **忽略 scene_path**,操作编辑器活动场景 | editor 活动场景 ≠ scene_path 时,parent 找不到/改错场景;须先 `open_scene` 切活动场景 | 文档明确"editor 路由操作活动场景,scene_path 仅 headless 生效";或 editor handler 校验 `scene_path != active_scene` 时报错(而非默默操作活动场景) |

## 🟢 轻(by design,错误信息可优化)

| # | 工具 | 问题 | 回退 | 建议 |
|---|------|------|------|------|
| F3 | `add_node` | 白名单 `ALLOWED_NODE_TYPES` 不含 Control 子类(TextureRect 等 block) | 换 Sprite2D(texture 属性等价)或 `ui_create_control` | 错误信息"Blocked node type: TextureRect"补"Control 类请用 ui_create_control" |

---

## 🔬 源码核查(file:line)

| # | 精确根因 | 证据 |
|---|---------|------|
| **F1** | editor handler `parent_node_path` 非空时 `root.get_node_or_null(parent_path)`,`"root"` 在 root 的**子节点**里找名为 "root" 的(root 不是自己的子节点)→ 找不到。headless 路径按名搜整树能找到 "root" → editor/headless 不一致 | `addons/godot_mcp_server/commands/node_commands.gd:48-56`(`var parent_node = root` / 非空 `root.get_node_or_null(parent_path)` / null 返 `Parent not found`) |
| **F2** | editor handler 取 `ei.get_edited_scene_root()`(编辑器活动场景根),`scene_path` 参数未参与定位 | `addons/godot_mcp_server/commands/node_commands.gd:32`(`var root = ei.get_edited_scene_root()`) |
| **F3** | `ALLOWED_NODE_TYPES` I-4 严格白名单(精确匹配,注释明示"不用 is_parent_class 兜底"),不含 Control 子类(Control 类走 `ui_create_control`) | `addons/godot_mcp_server/commands/node_commands.gd:6-15`(白名单)/ `:261-265`(`_is_allowed_node_type`)/ `commands/ui_commands.gd:14`(注释"Control 类须与 TS 端 ui_create_control 29 种同步") |

---

## 🔄 复现步骤(CardGame2 / Godot 4.7 / editor 模式)

前置:editor connected,编辑器打开**任意非测试场景**(如 equipboard_content.tscn)。

```
# 1. create_scene 走 headless 建文件(正常)
scene create_scene scene_path=res://scenes/_test.tscn root_node_type=Control

# 2. add_node TextureRect → F3 白名单 block
scene add_node scene_path=res://scenes/_test.tscn parent=root node_type=TextureRect node_name=T
# 返 {error:"Blocked node type: TextureRect", code:-32004}

# 3. 换 Sprite2D + 默认 parent="root" → F1 parent 失效 + F2 scene_path 被忽略(操作 equipboard 根=EquipboardContent)
scene add_node scene_path=res://scenes/_test.tscn parent=root node_type=Sprite2D node_name=T
# 返 {error:"Parent not found: root", code:-32002}

# 4. open_scene 切活动场景到测试场景
scene open_scene scene_path=res://scenes/_test.tscn  # {status:opened}

# 5. 再 add_node parent=root → 仍 F1(root 不是自己的子节点)
scene add_node scene_path=res://scenes/_test.tscn parent=root node_type=Sprite2D node_name=T
# 返 {error:"Parent not found: root", code:-32002}

# 6. 绕过 F1:parent_node_path="" → 成功
scene add_node scene_path=res://scenes/_test.tscn parent="" node_type=Sprite2D node_name=T
# {status:created, node_path:.../root/T}

# 7. edit_node 设 texture(正向:不超时 + 内存改,验证 30s 超时修复)
scene edit_node scene_path=res://scenes/_test.tscn node_path=T properties={texture:res://assets/ui/u_empty.png}
# {updated:1, failed:[]}  ← edit_node 30s 超时已修复
# .tscn 文件未变(mtime/内容)← 走 editor 内存改,非 headless 落盘
```

---

## 📌 状态

- **F1**:🟢 fixed commit `17066d9`(handle_add_node 改用 CommandHelpers.find_node 识别 parent "root",对齐 edit_node/batch/headless)。实跑验证(2026-07-20,CardGame2 editor 路由,`_mcp_test_en.tscn`):`add_node parent_node_path=root node_type=Sprite2D node_name=F1Test` → `{status:created, node_path:.../root/F1Test}`(修前报 `Parent not found: root`)。
- **F2**:🟢 closed commit `1db3b42`(docs 注明 editor 路由操作活动场景,scene_path 仅 headless 生效)。实跑验证:全程 `scene_path=_mcp_test_en.tscn` 但操作落在编辑器活动场景(`get_scene_tree` 确认根=root/TestRect),行为与文档一致,无歧义。
- **F3**:🟢 fixed commit `5386ff8`(add_node/batch_add_nodes 白名单 block 错误信息补 ui_create_control 提示)。实跑验证:add_node TextureRect → `Blocked node type: TextureRect. Control 类(TextureRect/Button 等)请用 ui_create_control 工具`(`code:-32004`);batch TextureRect → `nodes[0].node_type blocked: TextureRect. Control 类...请用 ui_create_control`(含 `nodes[0]` 索引前缀 + ui_create_control 提示,两点都中)。
- **edit_node 30s 超时**:🟢 fixed(`835c780`/`64b18d9`/`f35a3ef`/`69fcd2e`,editor 路径已端到端验证)。
- **未覆盖**:headless 路径(`f35a3ef`/`69fcd2e`)未单独验证(editor 连接态无法切 headless);save_scene 持久化链路、batch_add_nodes 资源绑定未验证。
- **相关**:`docs/review-2026-07-06-gdscript-undo-lifecycle.md`(editor undo lifecycle)、`docs/review-2026-07-06-ipc-reliability.md`(IPC 可靠性)。
- **使用侧反馈**(跨项目积累):`D:\workspace\Obsidian\GodotMCP\插件反馈与改进建议.md`(scene 工具分区,2026-07-20 回标)。
