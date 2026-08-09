// src/skills/skill-builder.ts
// 从 rule-templates.ts 的 workflow 模板派生 Claude Code SKILL.md（仓库自身开发用）
// 单一内容源 = DETAILED_RULE_TEMPLATES 的 3 个 workflow 模板；改 workflow 只改 rule-templates.ts
// 然后跑 npm run build:skills 重生成 .claude/skills/<name>/SKILL.md

import { DETAILED_RULE_TEMPLATES } from '../tools/rule-templates.js';

/** workflow 模板 key → skill name 映射（去 workflow- 中缀，verify 特例 -loop） */
export const WORKFLOW_TO_SKILL: Record<string, string> = {
  'godot-mcp-workflow-bridge-e2e.md': 'godot-mcp-bridge-e2e',
  'godot-mcp-workflow-verify.md': 'godot-mcp-verify-loop',
  'godot-mcp-workflow-safe-edit.md': 'godot-mcp-safe-edit',
};

// ─── Tier2-1: 手写 skill（非派生）──────────────────────────────────────────
// 借鉴 mattpocock 路由器/原语 + emilkowalski advisor-worker，性质非 workflow，
// 走手写路径不套 workflow 模板。所有 skill 保持 model-invoked（不加 disable-model-invocation，
// 因 Claude Code 该 flag 有已知 bug issue #43809/#77740，可能完全不可用）。

const GODOT_ROUTER_SKILL = `---
name: godot-router
description: "godot-mcp skill 路由器 不确定用哪个流程 入口匝道 决策树 E2E 安全编辑 验证闭环 动画审计 —— 当你不确定该用哪个 godot-mcp 流程、或需要把任务分发到具体子流程时使用。简单单工具操作(改单行/单次截图)不要用本 skill,直接调工具"
---

## godot-mcp 流程路由

本 skill 是 godot-mcp skill 体系的路由器。当你不确定该用哪个流程时,按以下决策树分发。

**何时用**:用户请求模糊(如"帮我改场景""验证一下"),或一个任务跨多个 skill 时。

**主流程(想法 → 可交付)**:
- [ ] 1. 改代码/场景 → 先 screenshot-verify 留证,再 godot-mcp-safe-edit 编辑,收尾 godot-mcp-verify-loop 验证
- [ ] 2. 不确定怎么改 → 用 game 工具的 game_query action 读真实运行时值,不要纸面猜
- [ ] 3. 批量建节点/文件 → 走 godot-mcp-safe-edit 的 batch 路径

**入口匝道(按任务类型分流)**:
- [ ] E2E 测试 / 模拟输入 / 回归测试 → \`godot-mcp-bridge-e2e\`
- [ ] 动画/动效不对劲(卡顿/无弹性/方向反)→ \`godot-tween-taste\`
- [ ] 视觉验证(操作前后截图对比)→ \`screenshot-verify\`
- [ ] 安全编辑(.gd/.tscn 改动)→ \`godot-mcp-safe-edit\`
- [ ] 交付前自检 → \`godot-mcp-verify-loop\`

**何时不用 skill**:
- 改单行 .gd → 直接 \`edit_script\`
- 只读探索(看场景结构)→ 直接 \`read_scene\` / \`game_query\`
- 单次截图 → 直接 \`screenshot\`

**常见偏离**:
- 每个操作都走路由器(过度:简单操作直接调工具,路由器只在不确定时用)
- 路由后不验证(漏:即使路由器分发,收尾仍需 verify-loop 或 screenshot-verify)`;

const SCREENSHOT_VERIFY_SKILL = `---
name: screenshot-verify
description: "视觉验证闭环 截图对比 操作前后留证 take_screenshot frame-verify runtime_assert screenshot_diff 渲染退化 GPU viewport headless 空白检测 —— 当你做了会影响视觉的操作、需要确认渲染结果、或怀疑渲染退化时使用"
---

## 视觉验证闭环(操作前后留证)

本 skill 是视觉验证原语,其他 skill 可 reach。核心原则:任何影响视觉的操作,操作前后都截图留证,对比确认。

**何时用**:做了会影响视觉的操作(改场景树/材质/动画/UI)、需要确认渲染结果、怀疑渲染退化(headless 空白/GPU 丢失)。

**checklist**:
- [ ] 1. \`screenshot(action=capture)\` — 操作前截图(基线留证,记 imagePath)
- [ ] 2. 执行变更操作(edit_script / add_node / 材质修改等)
- [ ] 3. \`screenshot(action=capture)\` — 操作后截图(同 viewport 同节点)
- [ ] 4. \`screenshot(action=analyze, detail=thumbnail)\` — 分别 analyze 操作前/后两张图(thumbnail 省 token),人工或 AI 对比差异
- [ ] 5. 若需断言:\`runtime_assert(action=screenshot_diff, reference=<基线路径>, threshold=0.85)\`(注:screenshot_diff 当前为 NOT_IMPLEMENTED 占位,真实相似度对比待实现,见 runtime-assert.ts)
- [ ] 6. headless 模式警告:若 fileSize < 2048 或 BLANK_DETECTED,改用 bridge take_screenshot(GPU viewport)

**常见偏离**:
- 只截操作后不截操作前(漏基线,无法对比退化)
- headless 空白当 bug 报(误:headless RendererDummy 无 GPU 渲染,2D/3D 均空白是已知限制,非 bug)
- 用 screenshot(action=analyze, detail=full) 对比(token 浪费:thumbnail 足够看差异,full 只在需细节时用)`;

const GODOT_TWEEN_TASTE_SKILL = `---
name: godot-tween-taste
description: "Tween 动效品味审计 create_tween tween_property set_trans set_ease TRANS 类型 Ease 方向 时长 弹性 卡顿 方向反 只读不改 自包含修复计划 advisor —— 当你用 Tweener、Tween 动效不对劲(卡顿/无弹性/方向反)、或需要审计 Tween 品质时使用。改单行 Tween 值用 edit_script 即可"
---

## Tween 动效品味审计(advisor-worker 模式)

本 skill 是 advisor(只读不改源码),扫描 Tween 调用按品味审计,产出自包含修复计划给 worker 执行。借鉴 emilkowalski improve-animations 的 4 Phase 工作流。

**何时用**:Tween 动效"不对劲"(卡顿/无弹性/方向反/生硬)、批量审计 Tween 品质、用 Tweener 时想确认 TRANS/Ease 选择合理。

**Phase 1 — Recon(只读,摸清 Tween 地图)**:
- [ ] 1. \`read_scene\` + grep \`create_tween|tween_property|set_trans|set_ease\` 找所有 Tween 调用
- [ ] 2. 记录每处:file:line + TRANS 类型 + Ease 方向 + 时长 + 目标属性

**Phase 2 — Audit(按 7 类审计,只返回 file:line + evidence)**:
- [ ] 3. TRANS_LINEAR 用于 UI 动画(生硬,应换 TRANS_SINE/QUAD)
- [ ] 4. Ease 缺失(默认 ease_in_out 可能不对,UI 进场应用 ease_out)
- [ ] 5. 时长 < 0.1s(太快看不清)或 > 1.0s(太慢拖沓)
- [ ] 6. parallel() 缺失(多 Tween 应并行但串行跑了)
- [ ] 7. Tween 未 kill(场景切换后泄漏,应 connect tree_exited)

**Phase 3 — Vet & prioritize(剔除误判)**:
- [ ] 8. 重读每条 finding,剔除 by-design(如 LoadingScreen 故意用 LINEAR)
- [ ] 9. 按 leverage 排序(影响用户体验大的优先)

**Phase 4 — Write plans(自包含修复计划)**:
- [ ] 10. 每条 finding 写一个 plan,内联精确值(如"TRANS_LINEAR → TRANS_SINE,Ease In → Ease Out,0.05s → 0.3s")
- [ ] 11. plan 交接给 worker(任何 agent),按 plan 用 edit_script 逐条修

**常见偏离**:
- advisor 直接改源码(越界:advisor 只读,改是 worker 的事)
- plan 写模糊指令(漂移:必须内联精确值,不允许"用更柔和的 easing")
- 把 by-design 当 bug 报(噪声:先 Vet 剔除故意的妥协)`;

/**
 * 手写 skill（非派生）。key = skill name，value = 完整 SKILL.md 内容（含 frontmatter）。
 * Tier2-1: 性质非 workflow（路由器/原语/advisor），走手写路径不套 workflow 模板。
 */
export const HANDWRITTEN_SKILLS: Map<string, string> = new Map([
  ['godot-router', GODOT_ROUTER_SKILL],
  ['screenshot-verify', SCREENSHOT_VERIFY_SKILL],
  ['godot-tween-taste', GODOT_TWEEN_TASTE_SKILL],
]);

/**
 * 从单个 workflow 模板派生 SKILL.md 内容（纯函数）。
 *
 * 派生规则：
 * 1. 剥 rule frontmatter（首部 ---\n...\n---\n，含 description + alwaysApply）
 * 2. 提取 description 引号内纯文本（rule-templates.ts 的 description 形如 description: "..."）
 * 3. 剃到首个 ## 标题前的所有内容（版本引用行 > 适用于 ... {{MCP_VERSION}}+ + 紧随空行）
 * 4. 组装 SKILL.md：---\nname: <skillName>\ndescription: "<纯文本>"\n---\n\n<正文从 ## 起>
 *    （description 重新包双引号；正文不加 H1，从 rule 的 H2 起）
 */
export function deriveSkillFromWorkflow(tpl: string, skillName: string): string {
  // 1. 剥 rule frontmatter
  const fmMatch = tpl.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) throw new Error(`skill-builder: ${skillName} 的 workflow 模板缺 rule frontmatter (---...---)`);
  const frontmatter = fmMatch[1]!;
  const afterFm = tpl.slice(fmMatch[0].length);

  // 2. 提取 description 引号内纯文本
  const descMatch = frontmatter.match(/^description:\s*"([\s\S]*?)"\s*$/m);
  if (!descMatch) throw new Error(`skill-builder: ${skillName} 的 workflow frontmatter 缺 description (带引号)`);
  const description = descMatch[1]!;

  // 3. 剃到首个 ## 前（版本引用行 + 空行）
  const h2Idx = afterFm.search(/^##\s/m);
  if (h2Idx === -1) throw new Error(`skill-builder: ${skillName} 的 workflow 模板缺 ## 标题`);
  const body = afterFm.slice(h2Idx);

  // 4. 组装（description 重新包引号，不加 H1）
  return `---\nname: ${skillName}\ndescription: "${description}"\n---\n\n${body}`;
}

/** 遍历所有 skill（派生 + 手写），返回 skill name → SKILL.md 内容。 */
export function buildAllSkills(): Map<string, string> {
  const result = new Map<string, string>();
  // 派生 skill（现有 3 个，从 rule-templates.ts workflow 模板派生）
  for (const [workflowKey, skillName] of Object.entries(WORKFLOW_TO_SKILL)) {
    const tpl = DETAILED_RULE_TEMPLATES[workflowKey];
    if (!tpl) throw new Error(`skill-builder: DETAILED_RULE_TEMPLATES 缺 workflow 模板 ${workflowKey}`);
    result.set(skillName, deriveSkillFromWorkflow(tpl, skillName));
  }
  // 手写 skill（Tier2-1 新增 3 个：路由器/原语/advisor）
  for (const [name, content] of HANDWRITTEN_SKILLS) {
    result.set(name, content);
  }
  return result;
}
