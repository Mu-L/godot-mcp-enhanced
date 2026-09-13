// test/core/module-loader-slim.test.ts
// P2-12: slimSchema pass 直接单测（补 docs/reviews/2026-07-31-coverage-batch.md N-2 缺口）。
// P8-3 (2026-09-12) 语义反转: SLIM_CONFIG ui 条目移除——P8-2 unknown-param 拒绝上线后
// "从 properties 移除但 handler 仍读"的 additionalProperties 约定失效,schema 不撒谎是
// SSOT 防线前提。机制(空配置)保留作应急通道;本文件断言 P8 语义:ui 全键、无 slim hint、
// registry 与 barrel 路径一致,slimSchema 对无配置工具原样返回。
import type { Tool } from "@modelcontextprotocol/server";

import { describe, it, expect } from 'vitest';
import { registerAllModules, slimSchema, SLIM_THRESHOLD_BYTES, SLIM_CONFIG } from '../../src/module-loader.js';
import { getToolDefinition } from '../../src/core/tool-registry.js';
// 直 import barrel —— 用于路径一致性断言
import { getToolDefinitions as getUiDefsDirect } from '../../src/tools/ui-tools.js';

// P8-3 前曾属 removeProps 的代表性键（P2-11 完整列表），现应全部在 schema 里
const KEPT_REPRESENTATIVE = ['theme_action', 'theme_create_action', 'tree', 'ops'] as const;

describe('slimSchema pass（P8-3 语义反转后：SLIM_CONFIG 空,ui 全键）', () => {
  it('SLIM_CONFIG 无 ui 条目（P8-3 移除,机制保留为空配置）', () => {
    expect(SLIM_CONFIG['ui']).toBeUndefined();
  });

  it('ui 经 registry 后 properties 含全部结构键（theme/tree/ops 不再被砍）', () => {
    registerAllModules();
    const ui = getToolDefinition('ui');
    expect(ui, 'ui tool 应注册').toBeDefined();
    const props = Object.keys(ui!.inputSchema.properties ?? {});
    for (const kept of KEPT_REPRESENTATIVE) {
      expect(
        props,
        `${kept} 应在 schema 里（P8-3: schema 是参数 SSOT,键不可砍;剩余 props: ${props.join(', ')}`
      ).toContain(kept);
    }
    expect(props.length, 'ui schema 恢复 39 键').toBeGreaterThanOrEqual(39);
  });

  it('ui description 不再追加 additionalProperties 提示（slim hint 随条目移除消失）', () => {
    registerAllModules();
    const ui = getToolDefinition('ui');
    expect(ui!.description).not.toContain('专属参数(additionalProperties)');
  });

  it('ui inputSchema 超 SLIM_THRESHOLD_BYTES 也不再瘦身（无配置则原样返回）', () => {
    registerAllModules();
    const ui = getToolDefinition('ui');
    const schemaBytes = Buffer.byteLength(JSON.stringify(ui!.inputSchema), 'utf8');
    // P8-3 后瘦身触发条件是"超阈值 **且** 有 SLIM_CONFIG 条目";ui 无条目 → 即使超阈值也不砍
    expect(
      schemaBytes,
      'ui schema 字节数（预期超阈值——键不可砍,瘦身改走源描述人工压缩）'
    ).toBeGreaterThanOrEqual(SLIM_THRESHOLD_BYTES);
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

describe('slim 路径一致性（P8-3 后：registry 与 barrel 产出一致）', () => {
  it('经 registry 的 ui def 与 直 import barrel 的 props 相同（slim 不再改 ui）', () => {
    registerAllModules();
    const uiViaRegistry = getToolDefinition('ui');
    const uiViaBarrel = getUiDefsDirect().find(d => d.name === 'ui');
    expect(uiViaBarrel, 'barrel 应导出 ui').toBeDefined();

    const registryProps = Object.keys(uiViaRegistry!.inputSchema.properties ?? {});
    const barrelProps = Object.keys(uiViaBarrel!.inputSchema.properties ?? {});

    // P2-11 时代 slim 只发生在 registry 路径（barrel 直 import 绕过后处理）→ 两路径 props 不同;
    // P8-3 移除 ui 条目后两路径一致——若未来恢复 slim,此断言红是第一道防线
    expect(registryProps.length, '两路径 props 数一致（slim 对 ui 不生效）').toBe(barrelProps.length);
    expect(registryProps).toContain('theme_action');
    expect(barrelProps).toContain('theme_action');
  });
});

describe('slimSchema 无配置分支（P8-3 后 SLIM_CONFIG 恒空,config 分支不可达）', () => {
  it('无 SLIM_CONFIG 条目 + 超阈值 → 原样返回（!config return def）', () => {
    // 构造 fake def 超阈值 schema,slimSchema 应原样返回（P8-3 后 SLIM_CONFIG 空,
    // 所有工具都走此分支;removed.length===0 的 dead path 随空配置一并不可达）
    const padding = 'x'.repeat(SLIM_THRESHOLD_BYTES);
    const fakeDef: Tool = {
      name: 'ui',
      description: 'fake',
      inputSchema: {
        type: 'object' as const,
        properties: {
          action: { type: 'string' },
          someUnrelatedProp: { type: 'string', description: padding },
        },
        required: ['action'],
      },
    };
    const result = slimSchema([fakeDef]);
    expect(result).toHaveLength(1);
    expect(result[0].description, '未追加 descHint（无配置走原样返回）').toBe('fake');
    expect(
      Object.keys(result[0].inputSchema.properties ?? {}),
      'properties 不变（未删除任何 prop）'
    ).toEqual(['action', 'someUnrelatedProp']);
  });
});
