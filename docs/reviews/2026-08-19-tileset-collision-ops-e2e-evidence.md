# TileSet 配置 op 端到端证据归档(Godot 4.6.3,2026-08-19)

> 审查教训 1 落实(2026-08-19 首批审查):端到端产物不留痕导致审查不可复核。本文归档第二批(层配置扩展批)与第一批(碰撞两 op)的 COMMIT_RESULT 原文与重载断言输出。
> 环境:`Godot_v4.6.3-stable_win64.exe --headless`;生成脚本由 `build/tools/scene/scene-commit.js` 真实产物生成(非手写)。

## 第一批:碰撞两 op(2026-08-19 上午,当时 HEAD 8f9cf00)

### commit1(正向:physics add + rect/polygon 碰撞 + one_way)

```
COMMIT_RESULT: {"results":[{"layer_id":0,"ok":true,"op":"tileset_physics_layer_add","tileset_path":"res://assets/tiles.tres"},{"ok":true,"op":"tile_collision_set","physics_layer":0,"points_count":4,"tileset_path":"res://assets/tiles.tres"},{"ok":true,"op":"tile_collision_set","physics_layer":0,"points_count":3,"tileset_path":"res://assets/tiles.tres"}],"saved":true,"success":true}
```

重载断言:

```
V_layers=1
V_clayer=1
V_cmask=3
V_rect_polys=1
V_rect_pts=[(0.0, 0.0), (16.0, 0.0), (16.0, 16.0), (0.0, 16.0)]
V_poly_polys=1
V_poly_pts=[(0.0, 0.0), (16.0, 0.0), (8.0, 12.0)]
V_oneway=true
V_tilesize=(16, 16)
```

### commit2(负向 + 幂等,stopOnError=false)

```
COMMIT_RESULT: {"results":[{"layer_id":1,"ok":true,"op":"tileset_physics_layer_add",...},{"error":"Tile (9, 9) not in atlas","ok":false,"op":"tile_collision_set",...},{"error":"physics_layer 99 out of range","ok":false,"op":"tile_collision_set",...}],"saved":true,"success":true}
```

重载:`V_layers=2`(幂等累加)、`V_rect_pts` 保持(负向 op 不破坏已有数据)。

## 第二批:层配置扩展批(9 资源 op 全链)

### commit-ext(11 op 序列:双 physics add → nav add → cdata add → 双 collision set → nav set → cdata set → physics set → collision clear → physics remove)

```
COMMIT_RESULT: {"results":[{"layer_id":0,"ok":true,"op":"tileset_physics_layer_add","tileset_path":"res://assets/tiles.tres"},{"layer_id":1,"ok":true,"op":"tileset_physics_layer_add","tileset_path":"res://assets/tiles.tres"},{"layer_id":0,"ok":true,"op":"tileset_navigation_layer_add","tileset_path":"res://assets/tiles.tres"},{"layer_id":0,"name":"damage","ok":true,"op":"tileset_custom_data_layer_add","tileset_path":"res://assets/tiles.tres"},{"ok":true,"op":"tile_collision_set","physics_layer":0,"points_count":4,"tileset_path":"res://assets/tiles.tres"},{"ok":true,"op":"tile_collision_set","physics_layer":0,"points_count":4,"tileset_path":"res://assets/tiles.tres"},{"navigation_layer":0,"ok":true,"op":"tile_navigation_set","points_count":4,"tileset_path":"res://assets/tiles.tres"},{"layer":0,"ok":true,"op":"tile_custom_data_set","tileset_path":"res://assets/tiles.tres"},{"layer":0,"ok":true,"op":"tileset_physics_layer_set","tileset_path":"res://assets/tiles.tres"},{"ok":true,"op":"tile_collision_clear","physics_layer":0,"tileset_path":"res://assets/tiles.tres"},{"layer":1,"ok":true,"op":"tileset_physics_layer_remove","tileset_path":"res://assets/tiles.tres"}],"saved":true,"success":true}
```

### 重载断言(12 项)

```
V_phys_layers=1          # 2 add − 1 remove
V_phys_clayer=1          # add 时设的 layer 位掩码未被 physics_layer_set(仅 mask)覆盖
V_phys_cmask=5           # physics_layer_set 修改生效
V_nav_layers=1
V_nav_layers_value=2     # navigation_layer_add layers=2 落盘
V_cdata_layers=1
V_cdata_name=damage
V_collision_t0_polys=1
V_collision_t0_pts=[(0.0, 0.0), (16.0, 0.0), (16.0, 16.0), (0.0, 16.0)]
V_collision_t1_polys=0   # collision_clear 生效
V_nav_poly=[(0.0, 0.0), (16.0, 0.0), (16.0, 16.0), (0.0, 16.0)]   # NavigationPolygon vertices 读回
V_cdata_value=12.5
```

### commit-neg(负向,stopOnError=false)

```
COMMIT_RESULT: {"results":[{"error":"navigation_layer 99 out of range","ok":false,"op":"tile_navigation_set",...},{"error":"Tile (9, 9) not in atlas","ok":false,"op":"tile_custom_data_set",...},{"error":"physics_layer 42 out of range","ok":false,"op":"tileset_physics_layer_remove",...}],"saved":true,"success":true}
```

三类越界/缺瓦片全部结构化报错,进程正常退出不崩溃。

### commit-n2(审查 N-2 修复验证:非 TileSet 资源 + 缺失资源)

```
COMMIT_RESULT: {"results":[{"error":"Resource is not a TileSet","ok":false,"op":"tileset_physics_layer_add","tileset_path":"res://scenes/Level.tscn"},{"error":"TileSet resource not found","ok":false,"op":"tileset_physics_layer_add","tileset_path":"res://assets/missing.tres"}],"saved":true,"success":true}
```

- `tileset_path` 指向 `.tscn`(load 返回 PackedScene,非 null 非 TileSet)→ `is TileSet` 守卫结构化报错(修复前:对 PackedScene 调 `get_physics_layers_count()` 运行时崩溃,无 COMMIT_RESULT)。
- 无 loader 的资源(如 `.txt`)与缺失路径一样走 `TileSet resource not found`(load 返回 null)。

## 引擎 API 实测注记(文档 vs 实现偏差)

| API | 文档声明 | 4.6.3 实测 |
|---|---|---|
| `PackedVector2Array(...)` 构造器 | —(直觉可变参) | 只接受 Array;可变参形式 Parse Error |
| `TileSetAtlasSource.has_tile` | `has_tile(coords, alternative_tile=0)` | 只接受 1 参 |
| `TileSetAtlasSource.create_tile` | `create_tile(coords, size=16x16)` | 显式传 size 报 "outside the texture"(省略则成功;seed 基建踩坑) |
| 新项目首次 headless 运行 | — | 首次 spawn 时 ResourceSaver 失败(import 竞态),第二次正常;生产路径不受影响(项目已 import) |
