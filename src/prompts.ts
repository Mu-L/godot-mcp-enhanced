import type { PromptMessage } from "@modelcontextprotocol/server";

// src/prompts.ts — MCP Prompt templates for guided workflows
import { scanFiles } from './core/file-scanner.js';
import { relative } from 'node:path';

export type CompletionSource =
  | { type: 'enum'; values: string[] }
  | { type: 'scenes' };

export interface PromptDef {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required?: boolean;
    completion?: CompletionSource;
  }>;
}

/**
 * Phase 1 static prompt templates.
 *
 * These templates provide structured guidance text for common workflows.
 * They do not dynamically analyze the project — the parameters are used
 * only for string interpolation into the template text.
 *
 * Future phases will add dynamic context (scene analysis, project scan, etc.)
 * by replacing the static build() functions with tool-calling logic.
 */
const PROMPTS: Record<string, { def: PromptDef; build: (args: Record<string, string>) => PromptMessage[] }> = {
  create_platformer: {
    def: {
      name: 'create_platformer',
      description: '2D platformer game scaffold guidance',
      arguments: [
        { name: 'project_name', description: 'Project name', required: false },
        { name: 'resolution', description: 'Target resolution (e.g. 1920x1080)', required: false, completion: { type: 'enum', values: ['1280x720', '1920x1080', '2560x1440'] } },
      ],
    },
    build: (args) => [{
      role: 'user' as const,
      content: { type: 'text' as const, text: `# 2D Platformer Scaffold Guide — ${args.project_name || 'platformer'}\n\n## Resolution: ${args.resolution || '1280x720'}\n\n## Steps\n1. **Project Setup**: Create project with viewport ${args.resolution || '1280x720'}\n2. **Player Scene**: CharacterBody2D with sprite, collision shape, camera\n3. **Player Script**: move_and_slide with gravity, jump, horizontal movement\n4. **Level TileMap**: TileMapLayer with ground tiles and collision\n5. **Collectibles**: Area2D-based coins with animation\n6. **UI**: VBoxContainer with score label and lives counter\n7. **Game Loop**: game_over and restart logic\n\n## Key Tools\n- create_scene, write_script, tilemap_fill_rect, add_node, save_scene, run_and_verify` },
    }],
  },
  setup_player_controller: {
    def: {
      name: 'setup_player_controller',
      description: 'Player controller setup guidance',
      arguments: [
        { name: 'dimension', description: '2d or 3d', required: false, completion: { type: 'enum', values: ['2d', '3d'] } },
        { name: 'movement_type', description: 'topdown, platformer, or fps', required: false, completion: { type: 'enum', values: ['topdown', 'platformer', 'fps'] } },
      ],
    },
    build: (args) => [{
      role: 'user' as const,
      content: { type: 'text' as const, text: `# Player Controller Guide — ${(args.dimension || '2d').toUpperCase()} ${args.movement_type || 'platformer'}\n\n## Root: ${args.dimension === '3d' ? 'CharacterBody3D' : 'CharacterBody2D'}\n\n## Steps\n1. Define move_left, move_right, jump input actions\n2. Write move_and_slide() controller script\n3. Attach ${args.dimension === '3d' ? 'Camera3D' : 'Camera2D'}\n4. Wire sprite animations for idle/walk/jump` },
    }],
  },
  optimize_scene: {
    def: {
      name: 'optimize_scene',
      description: 'Scene optimization analysis guidance',
      arguments: [
        { name: 'scene_path', description: 'Scene file path', required: false, completion: { type: 'scenes' } },
      ],
    },
    build: (args) => [{
      role: 'user' as const,
      content: { type: 'text' as const, text: `# Scene Optimization Guide — ${args.scene_path || 'res://scenes/main.tscn'}\n\n## Analysis Steps\n1. read_scene to understand structure\n2. Count nodes (>500 may need splitting)\n3. Verify sprites use atlas textures\n4. Prefer simple collision shapes\n5. Check for script duplication\n\n## Verification\nRun verify_delivery(scope="scene") to check scene health.` },
    }],
  },
  debug_performance: {
    def: {
      name: 'debug_performance',
      description: 'Performance debugging walkthrough',
      arguments: [],
    },
    build: () => [{
      role: 'user' as const,
      content: { type: 'text' as const, text: `# Performance Debugging Guide\n\n## Step 1: Baseline\n- profiler snapshot for FPS, frame time, draw calls\n\n## Step 2: Identify Bottlenecks\n- Low FPS: check _process functions\n- High memory: look for resource leaks\n- Draw calls >1000: reduce visible nodes\n\n## Step 3: Common Fixes\n- Move heavy logic to timers\n- Disconnect unused signals\n- Use object pooling\n\n## Step 4: Measure Impact\nRun profiler_get_data after each fix.` },
    }],
  },
  scene_editing_strategy: {
    def: {
      name: 'scene_editing_strategy',
      description: 'Scene editing strategy: capability discovery, decision tree, and closed-loop verification',
      arguments: [
        {
          name: 'operation_type',
          description: 'Primary operation type (add_node, edit_node, remove_node, create_scene, read_scene)',
          required: false,
          completion: {
            type: 'enum',
            values: ['add_node', 'edit_node', 'remove_node', 'create_scene', 'read_scene'],
          },
        },
      ],
    },
    build: (args) => [{
      role: 'user' as const,
      content: { type: 'text' as const, text: `# 场景编辑策略 SOP — ${args.operation_type || '通用'}

> 本指导将散落的「截图验证纪律」固化为 AI 自动遵循的 SOP。三层结构:能力发现 → 决策树 → 闭环验证。

## 第 0 层:能力发现(摸清当前环境)

先用 godot_get_context 工具探测连接模式(connectionMode):
- **editor**(编辑器运行中):优先走实时场景树同步、支持 undo、add_node/edit_node 即时生效
- **headless**(独立 Godot 进程):文件读写为主,批量创建/一次性验证
- **bridge**(游戏运行中):E2E 测试、运行时调试、输入模拟

不同模式下同一操作的最佳工具可能不同,不要假设默认。

## 第 1 层:操作决策树(按 operation_type 分流)

当前操作:**${args.operation_type || '通用(未指定,按场景判断)'}**

- **add_node**:先 read_scene 确认父节点存在 → 用 scene 的 add_node action(指定 parent_node_path)→ editor 模式即时生效 / headless 模式需 save_scene 落盘
- **edit_node**:先 inspect_node 拿当前属性 → edit_node 传 properties 对象 → editor 模式可 undo
- **remove_node**:先 inspect_node 确认目标 + 子节点影响范围 → remove_node → 验证场景树完整性
- **create_scene**:create_scene 指定 root_node_type → add_node 加子节点 → save_scene 落盘
- **read_scene**:read_scene 拿结构 → summary_only=true 先看骨架,需要细节再 full read

降级原则:editor 不可用时降级 headless;headless 失败(如需 EditorUndoRedoManager)再考虑 editor。

## 第 2 层:闭环验证(每步截图 + 断言)

每个变更操作后,不要直接进下一步:

1. **截图**:screenshot 工具截当前视口(editor 模式截编辑器 / bridge 模式截游戏画面)
2. **断言**:用 runtime_assert 或 verify_delivery 验证变更落盘/生效
   - verify_delivery(scope="scene") 检查场景树完整性 + 脚本健康
   - runtime_assert 做自定义断言(如 \`node_count > 0\`、\`property == expected\`)
3. **失败处理**:断言失败 → analyze_error 分析 → 修复 → 重新验证,不跳过

## 关键陷阱(对照 engine-quirks)

- GPU 粒子 headless 不渲染,2D/3D 截图可能空白(非 bug)
- set_instance_property 对 root 节点返 NODE_NOT_INSTANCE(用 edit_node 替代)
- TileMapLayer 是 4.3+ 新类型,旧项目可能是 TileMap,操作前确认节点类型
- save_scene 后 .tscn 文件可能因 EditorPlugin 缓存不立即反映,headless 模式读文件更可靠

## 验证清单

变更完成后,最终验证:
- [ ] read_scene 确认目标节点存在且属性正确
- [ ] validate_scripts 0 error(若改了脚本)
- [ ] verify_delivery(scope="scene") 通过
- [ ] screenshot 视觉确认(非空白且符合预期)` },
    }],
  },
};

export function listPrompts(): PromptDef[] {
  return Object.values(PROMPTS).map(p => p.def);
}

/** 列出所有已注册 prompt 的定义（name + description + arguments）。供 godot_get_context 的 workflows 字段使用。 */
export function listPromptDefs(): PromptDef[] {
  return Object.values(PROMPTS).map(p => p.def);
}

export async function getPrompt(name: string, args: Record<string, string>): Promise<{ messages: PromptMessage[] }> {
  const prompt = PROMPTS[name];
  if (!prompt) throw new Error(`Unknown prompt: ${name}`);
  return { messages: prompt.build(args) };
}

/** 按 name 查单个 PromptDef（CompleteRequest handler 用，访问 completion 配置的唯一干净路径） */
export function getPromptDef(name: string): PromptDef | undefined {
  return PROMPTS[name]?.def;
}

/**
 * 解析补全源 → values（按 prefix 过滤）。
 * enum: 固定枚举；scenes: scanFiles 列 .tscn 归一化 res://。失败/无 projectPath → 空。
 */
export async function resolveCompletion(
  source: CompletionSource, prefix: string, projectPath?: string,
): Promise<string[]> {
  if (source.type === 'enum') {
    return source.values.filter(v => v.startsWith(prefix));
  }
  if (!projectPath) return [];
  try {
    const files = scanFiles(projectPath, ['.tscn']);
    return files
      .map(f => 'res://' + relative(projectPath, f).replace(/\\/g, '/'))
      .filter(r => r.startsWith(prefix));
  } catch {
    return [];
  }
}

/** CompleteRequest 逻辑（提取自 GodotServer handler，可单测）。SDK :5511 total=all.length；:5507 MAX=100。 */
export async function handleCompletion(
  ref: { type: string; name: string },
  argument: { name: string; value: string },
  projectPath?: string,
): Promise<{ completion: { values: string[]; total: number; hasMore: boolean } }> {
  const EMPTY = { completion: { values: [] as string[], total: 0, hasMore: false } };
  if (ref.type !== 'ref/prompt') return EMPTY;
  const argDef = getPromptDef(ref.name)?.arguments?.find(a => a.name === argument.name);
  if (!argDef?.completion) return EMPTY;
  const all = await resolveCompletion(argDef.completion, argument.value, projectPath);
  const MAX = 100;
  const truncated = all.slice(0, MAX);
  return { completion: { values: truncated, total: all.length, hasMore: all.length > MAX } };
}
