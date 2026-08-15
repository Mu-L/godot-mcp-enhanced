extends Node

# H-1 e2e-debug-tools 断点目标脚本(批 H 2026-08-15)。
#
# 设计目标:e2e 测试(test/e2e-debug-tools.test.ts)经 editor 设断点 → play 本场景
# → 游戏每帧进 hot_func → 断点持续命中(continue 后下一帧再次 break,供 A2 互斥
# 用例复用同一局游戏)。脚本刻意极简 + 行号稳定:e2e 按 `# BREAKPOINT` 标记行
# 动态定位断点行号(零硬编码漂移)。
#
# 断点行必须是"保证有 opcode 的语句行"(if 分支行;var 声明行实测无稳定 opcode,
# 断点不命中 —— 批 H 调试过程踩坑记录)。勿改动本文件行布局。

var ticks := 0


func _process(_delta: float) -> void:
	ticks += 1
	hot_func()


func hot_func() -> void:
	var answer := 40 + 2
	if answer == 42:  # BREAKPOINT: e2e 断点设此行(1-based,按标记动态定位)
		pass  # non-trivial body so the if-branch compiles to real opcodes
