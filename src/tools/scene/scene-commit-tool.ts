import type { Tool } from "@modelcontextprotocol/server";

// src/tools/scene-commit-tool.ts
// P2: MCP tool wrapper for scene_commit.
import type { ToolContext, ToolResult } from '../../types.js';
import { textResult } from '../../types.js';
import { requireProjectPath, resolveWithinRoot, normalizeUserProjectPath } from '../../helpers.js';
import { executeGdscript } from '../../gdscript-executor.js';
import { generateCommitScript, validateCommitOperations, type CommitOperation } from './scene-commit.js';
import { acquireShortRunningSlot, releaseShortRunningSlot } from '../../core/process-state.js';
import { opsErrorResult } from '../shared.js';

export function getToolDefinitions(): Tool[] {
  console.warn(`[DEPRECATED] scene-commit-tool module is absorbed into scene. Do not register directly.`);
  return [{
    name: 'scene_commit',
    description: '批量执行场景修改操作（tile_set/tile_fill/tile_erase/tile_clear/tileset_assign/node_property/node_add），合并为一次 Godot 进程调用。适合需要持久化的批量修改。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project_path: { type: 'string', description: 'Godot 项目目录路径（可选，默认使用 GODOT_PROJECT_PATH 环境变量或当前目录）' },
        scene_path: { type: 'string', description: '目标场景路径（如 res://scenes/Level.tscn）' },
        operations: {
          type: 'array',
          description: '操作列表',
          items: {
            type: 'object',
            properties: {
              op: { type: 'string', enum: ['tile_set', 'tile_fill', 'tile_erase', 'tile_clear', 'tileset_assign', 'node_property', 'node_add'] },
              node_path: { type: 'string', description: 'TileMap/TileMapLayer 节点路径（tile 操作必需）' },
              coords: { type: 'object', description: '图块坐标 {x, y}' },
              region: { type: 'object', description: '矩形区域 {x, y, w, h}' },
              source_id: { type: 'number', description: 'TileSet 源 ID' },
              atlas: { type: 'object', description: '图集坐标 {x, y}' },
              alternative_tile: { type: 'number', description: '替代图块索引（默认 0）' },
              tileset_path: { type: 'string', description: 'TileSet 资源路径（tileset_assign）' },
              path: { type: 'string', description: '节点路径（node_property）' },
              property: { type: 'string', description: '属性名' },
              value: { description: '属性值' },
              parent: { type: 'string', description: '父节点路径（node_add）' },
              name: { type: 'string', description: '节点名称（node_add）' },
              type: { type: 'string', description: '节点类型（node_add）' },
            },
            required: ['op'],
          },
        },
        save: { type: 'boolean', description: '是否保存到文件（默认 true）', default: true },
        stop_on_error: { type: 'boolean', description: '遇错是否停止（默认 true）', default: true },
      },
      required: ['scene_path', 'operations'],
    },
  }];
}

// ─── Core handler (shared by handleTool and scene module) ─────────────────

export async function handleCommitAction(
  args: Record<string, unknown>, ctx: ToolContext,
): Promise<ToolResult | null> {
  const p = requireProjectPath(args);
  const scenePath = normalizeUserProjectPath(args.scene_path as string);
  const absPath = resolveWithinRoot(p, scenePath);
  const operations = args.operations as Array<Record<string, unknown>>;
  const save = args.save !== false;
  const stopOnError = args.stop_on_error !== false;

  if (!operations || !Array.isArray(operations) || operations.length === 0) {
    return opsErrorResult('INVALID_PARAMS', 'operations must be a non-empty array');
  }
  if (operations.length > 500) {
    return opsErrorResult('INVALID_PARAMS', `Too many operations (${operations.length}). Maximum: 500`);
  }

  // IMPORTANT-7 (review): operations 结构校验(原 as unknown as CommitOperation[] 无运行时校验,
  // 畸形 op 致 generateCommitScript 崩溃)。用 validateCommitOperations 便于单测。
  const validationError = validateCommitOperations(operations);
  if (validationError) {
    return opsErrorResult('INVALID_PARAMS', validationError);
  }

  // F-1 (批 F, 2026-08-14): editor 场景写守卫——commit 走 headless spawn 写盘(不在 editor-method-map),
  // 若该场景在 editor 打开, headless 直写磁盘会被 editor GUI save 覆盖回旧内存态,批量写入静默丢失。
  // 调用方式对齐 index.ts edit_node(:385-388)同款;守卫在 acquireShortRunningSlot 之前,被拦截不占 slot。
  // headless 模式 checkEditorSceneSave 未注入, 直接放行。
  if (ctx.checkEditorSceneSave) {
    const sceneGuard = await ctx.checkEditorSceneSave(absPath);
    if (sceneGuard.blocked) return opsErrorResult('EDITOR_SCENE_OPEN', sceneGuard.message ?? `Scene open in editor: ${absPath}`);
  }

  // Generate GDScript
  const resPath = `res://${scenePath.replace(/\\/g, '/')}`;
  const script = generateCommitScript(
    resPath,
    operations as unknown as CommitOperation[],
    save,
    stopOnError,
  );

  // Execute via Godot process
  if (!acquireShortRunningSlot()) {
    return opsErrorResult('CONCURRENCY_LIMIT', 'too many concurrent headless operations (max 3). Please wait and retry.');
  }

  try {
    const godot = await ctx.findGodot();
    const result = await executeGdscript({
      godotPath: godot,
      projectPath: p,
      code: script,
      timeout: 120,
      loadAutoloads: false,
    });

    // Parse COMMIT_RESULT from output
    const commitResult = parseCommitResult(result.raw_output || result.run_error || '');
    // F-2 (批 F, 2026-08-14; 批F fix 收口): 真失败(COMMIT_RESULT success:false)不再假成功——
    // 顶层置 isError,防 AI 与 middleware 把失败当成功。单条件 success 驱动,统一覆盖三类真失败:
    // 保存失败(ENOSPC/EACCES → err != OK → success:false)/stopOnError 中止(stopBlock success:false,
    // 含 save=false 的中止——原 save && saved===false 条件把该 corner 误排除)/load 失败。
    // save=false 正常完成的 saved:false 伴随 success:true,不触发;commitResult 为 null
    // (GDScript 崩溃无 COMMIT_RESULT)时短路走 fallback,行为不变。
    if (commitResult?.success === false) {
      return { content: [{ type: 'text', text: JSON.stringify(commitResult, null, 2) }], isError: true };
    }
    return textResult(JSON.stringify(commitResult || {
      success: result.run_success,
      raw_output: result.raw_output,
      errors: result.errors,
    }, null, 2));
  } finally {
    releaseShortRunningSlot();
  }
}

// ─── Tool Handler ───────────────────────────────────────────────────────────

export async function handleTool(
  name: string, args: Record<string, unknown>, ctx: ToolContext,
): Promise<ToolResult | null> {
  if (name !== 'scene_commit') return null;
  return handleCommitAction(args, ctx);
}

/** Parse COMMIT_RESULT JSON from GDScript output. */
export function parseCommitResult(output: string): Record<string, unknown> | null {
  const marker = 'COMMIT_RESULT: ';
  const idx = output.lastIndexOf(marker);
  if (idx === -1) return null;
  try {
    const after = output.slice(idx + marker.length);
    // Find the end of the JSON value — match balanced braces
    let depth = 0;
    let end = -1;
    for (let i = 0; i < after.length; i++) {
      if (after[i] === '{') depth++;
      else if (after[i] === '}') {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    if (end === -1) return null;
    return JSON.parse(after.slice(0, end));
  } catch {
    return null;
  }
}

export const TOOL_META: Record<string, { readonly: boolean; long_running: boolean }> = {
  scene_commit: { readonly: false, long_running: true },
};
