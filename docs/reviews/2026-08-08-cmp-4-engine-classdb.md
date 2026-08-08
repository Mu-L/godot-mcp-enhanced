# CMP-4 实时 ClassDB 内省 — 第三方审查报告

> **审查日期**: 2026-08-08
> **判定**: 初次 BLOCKING(2 issues) → 修复后 SHIPPED

## 总体判定: SHIPPED

初次审查发现 2 个 BLOCKING：
- **B-1**: engine（和 debug）未注册到 TOOL_GROUPS → isToolAllowed 恒 false → 工具完全不可用
- **B-2**: _type_name Variant.Type 映射 off-by-two（漏 Projection(19)）

两者都已修复。修复后重跑验证全绿。

## B-1 BLOCKING: TOOL_GROUPS 缺 engine + debug → 工具不可用 — ✅ 已修
- 根因：module-loader 注册了但 TOOL_GROUPS 没加 → isToolAllowed 恒 false
- 修复：TOOL_GROUPS 加 `debug: { requires: ['editor'] }` + `engine: { requires: ['editor'] }`
- 同时修了 CMP-3 的 debug（同样缺组，审查发现 CMP-3 也遗漏了）
- 更新 tool-groups.test.js 断言 20→22 组

## B-2 BLOCKING: _type_name 映射 off-by-two — ✅ 已修
- 根因：手写 Variant.Type 枚举表漏 Projection(19)，致 19+ 全部错位
- 修复：补 Projection(19)，从 19 开始顺移（Color=20, StringName=21, ... PackedVector4Array=38）
- 新增 CMP-4j 契约测试验证关键映射值（Projection=19, Color=20, PackedColorArray=37, PackedVector4Array=38）

## 验证证据(修复后实跑)
```
npm run lint: 0 error
npm run build: 0 error
npm test: 4595 passed / 0 failed (316 test files)
npm run check:gdscript: errors=0 / warnings=0
npm run check:tool-count: 40 tools / 220 actions / 20 处通过
npm run version-check: ✓ 0.25.11
check-rules-version-bump: ✓ version bumped
```

## memory 教训
1. **module-loader 注册 ≠ TOOL_GROUPS 注册**：新增工具只改 4 处注册会漏 TOOL_GROUPS，致 isToolAllowed 恒 false。D1 缺陷(asset/android)已教训一次，CMP-3/CMP-4(debug/engine)第三次重蹈。建议加通用 invariant 检测。
2. **手维护的枚举映射表易 off-by-N**：应优先用引擎内置 type_string() 或加连续性契约测试。
