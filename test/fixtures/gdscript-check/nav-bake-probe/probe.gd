extends SceneTree

# C4 Task 0 BLOCKING 核实 probe
# 测 spec §12 核实项 0（bake 执行模型）/1（返回值）/3（is_baking 属性）/4（bake_finished 信号）
# 用法: godot --headless --script probe.gd

func _init():
	var nav = NavigationRegion3D.new()
	var mesh = NavigationMesh.new()
	nav.navigation_mesh = mesh

	# 核实项 4: bake_finished 信号存在性
	print("HAS_BAKE_FINISHED_SIGNAL=%s" % nav.has_signal("bake_finished"))

	# 核实项 3: is_baking / baking 类属性（调用前）
	var _props_before = []
	for prop in nav.get_property_list():
		var n: String = prop.get("name", "")
		if n in ["is_baking", "baking", "is_baked", "bake"]:
			_props_before.append("%s=%s" % [n, str(nav.get(n))])
	print("BAKING_PROPS_BEFORE=%s" % str(_props_before))

	# 核实项 1（返回值类型）+ 核实项 0（同步阻塞 vs 立即返回，时间差）
	# 注意：bake_navigation_mesh() 返回 void（双版本编译器拒赋值），不可 await 返回值
	var t0 = Time.get_ticks_usec()
	nav.bake_navigation_mesh()
	var t1 = Time.get_ticks_usec()
	print("BAKE_RET=void")
	print("BAKE_DELTA_USEC=%d" % (t1 - t0))

	# 核实项 3 续: 调用后再查 baking 属性
	var _props_after = []
	for prop in nav.get_property_list():
		var n: String = prop.get("name", "")
		if n in ["is_baking", "baking"]:
			_props_after.append("%s=%s" % [n, str(nav.get(n))])
	print("BAKING_PROPS_AFTER=%s" % str(_props_after))

	# 核实 mesh 是否有内容（bake 是否真发生）
	var vmesh = nav.navigation_mesh
	if vmesh != null:
		print("AFTER_BAKE_VERTICES=%d" % vmesh.get_vertices_count())
	else:
		print("AFTER_BAKE_VERTICES=null")

	print("PROBE_DONE")
	quit()
