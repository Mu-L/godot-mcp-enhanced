// src/core/action-gate.ts — P0-3 Action 级 Capability Gate
//
// 默认 gate RCE 面 action（execute_gdscript / execute_bpy），通过 env opt-in。
// 与 profile（工具级编译时）和 manage_tools（工具级运行时）互补：
//   profile 决定哪些工具注册 → manage_tools 决定哪些工具可调 → action-gate 决定哪些 action 可执行
//
// 接入点：ToolDispatcher.executeToolCall 入口（isToolAllowed 之后）。
// tools/list 不变（工具仍可见），仅 gated action 调用时返回 ACTION_GATED。

/**
 * GATED_ACTIONS：group → action key 列表（"工具名.action名"）。
 *
 * 组名必须准确描述威胁面（参考 breakpoint 1.28.0 教训：删除了误导性的 network 组）。
 * 新增组时需逐个核对 action 实际能力，避免 over-blocking。
 */
const GATED_ACTIONS: Record<string, string[]> = {
  // 任意代码执行：GDScript 沙箱（enhanced 防误操作层，非不可绕过）+ bpy 全功能 Python RCE
  // 注意：key 格式 `<工具名>.<action>`，工具名必须是 tool-registry 里实际承载该 action 的工具名。
  // execute_gdscript action 实际挂在 `script` 工具（src/tools/script.ts）而非 `runtime`，
  // 早期版本误写 'runtime.execute_gdscript' 致 gate 永不命中（2026-08-06 审查 P0 修复）。
  'code-execution': [
    'script.execute_gdscript',
    'blender.execute_bpy',
    // P1 (2026-08-11 审查): debug.evaluate 发任意 GDScript expression 到游戏进程执行
    // (expression 可含 OS.execute/load/eval/file IO),与 execute_gdscript 等价 RCE 面。
    // 原 action-gate 漏配 + debug.ts 标 read + GD 侧无沙箱 = 三层防护全缺。此为第一层(opt-in gate)。
    'debug.evaluate',
  ],
};

const ALL_GATED = new Set(Object.values(GATED_ACTIONS).flat());

/** 反查：action key → group name */
function findGroupForAction(actionKey: string): string | undefined {
  for (const [group, actions] of Object.entries(GATED_ACTIONS)) {
    if (actions.includes(actionKey)) return group;
  }
  return undefined;
}

/** 该 action 是否被 gate 登记（无论是否 enabled） */
export function isActionGated(toolName: string, action: string): boolean {
  return ALL_GATED.has(`${toolName}.${action}`);
}

/** 该 action 是否允许执行（gated 且未 opt-in 时返回 false） */
export function isActionAllowed(
  toolName: string,
  action: string,
  enabledGroups: string[],
): boolean {
  const key = `${toolName}.${action}`;
  if (!ALL_GATED.has(key)) return true; // 未登记 = 放行
  const group = findGroupForAction(key);
  if (!group) return true; // 不应发生（ALL_GATED 与 GATED_ACTIONS 同源），防御性
  return enabledGroups.includes(group) || enabledGroups.includes('all');
}

/**
 * 解析当前启用的特权组。
 *
 * 优先级：GODOT_MCP_PRIVILEGED_GROUPS env（逗号分隔组名，或 'all' 全开）。
 * 未设 env 时返回空数组（所有 gated action 被拦截）。
 */
export function resolveEnabledGroups(): string[] {
  const env = process.env.GODOT_MCP_PRIVILEGED_GROUPS;
  if (env === 'all') return ['all', ...Object.keys(GATED_ACTIONS)];
  if (env) return env.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

/**
 * 获取 gate 状态（供 godot://capabilities 资源展示）。
 * 返回每个组的 actions 列表 + enabled 状态。
 */
export function getGateStatus(): Record<string, { actions: string[]; enabled: boolean; source: string }> {
  const enabled = resolveEnabledGroups();
  const source = process.env.GODOT_MCP_PRIVILEGED_GROUPS ? 'env (GODOT_MCP_PRIVILEGED_GROUPS)' : 'default (all gated)';
  const result: Record<string, { actions: string[]; enabled: boolean; source: string }> = {};
  for (const [group, actions] of Object.entries(GATED_ACTIONS)) {
    result[group] = {
      actions,
      enabled: enabled.includes(group) || enabled.includes('all'),
      source,
    };
  }
  return result;
}
