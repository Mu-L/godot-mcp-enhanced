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
    const group = getGroupForTool(tool.name) ?? 'unknown';
    const meta = getToolMeta(tool.name);
    const readonly = meta?.readonly ?? false;
    const longRunning = meta?.long_running ?? false;
    const guarded = isGuardedTool(tool.name);

    const requiredParams: string[] = Array.isArray((tool.inputSchema as any)?.required)
      ? (tool.inputSchema as any).required
      : [];
    const propKeys = Object.keys((tool.inputSchema as any)?.properties ?? {});
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
