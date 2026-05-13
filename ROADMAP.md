---
title: godot-mcp-enhanced 发展路线图
date: 2026-05-13
project: godot-mcp-enhanced
status: active
---

# 发展路线图

## v0.8.0 已完成（2026-05-13）

基于 [v0.8.0 设计文档](docs/superpowers/specs/2026-05-13-v080-feature-upgrade-design.md)，共 96 个工具。

### P1 — 双模式架构

- [x] Editor WebSocket JSON-RPC 2.0 连接（EditorConnection + EditorToolExecutor）
- [x] GDScript 编辑器插件（command_handler + 7 个命令模块）
- [x] UndoManager 撤销栈支持
- [x] install 命令（安装插件 autoload）

### P2 — 测试框架 + 导出管理

- [x] test_assert — 场景树断言（node_exists / property_equals / signal_connected / node_count）
- [x] test_stress — 压力测试（内存泄漏检测）
- [x] export_list_presets — 列出导出预设
- [x] export_get_preset — 获取导出预设详情
- [x] export_build — 执行导出构建

### P3 — 高级工具集

- [x] 粒子系统（5 工具）：create / set_emission / set_process / load_preset / set_material
- [x] 导航系统（5 工具）：create_region / bake_mesh / create_agent / set_params / create_link
- [x] AnimationTree（5 工具）：create / add_state / add_transition / set_blend / play
- [x] 同步 GDScript 编辑器命令（particle_commands / nav_commands / animtree_commands）

---

## 之前版本已完成

### v0.7.0（2026-05-08）— 安全加固 + 代码质量

- [x] 输入转义（防止 .tscn 注入）
- [x] 超时泄漏修复
- [x] 代码去重（helpers.ts 提取公共函数）
- [x] 类型安全（any → unknown）
- [x] 安全 ID 生成（crypto.randomUUID）
- [x] Game Bridge 清理
- [x] tscn-parser 键冲突修复
- [x] 工具描述国际化

### v0.6.0（2026-05-03）— 音频 + TileMap

- [x] 4 个音频播放控制工具
- [x] 8 个 TileMap 编辑工具

### v0.5.0（2026-05-02）— 运行时操作

- [x] 信号控制（connect / disconnect / emit / list）
- [x] 物理查询（raycast / body_info）
- [x] 3D 节点创建（16 种白名单类型）
- [x] 导航寻路

### v0.4.0（2026-05-01）— 验证增强

- [x] 版本不一致检测
- [x] 脚本预检查
- [x] validate_scripts 独立工具
- [x] search_and_replace 编辑模式
- [x] 截图稳定性改进

### v0.3.0 — 编辑 + 批量

- [x] edit_script（行范围 + 搜索替换）
- [x] batch_add_nodes
- [x] validate_project
- [x] import_resources

### v0.2.0 — 场景 + 脚本

- [x] read_scene（.tscn 解析）
- [x] read_script / write_script
- [x] query_scene_tree / inspect_node
- [x] MCP Resources（godot:// URI）

### v0.1.0 — 基础功能

- [x] 项目管理（list/get/list_files/config）
- [x] 场景操作（create/add_node/save/load_sprite）
- [x] 执行控制（launch/run/stop/debug_output）
- [x] 截图
- [x] execute_gdscript
- [x] API 文档查询
