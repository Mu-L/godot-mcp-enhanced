// src/tools/self-update.ts
// 单工具 self_update + action enum=[check,update]。
// ⚠️ 粒度选择：不能用两个独立无-action工具——guard.ts:65 action==null → return false
//    会导致 update 的 confirm 门静默失效。action enum 让 args.action='update' 命中确认门。
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolResult } from '../types.js';
import { textResult } from '../types.js';
import { opsSuccess, opsErrorResult } from './shared.js';
import { checkForUpdateCached, compareVersion } from '../core/update-checker.js';
import { readAddonVersion, updateAddon } from '../core/addon-version.js';
import { getAllowedProjectPaths } from '../core/path-utils.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
// src/tools/ → 上两级包根 → package.json（与 update-checker.ts:11 同款 idiom）
const pkgVersion: string = require('../../package.json').version;

const ACTIONS = ['check', 'update'] as const;

// readonly 不可设 true（否则 update 在 readOnly 模式放行绕过保护）。
// 见 spec §5：ReadOnlyGuard 工具级判定，readonly=false → readOnly 拒整工具（check 也拒）。
export const TOOL_META = {
  self_update: {
    readonly: false,
    long_running: false,
    actionRisks: {
      check: 'read' as const,
      update: 'write' as const,
    },
  },
};

export function getToolDefinitions(): Tool[] {
  return [{
    name: 'self_update',
    description: '检查/更新 enhanced 自身。check：查 npm 最新版 + 各项目 addon 版本漂移（只读）。update：更新指定项目 addon 到包版本（覆盖安装，需确认）。',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['check', 'update'],
          description: 'check=查版本状态（只读）/ update=更新项目 addon（破坏性，需确认）',
        },
        project_path: {
          type: 'string',
          description: '目标 Godot 项目路径（update 必填；check 可选，缺省扫 ALLOWED_PROJECT_PATHS 全部）',
        },
      },
      required: ['action'],
    },
  }];
}

export async function handleTool(
  name: string, args: Record<string, unknown>, _ctx: ToolContext,
): Promise<ToolResult | null> {
  if (name !== 'self_update') return null;
  const action = args.action as string;
  if (!(ACTIONS as readonly string[]).includes(action as 'check' | 'update')) {
    return opsErrorResult('UNKNOWN_ACTION', `Unknown action: ${action}`);
  }
  return action === 'check' ? handleCheck(args) : handleUpdate(args);
}

async function handleCheck(args: Record<string, unknown>): Promise<ToolResult> {
  const npm = await checkForUpdateCached({ force: true });
  const targetPaths = args.project_path
    ? [String(args.project_path)]
    : getAllowedProjectPaths();
  const addons = targetPaths.map(p => {
    try {
      const { version, installed } = readAddonVersion(p);
      return {
        project_path: p,
        installed_version: version,
        expected_version: installed ? pkgVersion : null,
        matches: installed ? version === pkgVersion : false,
        installed,
      };
    } catch (e) {
      return { project_path: p, installed: false, installed_version: null,
        expected_version: null, matches: false,
        error: e instanceof Error ? e.message : String(e) };
    }
  });
  return textResult(JSON.stringify(opsSuccess({ npm, addons })));
}

async function handleUpdate(args: Record<string, unknown>): Promise<ToolResult> {
  const projectPath = args.project_path;
  if (typeof projectPath !== 'string' || !projectPath) {
    return opsErrorResult('INVALID_PARAMS', 'update action 需要 project_path 参数');
  }
  // 降级保护：null（未安装/malformed）直 cp 修复；非 null 且 >包版本 才拒绝
  const { version: installed, installed: isInstalled } = readAddonVersion(projectPath);
  if (isInstalled && installed != null && compareVersion(installed, pkgVersion) > 0) {
    return opsErrorResult('DOWNGRADE_REFUSED',
      `项目 addon 版本 ${installed} 比包版本 ${pkgVersion} 新，疑似降级，拒绝`);
  }
  try {
    const { dest, verifyOk } = updateAddon(projectPath);
    if (!verifyOk) {
      return opsErrorResult('VERIFY_FAILED', `addon 更新后 plugin.cfg 校验失败：${dest}`);
    }
    return textResult(JSON.stringify(opsSuccess({
      project_path: projectPath,
      updated_from: installed,
      updated_to: pkgVersion,
      verifyOk,
      dest,
    })));
  } catch (e) {
    return opsErrorResult('UPDATE_FAILED', e instanceof Error ? e.message : String(e));
  }
}
