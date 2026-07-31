// test/core/module-loader-slim.test.ts
// P2-12: slimSchema pass 直接单测（补 docs/reviews/2026-07-31-coverage-batch.md N-2 缺口）。
//
// 背景：slimSchema（src/core/module-loader.ts:191-224）在 registerAllModules 链路对超阈值
// 工具瘦身——移除 action 专属参数、追加 description 提示。此前零直接单测；ui-tools.test.js
// 直 import barrel 绕过 registerAllModules 后处理，读的是未 slim 的原始 schema，slim 回归无测试捕获。
//
// 本测试经 registry 查询 API 取 def（走 registerAllModules 包装的 getToolDefinitions），
// 验证 slim 真在链路生效 + 全部分支行为正确。
import { describe, it, expect } from 'vitest';
import { registerAllModules } from '../../src/core/module-loader.js';
import { getToolDefinition } from '../../src/core/tool-registry.js';
// 直 import barrel —— 用于路径隔离断言（证明 registry 路径与 barrel 路径产出不同）
import { getToolDefinitions as getUiDefsDirect } from '../../src/tools/ui-tools.js';

const SLIM_THRESHOLD_BYTES = 8000; // module-loader.ts:170
// 代表性 removeProps（完整列表见 module-loader.ts:178-182，此处取每类一个做存在性断言）
const REMOVED_REPRESENTATIVE = ['theme_action', 'theme_create_action', 'tree', 'ops'] as const;

describe('slimSchema pass（P2-11，超阈值工具瘦身）', () => {
  it('ui 经 registry 后 properties 不含 removeProps（newProperties 分支）', () => {
    registerAllModules();
    const ui = getToolDefinition('ui');
    expect(ui, 'ui tool 应注册').toBeDefined();
    const props = Object.keys(ui!.inputSchema.properties ?? {});
    for (const removed of REMOVED_REPRESENTATIVE) {
      expect(
        props,
        `${removed} 应被 slim 移除，剩余 props: ${props.join(', ')}`
      ).not.toContain(removed);
    }
  });

  it('ui description 追加 descHint（def.description + config.descHint）', () => {
    registerAllModules();
    const ui = getToolDefinition('ui');
    expect(ui!.description).toContain('专属参数(additionalProperties)');
  });

  it('ui inputSchema 字节数 < SLIM_THRESHOLD_BYTES（瘦身触发条件反向验证）', () => {
    registerAllModules();
    const ui = getToolDefinition('ui');
    const schemaBytes = Buffer.byteLength(JSON.stringify(ui!.inputSchema), 'utf8');
    expect(
      schemaBytes,
      `瘦身未生效：schema ${schemaBytes}B ≥ 阈值 ${SLIM_THRESHOLD_BYTES}B`
    ).toBeLessThan(SLIM_THRESHOLD_BYTES);
  });

  it('ui inputSchema 结构完整：type/required 保留，required 引用的 prop 未被删', () => {
    // review N-2 安全点：required 与 removeProps 无交集，不会产"required 引用已删 prop"非法 schema
    registerAllModules();
    const ui = getToolDefinition('ui');
    const schema = ui!.inputSchema as { type?: string; required?: string[]; properties?: Record<string, unknown> };
    expect(schema.type, 'type 字段保留').toBe('object');
    expect(schema.required, 'required 字段保留').toEqual(['action']);
    // action 是 required 唯一项，必须仍在 properties 里
    expect(schema.properties, 'action 仍在 properties（未被误删）').toHaveProperty('action');
  });

  it('未配置 SLIM_CONFIG 的工具（scene）不被 slim（!config return def 分支）', () => {
    registerAllModules();
    const scene = getToolDefinition('scene');
    expect(scene, 'scene tool 应注册').toBeDefined();
    // scene 未配 SLIM_CONFIG → description 无 slim hint
    expect(scene!.description).not.toContain('专属参数(additionalProperties)');
    // properties 完整（非空，未被移除）
    expect(Object.keys(scene!.inputSchema.properties ?? {}).length, 'scene properties 完整').toBeGreaterThan(5);
  });
});

describe('slim 路径隔离（防回归：直 import barrel 绕过 registerAllModules 后处理）', () => {
  it('经 registry 的 ui def 比 直 import barrel 的 props 少（证明 slim 真在链路生效）', () => {
    registerAllModules();
    const uiViaRegistry = getToolDefinition('ui');
    const uiViaBarrel = getUiDefsDirect().find(d => d.name === 'ui');
    expect(uiViaBarrel, 'barrel 应导出 ui').toBeDefined();

    const registryProps = Object.keys(uiViaRegistry!.inputSchema.properties ?? {});
    const barrelProps = Object.keys(uiViaBarrel!.inputSchema.properties ?? {});

    // barrel 路径未经 slim，props 应更多
    expect(
      barrelProps.length,
      `barrel props ${barrelProps.length} 应多于 registry props ${registryProps.length}（否则 slim 未生效）`
    ).toBeGreaterThan(registryProps.length);
    // barrel 仍含被 slim 移除的 prop（对照点）
    expect(barrelProps).toContain('theme_action');
    expect(registryProps).not.toContain('theme_action');
  });
});
