// test/risk-coverage.test.ts
// 覆盖完整性测试 — 根除漏标的运行期硬约束
// 验证每个工具的每个 action 都在 actionRisks 中声明了风险等级

import { describe, it, expect } from 'vitest';
import { registerAllModules } from '../src/core/module-loader.js';
import { getAllToolDefinitions, getActionRisks } from '../src/core/tool-registry.js';

// 注册所有工具模块（必须在测试前执行）
registerAllModules();

/** 从 inputSchema.action.enum 提取某工具全部 action 名 */
function extractActions(toolName: string): string[] {
  const def = getAllToolDefinitions().find(t => t.name === toolName);
  const enumArr = (def?.inputSchema as any)?.properties?.action?.enum;
  return Array.isArray(enumArr) ? enumArr : [];
}

describe('actionRisks 覆盖完整性（根除漏标）', () => {
  const toolNames = getAllToolDefinitions().map(t => t.name);

  for (const tool of toolNames) {
    const actions = extractActions(tool);

    // 跳过没有 action enum 的工具（如 static工具或无 action 参数的工具）
    if (actions.length === 0) continue;

    it(`${tool}: 每个 action 都声明了 risk`, () => {
      const risks = getActionRisks(tool);

      // 验证该工具已声明 actionRisks
      expect(risks, `${tool} 未声明 actionRisks`).toBeDefined();

      // 检测未在 actionRisks 中声明的 action（遗漏标注）
      const missing = actions.filter(a => !(a in (risks ?? {})));

      expect(missing, `${tool} 漏标 risk 的 action: ${missing.join(', ')}`).toEqual([]);
    });
  }
});
