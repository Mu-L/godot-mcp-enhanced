// src/capability/extract.ts
import { getAllToolDefinitions, getToolMeta, getGroupForTool, TOOL_GROUPS, OFFLINE_TOOLS } from '../core/tool-registry.js';
import { isGuardedTool } from '../guard.js';
import { classifySecurityLevel, type ToolCapability } from './schema.js';
import { GROUP_SOURCE_FILES, scanDangerApi, findEditorCommandFile } from './static-grep.js';

/**
 * 提取全工具能力矩阵。须先调用 registerAllModules() 填充 registry。
 * projectRoot = 目标项目根（用于 grep src/tools 与 addons）。
 */
export function extractCapabilities(projectRoot: string): ToolCapability[] {
  // 预扫：每个 group 的主文件是否命中危险 API（group 级 danger-api 标注）
  const dangerGroups = new Set<string>();
  for (const [group, files] of Object.entries(GROUP_SOURCE_FILES)) {
    if (scanDangerApi(files, projectRoot).length > 0) dangerGroups.add(group);
  }

  const defs = getAllToolDefinitions();
  return defs.map(tool => {
    // R2-I-1: manage_tools 在 ALWAYS_ALLOWED 但不在 TOOL_GROUPS → 兜底归 core（语义：操作 tool-registry 内存状态，core 组 protected）。
    const group = getGroupForTool(tool.name) ?? (tool.name === 'manage_tools' ? 'core' : 'unknown');
    const meta = getToolMeta(tool.name);
    const readonly = meta?.readonly ?? false;
    const longRunning = meta?.long_running ?? false;
    const guarded = isGuardedTool(tool.name);

    // inputSchema 是未知形状的 JSON Schema，断言到所需字段子集（复用 middleware.ts:128 的模式，避免 any）。
    const schema = tool.inputSchema as {
      required?: string[];
      properties?: Record<string, unknown>;
      [key: string]: unknown;
    };
    const requiredParams: string[] = Array.isArray(schema.required) ? schema.required : [];
    const propKeys = Object.keys(schema.properties ?? {});
    const optionalParams = propKeys.filter(k => !requiredParams.includes(k));

    const groupRequires = (TOOL_GROUPS[group]?.requires ?? []) as ('bridge' | 'editor' | 'headless')[];
    const offlineCapable = OFFLINE_TOOLS.has(tool.name);
    const dangerApiHit = dangerGroups.has(group);
    const editorCmd = findEditorCommandFile(group, projectRoot);

    return {
      name: tool.name,
      group,
      description: tool.description ?? '',
      inputSchema: tool.inputSchema as object,
      requiredParams,
      optionalParams,
      readonly,
      longRunning,
      guarded,
      securityLevel: classifySecurityLevel({ dangerApiHit, guarded }),
      groupRequires,
      offlineCapable,
      needsGodot: !offlineCapable,
      needsEditor: groupRequires.includes('editor'),
      gdScriptImpl: {
        headless: { exists: false, path: null }, // 见 plan Scope：headless 运行时生成，无静态文件
        editor: { exists: editorCmd !== null, path: editorCmd },
      },
      relatedDefects: [], // M2 填充
      verification: { l1: 'extracted', l2: 'none', l3: 'unverified', lastRun: null },
    } satisfies ToolCapability;
  });
}
