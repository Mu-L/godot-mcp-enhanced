# risk 字段化迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `guard.ts` 硬编码 `GUARDED`（86 个 action 跨 17 个工具键）迁移为 `ToolMeta.actionRisks`（action 级、就近声明），`requiresConfirmation` 按字段判定确认，根除"新增工具/改 action 漏标记"痛点。

**Architecture:** `ToolMeta` 扩展 `actionRisks: Record<string, RiskLevel>` + `RiskLevel` 四级（read/write/destructive/process）；`guard.requiresConfirmation` 改查 `actionRisks`（保留 `search_and_replace` 动态豁免）；`capability-matrix` 从 `actionRisks` 派生 `guarded` + risk 分布。迁移期 guard 不变，所有工具声明完 `actionRisks` 后一次性切换 + 删 `GUARDED`，保证零行为改变。

**Tech Stack:** TypeScript，`@modelcontextprotocol/sdk ^1.29.0`，vitest

## Global Constraints

- `RiskLevel = 'read' | 'write' | 'destructive' | 'process'`
- **确认行为零改变**：迁移前后 `requiresConfirmation(tool, action)` 对每个组合结果必须一致
- `process` 语义 = 启动外部进程 **或** 任意代码/方法执行（`execute_gdscript`/`call_method` RPC/`run_project`/`launch_editor` 等）
- 本 plan 全部改 `.ts`，不涉及 `.gd`（`.gd` 才用 MCP `edit_script`）
- 测试 vitest，命令 `npx vitest run <path>`；全量 `npm test`
- commit 到 master 本地，**不 push**（项目惯例）
- 类型约束 `Record<typeof ACTIONS[number], RiskLevel>` 全 17 工具覆盖（5 个工具需先补齐 `ACTIONS` 常量）

## File Structure

| 文件 | 职责 | 改动类型 |
|------|------|----------|
| `src/core/tool-registry.ts` | `RiskLevel` 类型、`ToolMeta.actionRisks`、`registerModule` readonly 派生、`getActionRisks`/`getActionRisk` 查询 | Modify |
| `src/guard.ts` | 删 `GUARDED`、`dynamicRiskOverride`、`requiresConfirmation`/`isGuardedTool` 改查 actionRisks | Modify |
| `src/tools/animation/animation-ops.ts` `material-ops.ts` `android.ts` `workflow.ts` `manage-tools.ts` | inline enum → `const ACTIONS` 常量 | Modify（补齐） |
| 17 个工具模块 `TOOL_META` | 加 `actionRisks` 完整字面量 | Modify |
| `src/capability/extract.ts` | `guarded` 从 actionRisks 派生（底层） | Modify |
| `src/capability/build-matrix.ts` | risk 四级分布 + trusted-nonread 标记 | Modify |
| `test/guard.test.ts` | 行为对照 + 动态豁免 | Modify |
| `test/risk-coverage.test.ts` | 覆盖完整性测试（新建） | Create |

---

## Task 1: ToolMeta 扩展 + RiskLevel + 查询函数

**Files:**
- Modify: `src/core/tool-registry.ts`
- Test: `test/core/tool-registry.test.ts`（若无则在最近 test 目录新建）

**Interfaces:**
- Produces: `RiskLevel` 类型、`ToolMeta.actionRisks` 字段、`getActionRisks(toolName): Record<string,RiskLevel> | undefined`、`getActionRisk(toolName, action): RiskLevel | undefined`、`registerModule` 的 readonly 派生

- [ ] **Step 1: 写失败测试**

新建 `test/core/tool-registry.test.ts`：
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { registerModule, clearRegistry, getActionRisk, getActionRisks, getToolMeta } from '../../src/core/tool-registry.js';

describe('ToolMeta actionRisks', () => {
  beforeEach(() => clearRegistry());

  it('派生 readonly：全 read → readonly=true', () => {
    registerModule({
      getToolDefinitions: () => [],
      handleTool: async () => null,
      TOOL_META: { demo: { actionRisks: { query: 'read', list: 'read' } } },
    });
    expect(getToolMeta('demo')?.readonly).toBe(true);
  });

  it('派生 readonly：含非 read → readonly=false', () => {
    registerModule({
      getToolDefinitions: () => [],
      handleTool: async () => null,
      TOOL_META: { demo: { actionRisks: { query: 'read', write: 'write' } } },
    });
    expect(getToolMeta('demo')?.readonly).toBe(false);
  });

  it('显式 readonly 覆盖派生', () => {
    registerModule({
      getToolDefinitions: () => [],
      handleTool: async () => null,
      TOOL_META: { demo: { readonly: true, actionRisks: { write: 'write' } } },
    });
    expect(getToolMeta('demo')?.readonly).toBe(true);
  });

  it('getActionRisk 返回声明的 risk', () => {
    registerModule({
      getToolDefinitions: () => [],
      handleTool: async () => null,
      TOOL_META: { demo: { actionRisks: { remove: 'destructive' } } },
    });
    expect(getActionRisk('demo', 'remove')).toBe('destructive');
    expect(getActionRisk('demo', 'unknown')).toBeUndefined();
    expect(getActionRisk('absent', 'x')).toBeUndefined();
  });

  it('getActionRisks 返回完整映射', () => {
    registerModule({
      getToolDefinitions: () => [],
      handleTool: async () => null,
      TOOL_META: { demo: { actionRisks: { a: 'read', b: 'write' } } },
    });
    expect(getActionRisks('demo')).toEqual({ a: 'read', b: 'write' });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/core/tool-registry.test.ts`
Expected: FAIL（`actionRisks` 类型不存在 / `getActionRisk` 未导出）

- [ ] **Step 3: 实现**

`src/core/tool-registry.ts` 改动：

(a) `ToolMeta` 接口（第 9-13 行）加 `RiskLevel` + `actionRisks`：
```ts
export type RiskLevel = 'read' | 'write' | 'destructive' | 'process';

export interface ToolMeta {
  name: string;
  readonly: boolean;
  long_running: boolean;
  actionRisks?: Record<string, RiskLevel>;
}
```

(b) `ToolModule.TOOL_META` 类型（第 18 行）扩展：
```ts
TOOL_META?: Record<string, {
  readonly?: boolean;
  long_running?: boolean;
  actionRisks?: Record<string, RiskLevel>;
}>;
```

(c) `registerModule`（第 32-54 行）派生 readonly——把 `const entry: ToolMeta = { name, ...m };` 改为：
```ts
const actionRisks = m.actionRisks;
const derivedReadonly = actionRisks
  ? Object.values(actionRisks).every(r => r === 'read')
  : false;
const entry: ToolMeta = {
  name,
  readonly: m.readonly ?? derivedReadonly,
  long_running: m.long_running ?? false,
  actionRisks,
};
```
（注意：A-10 自动注册分支 `readonly: false` 保持不变，因其无 actionRisks）

(d) 第 90-92 行 `getToolMeta` 后新增查询函数：
```ts
export function getActionRisks(name: string): Record<string, RiskLevel> | undefined {
  return metaRegistry.get(name)?.actionRisks;
}

export function getActionRisk(toolName: string, action: string): RiskLevel | undefined {
  return getActionRisks(toolName)?.[action];
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run test/core/tool-registry.test.ts`
Expected: PASS（5 个 case 全过）

- [ ] **Step 5: 类型检查 + commit**

Run: `npx tsc --noEmit`
Expected: 无错误

```bash
git add src/core/tool-registry.ts test/core/tool-registry.test.ts
git commit -m "feat(tool-registry): RiskLevel 类型 + actionRisks 字段 + readonly 派生 + 查询函数"
```

---

## Task 2: 补齐 5 工具的 ACTIONS 常量

**Files:**
- Modify: `src/tools/animation/animation-ops.ts`、`src/tools/material-ops.ts`、`src/tools/android.ts`、`src/tools/workflow.ts`、`src/tools/manage-tools.ts`

**Interfaces:**
- Produces: 5 个工具的 `const ACTIONS = [...] as const`，供 Task 3-5 的 `Record<typeof ACTIONS[number], RiskLevel>` 类型约束引用
- Consumes: 各工具现有 inputSchema inline enum（提取为常量后 inputSchema 引用常量）

- [ ] **Step 1: animation-ops.ts 提取 ACTIONS 常量**

在 `src/tools/animation/animation-ops.ts` inputSchema 的 action enum 前（约第 31 行）加：
```ts
const ACTIONS = [
  'list_players', 'get_info', 'get_details', 'get_keyframes', 'play', 'stop',
  'seek', 'blend', 'create', 'delete', 'update_props', 'add_track', 'remove_track',
  'add_keyframe', 'remove_keyframe', 'update_keyframe', 'ik_modifier_create',
  'ik_modifier_get', 'ik_modifier_set', 'ik_list_bones',
] as const;
```
然后把 inputSchema 里 `enum: ['list_players', ...]`（字面数组）改为 `enum: [...ACTIONS]`。确认 handleTool 的 action 校验也引用 `ACTIONS`（若已有 switch 则不动，仅类型源统一）。

- [ ] **Step 2: material-ops.ts 提取 ACTIONS 常量**

`src/tools/material-ops.ts` 第 602 行 inline enum 处加：
```ts
const ACTIONS = [
  'read', 'set_params', 'create', 'save', 'load',
  'shader_read', 'shader_write', 'shader_load_file', 'shader_save_file',
  'shader_list_templates', 'shader_apply_template',
] as const;
```
inputSchema 的 action enum 改为 `enum: [...ACTIONS]`。

- [ ] **Step 3: android.ts 提取 ACTIONS 常量**

`src/tools/android.ts` 第 303 行 inline enum 处加：
```ts
const ACTIONS = ['list_devices', 'get_preset_info', 'deploy', 'check_template', 'logcat'] as const;
```
inputSchema 的 action enum 改为 `enum: [...ACTIONS]`。

- [ ] **Step 4: workflow.ts 提取 ACTIONS 常量**

`src/tools/workflow.ts` 第 95 行 inline enum 处加：
```ts
const ACTIONS = ['dev_loop', 'scene_snapshot', 'batch_validate', 'create_files', 'run_verify', 'diff_scenes'] as const;
```
inputSchema 的 action enum 改为 `enum: [...ACTIONS]`。

- [ ] **Step 5: manage-tools.ts 提取 ACTIONS 常量**

`src/tools/manage-tools.ts` 第 62 行 inline enum 处加：
```ts
const ACTIONS = ['list_groups', 'activate', 'deactivate', 'sync', 'reconnect', 'migrate'] as const;
```
inputSchema 的 action enum 改为 `enum: [...ACTIONS]`。

- [ ] **Step 6: 类型检查 + 全量测试 + commit**

Run: `npx tsc --noEmit && npm test`
Expected: 无错误，全量测试通过（纯重构，行为不变）

```bash
git add src/tools/animation/animation-ops.ts src/tools/material-ops.ts src/tools/android.ts src/tools/workflow.ts src/tools/manage-tools.ts
git commit -m "refactor(tools): 5 工具 inline enum 提取为 const ACTIONS 常量(为 risk 类型约束铺垫)"
```

---

## Task 3: 迁移 scene/script/animation/tilemap 的 actionRisks

**Files:**
- Modify: `src/tools/scene/index.ts`（scene 的 TOOL_META 在此，第 400 行附近）、`src/tools/script.ts`（第 1036 行）、`src/tools/animation/animation-ops.ts`（第 681 行）、`src/tools/tilemap-ops.ts`（第 464 行）
- Test: `test/risk-declarations.test.ts`（新建，聚合各工具 risk 断言）

**Interfaces:**
- Consumes: Task 1 的 `getActionRisk`、Task 2 的 `ACTIONS` 常量
- Produces: 4 工具的 `TOOL_META.actionRisks` 完整声明

- [ ] **Step 1: 写失败测试**

新建 `test/risk-declarations.test.ts`：
```ts
import { describe, it, expect } from 'vitest';
import { registerAllModules } from '../src/core/module-loader.js';
import { getActionRisk } from '../src/core/tool-registry.js';

registerAllModules();

describe('scene actionRisks', () => {
  const cases: Record<string, 'read'|'write'|'destructive'|'process'> = {
    read_scene: 'read', query_scene_tree: 'read', inspect_node: 'read', health_check: 'read',
    create_scene: 'write', quick_scene: 'write', add_node: 'write', batch_add_nodes: 'write',
    edit_node: 'write', save_scene: 'write', load_sprite: 'write', instance_scene: 'write',
    set_instance_property: 'write', detach_instance: 'write', create_3d_node: 'write', commit: 'write',
    remove_node: 'destructive', merge_scene: 'destructive',
  };
  for (const [action, risk] of Object.entries(cases)) {
    it(`scene.${action} → ${risk}`, () => expect(getActionRisk('scene', action)).toBe(risk));
  }
});

describe('script actionRisks', () => {
  const cases = {
    read_script: 'read', write_script: 'write', edit_script: 'write',
    generate_test: 'write', create_test_scene: 'write',
    execute_gdscript: 'process', project_replace: 'destructive',
  } as const;
  for (const [action, risk] of Object.entries(cases)) {
    it(`script.${action} → ${risk}`, () => expect(getActionRisk('script', action)).toBe(risk));
  }
});

describe('animation actionRisks', () => {
  const cases = {
    list_players: 'read', get_info: 'read', get_details: 'read', get_keyframes: 'read',
    play: 'read', stop: 'read', seek: 'read', blend: 'read',
    ik_modifier_get: 'read', ik_list_bones: 'read',
    create: 'write', update_props: 'write', add_track: 'write', add_keyframe: 'write',
    update_keyframe: 'write', ik_modifier_create: 'write', ik_modifier_set: 'write',
    delete: 'destructive', remove_track: 'destructive', remove_keyframe: 'destructive',
  } as const;
  for (const [action, risk] of Object.entries(cases)) {
    it(`animation.${action} → ${risk}`, () => expect(getActionRisk('animation', action)).toBe(risk));
  }
});

describe('tilemap actionRisks', () => {
  const cases = {
    tilemap_read: 'read', tilemap_copy: 'read',
    tilemap_set_cell: 'write', tilemap_erase_cell: 'write', tilemap_fill_rect: 'write',
    tilemap_paste: 'write', tilemap_set_transform: 'write',
    tilemap_clear: 'destructive',
  } as const;
  for (const [action, risk] of Object.entries(cases)) {
    it(`tilemap.${action} → ${risk}`, () => expect(getActionRisk('tilemap', action)).toBe(risk));
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run test/risk-declarations.test.ts`
Expected: FAIL（4 工具无 actionRisks → getActionRisk 返回 undefined）

- [ ] **Step 3: scene 加 actionRisks**

`src/tools/scene/index.ts` 的 `TOOL_META`（第 400 行）改为（加 actionRisks）：
```ts
TOOL_META: {
  scene: {
    actionRisks: {
      read_scene: 'read', query_scene_tree: 'read', inspect_node: 'read', health_check: 'read',
      create_scene: 'write', quick_scene: 'write', add_node: 'write', batch_add_nodes: 'write',
      edit_node: 'write', save_scene: 'write', load_sprite: 'write', instance_scene: 'write',
      set_instance_property: 'write', detach_instance: 'write', create_3d_node: 'write', commit: 'write',
      remove_node: 'destructive', merge_scene: 'destructive',
    } satisfies Record<typeof SCENE_ACTIONS[number], RiskLevel>,
  },
},
```
（注：`SCENE_ACTIONS` 是 `scene/helpers.ts:9` 导出的常量，import 它 + `RiskLevel` 类型；若该常量未导出则改为 `import { ACTIONS as SCENE_ACTIONS } from './helpers.js'`，按实际导出名）

- [ ] **Step 4: script 加 actionRisks**

`src/tools/script.ts` 的 `TOOL_META`（第 1036 行）加 actionRisks（引用本文件第 97 行 `ACTIONS`）：
```ts
TOOL_META: {
  script: {
    actionRisks: {
      read_script: 'read', write_script: 'write', edit_script: 'write',
      generate_test: 'write', create_test_scene: 'write',
      execute_gdscript: 'process', project_replace: 'destructive',
    } satisfies Record<typeof ACTIONS[number], RiskLevel>,
  },
},
```
（文件顶部 `import type { RiskLevel } from '../core/tool-registry.js';`）

- [ ] **Step 5: animation 加 actionRisks**

`src/tools/animation/animation-ops.ts` 的 `TOOL_META`（第 681 行）加 actionRisks（引用 Task 2 的 `ACTIONS`）：
```ts
TOOL_META: {
  animation: {
    actionRisks: {
      list_players: 'read', get_info: 'read', get_details: 'read', get_keyframes: 'read',
      play: 'read', stop: 'read', seek: 'read', blend: 'read',
      ik_modifier_get: 'read', ik_list_bones: 'read',
      create: 'write', update_props: 'write', add_track: 'write', add_keyframe: 'write',
      update_keyframe: 'write', ik_modifier_create: 'write', ik_modifier_set: 'write',
      delete: 'destructive', remove_track: 'destructive', remove_keyframe: 'destructive',
    } satisfies Record<typeof ACTIONS[number], RiskLevel>,
  },
},
```

- [ ] **Step 6: tilemap 加 actionRisks**

`src/tools/tilemap-ops.ts` 的 `TOOL_META`（第 464 行）加 actionRisks（引用本文件第 250 行 `ACTIONS`）：
```ts
TOOL_META: {
  tilemap: {
    actionRisks: {
      tilemap_read: 'read', tilemap_copy: 'read',
      tilemap_set_cell: 'write', tilemap_erase_cell: 'write', tilemap_fill_rect: 'write',
      tilemap_paste: 'write', tilemap_set_transform: 'write',
      tilemap_clear: 'destructive',
    } satisfies Record<typeof ACTIONS[number], RiskLevel>,
  },
},
```

- [ ] **Step 7: 运行测试确认通过**

Run: `npx vitest run test/risk-declarations.test.ts`
Expected: PASS（4 工具全部 case）

- [ ] **Step 8: commit**

```bash
git add src/tools/scene/index.ts src/tools/script.ts src/tools/animation/animation-ops.ts src/tools/tilemap-ops.ts test/risk-declarations.test.ts
git commit -m "feat(tools): scene/script/animation/tilemap 声明 actionRisks(含类型约束)"
```

---

## Task 4: 迁移 material/particles/signal/nav/audio/ui/physics 的 actionRisks

**Files:**
- Modify: `src/tools/material-ops.ts`(787)、`src/tools/particles.ts`(516)、`src/tools/signal-ops.ts`(228)、`src/tools/navigation.ts`(493)、`src/tools/audio-ops.ts`(251)、`src/tools/ui/index.ts`、`src/tools/physics-ops.ts`(452)
- Test: `test/risk-declarations.test.ts`（追加 7 工具 describe）

**Interfaces:**
- Consumes: Task 1 `getActionRisk`、各工具 `ACTIONS` 常量
- Produces: 7 工具 `actionRisks`

- [ ] **Step 1: 追加失败测试**

在 `test/risk-declarations.test.ts` 末尾追加 7 个 describe：
```ts
describe('material actionRisks', () => {
  const cases = {
    read: 'read', shader_read: 'read', shader_list_templates: 'read',
    set_params: 'write', create: 'write', save: 'write', load: 'write',
    shader_write: 'write', shader_load_file: 'write', shader_save_file: 'write', shader_apply_template: 'write',
  } as const;
  for (const [a, r] of Object.entries(cases)) it(`material.${a}→${r}`, () => expect(getActionRisk('material', a)).toBe(r));
});
describe('particles actionRisks', () => {
  const cases = { particles_create: 'write', particles_set_emission: 'write', particles_set_process: 'write', particles_load_preset: 'write', particles_set_material: 'write' } as const;
  for (const [a, r] of Object.entries(cases)) it(`particles.${a}→${r}`, () => expect(getActionRisk('particles', a)).toBe(r));
});
describe('signal actionRisks', () => {
  const cases = { signal_connect: 'read', signal_disconnect: 'read', signal_list: 'read', signal_emit: 'write' } as const;
  for (const [a, r] of Object.entries(cases)) it(`signal.${a}→${r}`, () => expect(getActionRisk('signal', a)).toBe(r));
});
describe('nav actionRisks', () => {
  const cases = { query_path: 'read', create_region: 'write', bake_mesh: 'write', create_agent: 'write', set_params: 'write', create_link: 'write' } as const;
  for (const [a, r] of Object.entries(cases)) it(`nav.${a}→${r}`, () => expect(getActionRisk('nav', a)).toBe(r));
});
describe('audio actionRisks', () => {
  const cases = { audio_play: 'read', audio_stop: 'read', audio_query: 'read', audio_set_param: 'write' } as const;
  for (const [a, r] of Object.entries(cases)) it(`audio.${a}→${r}`, () => expect(getActionRisk('audio', a)).toBe(r));
});
describe('ui actionRisks', () => {
  const cases = { ui_get_layout: 'read', ui_create_control: 'write', ui_set_layout: 'write', ui_anchor_preset: 'write', ui_set_theme: 'write', ui_container_add: 'write', ui_draw_recipe: 'write', ui_build_layout: 'write', theme_create: 'write', theme_set_property: 'write' } as const;
  for (const [a, r] of Object.entries(cases)) it(`ui.${a}→${r}`, () => expect(getActionRisk('ui', a)).toBe(r));
});
describe('physics actionRisks', () => {
  const cases = { raycast: 'read', body_info: 'read', diagnose: 'read', query_spatial: 'read', collision_overlay: 'write' } as const;
  for (const [a, r] of Object.entries(cases)) it(`physics.${a}→${r}`, () => expect(getActionRisk('physics', a)).toBe(r));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/risk-declarations.test.ts`
Expected: 新增 7 describe FAIL

- [ ] **Step 3-9: 逐工具加 actionRisks**

每个工具在各自 `TOOL_META` 加 `actionRisks`（引用本工具 `ACTIONS` 常量 + `satisfies Record<typeof ACTIONS[number], RiskLevel>`）。完整字面量：

material-ops.ts：
```ts
actionRisks: {
  read: 'read', shader_read: 'read', shader_list_templates: 'read',
  set_params: 'write', create: 'write', save: 'write', load: 'write',
  shader_write: 'write', shader_load_file: 'write', shader_save_file: 'write', shader_apply_template: 'write',
} satisfies Record<typeof ACTIONS[number], RiskLevel>,
```
particles.ts：`{ particles_create:'write', particles_set_emission:'write', particles_set_process:'write', particles_load_preset:'write', particles_set_material:'write' }`
signal-ops.ts：`{ signal_connect:'read', signal_disconnect:'read', signal_list:'read', signal_emit:'write' }`
navigation.ts：`{ query_path:'read', create_region:'write', bake_mesh:'write', create_agent:'write', set_params:'write', create_link:'write' }`
audio-ops.ts：`{ audio_play:'read', audio_stop:'read', audio_query:'read', audio_set_param:'write' }`
ui/index.ts（引用 `ui/types.ts` 的 `ACTIONS`）：`{ ui_get_layout:'read', ui_create_control:'write', ui_set_layout:'write', ui_anchor_preset:'write', ui_set_theme:'write', ui_container_add:'write', ui_draw_recipe:'write', ui_build_layout:'write', theme_create:'write', theme_set_property:'write' }`
physics-ops.ts：`{ raycast:'read', body_info:'read', diagnose:'read', query_spatial:'read', collision_overlay:'write' }`

- [ ] **Step 10: 运行确认通过**

Run: `npx vitest run test/risk-declarations.test.ts`
Expected: PASS

- [ ] **Step 11: commit**

```bash
git add src/tools/material-ops.ts src/tools/particles.ts src/tools/signal-ops.ts src/tools/navigation.ts src/tools/audio-ops.ts src/tools/ui/index.ts src/tools/physics-ops.ts test/risk-declarations.test.ts
git commit -m "feat(tools): material/particles/signal/nav/audio/ui/physics 声明 actionRisks"
```

---

## Task 5: 迁移 game/runtime/android/workflow/validation/manage_tools 的 actionRisks

**Files:**
- Modify: `src/tools/game-bridge.ts`(774)、`src/tools/runtime.ts`(370)、`src/tools/android.ts`(319)、`src/tools/workflow.ts`(839)、`src/tools/validation.ts`(1069)、`src/tools/manage-tools.ts`(193)
- Test: `test/risk-declarations.test.ts`（追加 6 工具）

**Interfaces:** 同 Task 4

- [ ] **Step 1: 追加失败测试**

`test/risk-declarations.test.ts` 末尾追加：
```ts
describe('game actionRisks', () => {
  const cases = {
    game_query:'read', game_input:'read', game_wait:'read', monitor_start:'read', monitor_stop:'read', monitor_poll:'read',
    watch_start:'read', watch_stop:'read', watch_poll:'read', find_ui_elements:'read', click_button:'read',
    game_bridge_install:'write', game_bridge_uninstall:'write', game_write:'process',
  } as const;
  for (const [a, r] of Object.entries(cases)) it(`game.${a}→${r}`, () => expect(getActionRisk('game', a)).toBe(r));
});
describe('runtime actionRisks', () => {
  const cases = {
    get_debug_output:'read', get_godot_version:'read', record_load:'read',
    launch_editor:'process', run_project:'process', stop_project:'process', run_tests:'process',
    record_start:'write', record_stop:'write', record_save:'write', record_play:'write',
  } as const;
  for (const [a, r] of Object.entries(cases)) it(`runtime.${a}→${r}`, () => expect(getActionRisk('runtime', a)).toBe(r));
});
describe('android actionRisks', () => {
  const cases = { list_devices:'read', get_preset_info:'read', check_template:'read', logcat:'read', deploy:'process' } as const;
  for (const [a, r] of Object.entries(cases)) it(`android.${a}→${r}`, () => expect(getActionRisk('android', a)).toBe(r));
});
describe('workflow actionRisks', () => {
  const cases = { scene_snapshot:'read', batch_validate:'read', diff_scenes:'read', dev_loop:'process', run_verify:'process', create_files:'write' } as const;
  for (const [a, r] of Object.entries(cases)) it(`workflow.${a}→${r}`, () => expect(getActionRisk('workflow', a)).toBe(r));
});
describe('validation actionRisks', () => {
  const cases = {
    run_and_verify:'read', analyze_error:'read', validate_project:'read', validate_scripts:'read', import_resources:'read',
    export_list_presets:'read', export_get_preset:'read', validate_gdd:'read', chain_verify:'read', verify_delivery:'read',
    export_build:'process', assert:'process', stress:'process',
  } as const;
  for (const [a, r] of Object.entries(cases)) it(`validation.${a}→${r}`, () => expect(getActionRisk('validation', a)).toBe(r));
});
describe('manage_tools actionRisks', () => {
  const cases = { list_groups:'read', sync:'read', reconnect:'read', migrate:'read', activate:'write', deactivate:'write' } as const;
  for (const [a, r] of Object.entries(cases)) it(`manage_tools.${a}→${r}`, () => expect(getActionRisk('manage_tools', a)).toBe(r));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/risk-declarations.test.ts` → 新增 6 describe FAIL

- [ ] **Step 3-8: 逐工具加 actionRisks**（完整字面量同测试 cases，加 `satisfies Record<typeof ACTIONS[number], RiskLevel>`）

game-bridge.ts(引用 :348 `ACTIONS`)、runtime.ts(:14)、android.ts(Task 2 新增)、workflow.ts(Task 2 新增)、validation.ts(:98)、manage-tools.ts(Task 2 新增)。

- [ ] **Step 9: 运行确认通过 + 类型检查**

Run: `npx vitest run test/risk-declarations.test.ts && npx tsc --noEmit`
Expected: PASS + 无类型错误（全 17 工具 actionRisks 声明完成）

- [ ] **Step 10: commit**

```bash
git add src/tools/game-bridge.ts src/tools/runtime.ts src/tools/android.ts src/tools/workflow.ts src/tools/validation.ts src/tools/manage-tools.ts test/risk-declarations.test.ts
git commit -m "feat(tools): game/runtime/android/workflow/validation/manage_tools 声明 actionRisks(17 工具全完成)"
```

---

## Task 6: guard 切换 — requiresConfirmation 改查 actionRisks + 删 GUARDED

**Files:**
- Modify: `src/guard.ts`
- Test: `test/guard.test.ts`

**Interfaces:**
- Consumes: Task 1 `getActionRisk`、Task 3-5 全 17 工具 actionRisks
- Produces: `requiresConfirmation` 按 actionRisks 判定、`dynamicRiskOverride`、`isGuardedTool` 派生、`GUARDED` 删除

- [ ] **Step 1: 写行为对照失败测试**

`test/guard.test.ts` 加（确保切换后行为 = 旧 GUARDED）：
```ts
import { requiresConfirmation } from '../src/guard.js';
import { registerAllModules } from '../src/core/module-loader.js';
registerAllModules();

describe('requiresConfirmation 零行为改变', () => {
  // 抽样覆盖 4 级 + 动态豁免 + 边界 read
  it.each([
    ['scene', 'remove_node', true],     // destructive
    ['scene', 'read_scene', false],     // read
    ['scene', 'add_node', true],        // write
    ['script', 'execute_gdscript', true], // process
    ['script', 'read_script', false],
    ['game', 'game_write', true],       // process (任意方法 RPC)
    ['game', 'game_query', false],
    ['validation', 'run_and_verify', false], // trusted-nonread
    ['validation', 'export_build', true],    // process
    ['runtime', 'run_project', true],
    ['runtime', 'get_godot_version', false],
    ['particles', 'particles_create', true],
    ['signal', 'signal_emit', true],
    ['signal', 'signal_connect', false],
    ['unknown_tool', 'x', false],       // 未注册工具
  ])('%s.%s 确认=%s', (tool, action, expected) => {
    expect(requiresConfirmation(tool, { action })).toBe(expected);
  });

  it('script.edit_script + search_and_replace 动态豁免 → false', () => {
    expect(requiresConfirmation('script', { action: 'edit_script', search_and_replace: { search: 'a', replace: 'b' } })).toBe(false);
  });
  it('script.edit_script 无 search_and_replace → true', () => {
    expect(requiresConfirmation('script', { action: 'edit_script' })).toBe(true);
  });
  it('无 action 参数 → false', () => {
    expect(requiresConfirmation('scene', {})).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/guard.test.ts`
Expected: 部分 FAIL（requiresConfirmation 仍查 GUARDED，但行为应 coincidentally 一致——若全 PASS 说明 GUARDED 与 actionRisks 已一致，仍需切换；若 FAIL 说明 actionRisks 有误，先修 actionRisks）

> 关键：此测试在切换**前**应已 PASS（GUARDED 行为），切换**后**仍 PASS（actionRisks 行为）。它锁住零改变契约。

- [ ] **Step 3: 实现 dynamicRiskOverride + 改 requiresConfirmation**

`src/guard.ts` 改：
(a) 顶部 import：`import { getActionRisk, type RiskLevel } from './core/tool-registry.js';`

(b) 删除 `GUARDED` 常量（第 52-78 行整块）。

(c) 加 `dynamicRiskOverride`（替代原 `requiresConfirmation` 内的 search_and_replace 特例）：
```ts
/** 动态豁免：args 内容决定 risk 的特例（当前仅 script.edit_script 的 search_and_replace 模式）。 */
function dynamicRiskOverride(toolName: string, action: string, args: Record<string, unknown> | undefined): RiskLevel | null {
  if (toolName === 'script' && action === 'edit_script') {
    const sr = args?.search_and_replace;
    if (sr && typeof sr === 'object' && 'search' in sr) return 'read'; // 内容匹配、非破坏性
  }
  return null;
}
```

(d) `requiresConfirmation`（第 80-94 行）改为：
```ts
export function requiresConfirmation(toolName: string, args?: Record<string, unknown>): boolean {
  const action = (args?.action ?? args?.method) as string | undefined;
  if (action == null) return false;
  const risk = dynamicRiskOverride(toolName, action, args) ?? getActionRisk(toolName, action);
  return risk !== undefined && risk !== 'read';
}
```

(e) `isGuardedTool`（第 209-211 行）改为（`getActionRisks` 并入 (a) 的 import，不要重复 import）：
```ts
export function isGuardedTool(toolName: string): boolean {
  const risks = getActionRisks(toolName);
  return risks !== undefined && Object.values(risks).some(r => r !== 'read');
}
```
即 (a) 的 import 行改为 `import { getActionRisk, getActionRisks, type RiskLevel } from './core/tool-registry.js';`

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run test/guard.test.ts`
Expected: PASS（零行为改变契约成立）

- [ ] **Step 5: 全量测试 + 类型检查 + commit**

Run: `npx tsc --noEmit && npm test`
Expected: 全过（注意：若有测试直接引用 `GUARDED` 常量，需同步改为引用 actionRisks；grep `GUARDED` 排查）

```bash
git add src/guard.ts test/guard.test.ts
git commit -m "refactor(guard): requiresConfirmation 改查 actionRisks + dynamicRiskOverride,删除 GUARDED 硬编码表"
```

---

## Task 7: 覆盖完整性测试 — 根除漏标的硬约束

**Files:**
- Test: `test/risk-coverage.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 `getActionRisks`、各工具 `getToolDefinitions` 的 action enum

- [ ] **Step 1: 写测试**

新建 `test/risk-coverage.test.ts`：
```ts
import { describe, it, expect } from 'vitest';
import { registerAllModules } from '../src/core/module-loader.js';
import { getAllToolDefinitions, getActionRisks } from '../src/core/tool-registry.js';

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
    if (actions.length === 0) continue; // 无 action enum 的工具跳过
    it(`${tool}: 每个 action 都声明了 risk`, () => {
      const risks = getActionRisks(tool);
      expect(risks, `${tool} 未声明 actionRisks`).toBeDefined();
      const missing = actions.filter(a => !(a in (risks ?? {})));
      expect(missing, `${tool} 漏标 risk 的 action: ${missing.join(', ')}`).toEqual([]);
    });
  }
});
```

- [ ] **Step 2: 运行确认通过（迁移已完成，应全过）**

Run: `npx vitest run test/risk-coverage.test.ts`
Expected: PASS（全 17 工具每个 action 都有 risk）。若有 FAIL，说明某工具 actionRisks 漏标，回到对应 Task 补。

- [ ] **Step 3: commit**

```bash
git add test/risk-coverage.test.ts
git commit -m "test(risk): actionRisks 覆盖完整性测试(根除漏标的运行期硬约束)"
```

---

## Task 8: capability matrix — risk 分布 + trusted-nonread + diff 验证

**Files:**
- Modify: `src/capability/schema.ts`（ToolCapability 加 riskDistribution/trustedNonRead 字段）、`src/capability/extract.ts`、`src/capability/build-matrix.ts`
- Test: `test/capability/matrix-integrity.test.ts`

**Interfaces:**
- Consumes: Task 1 `getActionRisks`
- Produces: `extract.ts` 的 `guarded` 从 actionRisks 派生；`build-matrix.ts` risk 分布 + trusted-nonread

- [ ] **Step 1: 核实 trusted-nonread 候选清单**

人工核对 read 级 action 中"实际启进程/有副作用"的：确认 `validation.run_and_verify`（启 Godot）、`validation.verify_delivery`（启 Godot 验证）为 trusted-nonread。其余 read action（查询/读取/短期控制）不是。

- [ ] **Step 2: extract.ts guarded 派生改 actionRisks**

`src/capability/extract.ts:25` `const guarded = isGuardedTool(tool.name);` 不变（`isGuardedTool` 在 Task 6 已改为派生 actionRisks，调用点无需改）。确认 `extract.ts:3` 仍 import `isGuardedTool`。

- [ ] **Step 3: build-matrix.ts 加 risk 分布 + trusted-nonread**

`src/capability/build-matrix.ts` 的 `buildMarkdown` 加 risk 聚合（遍历 caps 的 actionRisks）。需先让 `extract.ts` 把每个工具的 action risk 分布写进 `ToolCapability`（`schema.ts` 加 `riskDistribution?: Record<RiskLevel, number>` + `trustedNonRead?: string[]`）。

`extract.ts` 提取函数内加：
```ts
const actionRisks = getActionRisks(tool.name);
const riskDistribution: Record<string, number> = { read: 0, write: 0, destructive: 0, process: 0 };
if (actionRisks) for (const r of Object.values(actionRisks)) riskDistribution[r]++;
const trustedNonRead = ['run_and_verify', 'verify_delivery']; // 实际启进程但项目信任不确认
```
（trustedNonRead 清单以 Step 1 核实为准，写进 extract 或 build-matrix）

`build-matrix.ts` 概览加：
```ts
const riskTotals = { read: 0, write: 0, destructive: 0, process: 0 };
for (const c of caps) for (const [k, v] of Object.entries(c.riskDistribution ?? {})) riskTotals[k] += v;
// lines 加：`- risk：read ${riskTotals.read} / write ${riskTotals.write} / destructive ${riskTotals.destructive} / process ${riskTotals.process}`
// trusted-nonread 脚注：`> 注：标 read 但实际启进程/有副作用(项目有意信任)的 action：${trustedList} *`
```

- [ ] **Step 4: matrix-integrity 测试**

`test/capability/matrix-integrity.test.ts` 加断言：每个 cap 有 riskDistribution；read 总数 + write + destructive + process = action 总数。

- [ ] **Step 5: 重建 matrix + diff 验证**

Run: `npm run build-matrix && npm run diff-matrix`
Expected: matrix.md 生成含 risk 分布；diff-matrix 报告 `securityLevel` 无降级（guarded 派生源变了但结果应一致）

- [ ] **Step 6: 全量验证 + commit**

Run: `npm test && npm run lint`
Expected: 全过

```bash
git add src/capability/extract.ts src/capability/build-matrix.ts src/capability/schema.ts docs/capability-matrix.json docs/capability-matrix.md test/capability/matrix-integrity.test.ts
git commit -m "feat(capability): matrix 从 actionRisks 派生 guarded + risk 四级分布 + trusted-nonread 标记"
```

---

## 完成验证（所有 Task 后）

- [ ] `npx tsc --noEmit` 无错误
- [ ] `npm test` 全过（含 risk-declarations / risk-coverage / guard 行为对照 / matrix-integrity）
- [ ] `npm run diff-matrix` 无 securityLevel 降级
- [ ] `npm run lint` 无错误
- [ ] grep `GUARDED` 确认 `src/guard.ts` 已无 GUARDED 表（仅历史注释可留）
- [ ] 手动抽样：`requiresConfirmation('game', {action:'game_write'})` === true（process 级确认）
