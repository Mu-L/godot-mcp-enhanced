---
name: screenshot-verify
description: "视觉验证闭环 截图对比 操作前后留证 take_screenshot frame-verify runtime_assert screenshot_diff 渲染退化 GPU viewport headless 空白检测 —— 当你做了会影响视觉的操作、需要确认渲染结果、或怀疑渲染退化时使用"
---

## 视觉验证闭环(操作前后留证)

本 skill 是视觉验证原语,其他 skill 可 reach。核心原则:任何影响视觉的操作,操作前后都截图留证,对比确认。

**何时用**:做了会影响视觉的操作(改场景树/材质/动画/UI)、需要确认渲染结果、怀疑渲染退化(headless 空白/GPU 丢失)。

**checklist**:
- [ ] 1. `screenshot(action=capture)` — 操作前截图(基线留证,记 imagePath)
- [ ] 2. 执行变更操作(edit_script / add_node / 材质修改等)
- [ ] 3. `screenshot(action=capture)` — 操作后截图(同 viewport 同节点)
- [ ] 4. `screenshot(action=analyze, detail=thumbnail)` — 分别 analyze 操作前/后两张图(thumbnail 省 token),人工或 AI 对比差异
- [ ] 5. 若需断言:`runtime_assert(action=screenshot_diff, reference=<基线路径>, threshold=0.85)`(注:screenshot_diff 当前为 NOT_IMPLEMENTED 占位,真实相似度对比待实现,见 runtime-assert.ts)
- [ ] 6. headless 模式警告:若 fileSize < 2048 或 BLANK_DETECTED,改用 bridge take_screenshot(GPU viewport)

**常见偏离**:
- 只截操作后不截操作前(漏基线,无法对比退化)
- headless 空白当 bug 报(误:headless RendererDummy 无 GPU 渲染,2D/3D 均空白是已知限制,非 bug)
- 用 screenshot(action=analyze, detail=full) 对比(token 浪费:thumbnail 足够看差异,full 只在需细节时用)