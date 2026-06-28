import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolResult } from '../types.js';
import { textResult } from '../types.js';
import { opsErrorResult } from './shared.js';
import { spawnGodot } from './spawn-helper.js';

const ERROR_CODES = {
  ADB_NOT_FOUND: 'ADB_NOT_FOUND',
  NO_DEVICES: 'NO_DEVICES',
  NO_ANDROID_PRESET: 'NO_ANDROID_PRESET',
  EXPORT_FAILED: 'EXPORT_FAILED',
  INSTALL_FAILED: 'INSTALL_FAILED',
  LAUNCH_FAILED: 'LAUNCH_FAILED',
} as const;

const PACKAGE_RE = /^[a-zA-Z][a-zA-Z0-9_.]*$/;
const SERIAL_RE = /^[a-zA-Z0-9_-]+$/;
const EXPORT_TIMEOUT_MS = 300_000;

/** adb 路径:env ANDROID_ADB(存在性校验) → PATH 'adb' fallback。adb 是系统工具,不需 --version 探测。 */
function resolveAdb(): string {
  const fromEnv = process.env.ANDROID_ADB;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  return 'adb';
}

/** 跑 adb,捕获 exit/stdout。ENOENT(adb 不存在)标记 notFound。 */
function runAdb(adb: string, args: string[]): { stdout: string; exitCode: number; notFound: boolean } {
  try {
    const stdout = execFileSync(adb, args, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { stdout, exitCode: 0, notFound: false };
  } catch (err: any) {
    if (err.code === 'ENOENT') return { stdout: '', exitCode: -1, notFound: true };
    return { stdout: err.stdout ?? '', exitCode: err.status ?? -1, notFound: false };
  }
}

/** 解析 `adb devices -l` 输出为设备数组。 */
function parseDevices(stdout: string): Array<Record<string, string>> {
  const devices: Array<Record<string, string>> = [];
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('List of devices') || line.startsWith('* daemon')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const serial = parts[0];
    const state = parts[1];
    if (!serial || !state) continue;
    const dev: Record<string, string> = { serial, state };
    for (let i = 2; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;
      const eq = part.indexOf(':');
      if (eq > 0) dev[part.slice(0, eq)] = part.slice(eq + 1);
    }
    devices.push(dev);
  }
  return devices;
}

export async function handleTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult | null> {
  if (name !== 'android') return null;
  const action = args.action as string;
  switch (action) {
    case 'list_devices': {
      const adb = resolveAdb();
      const r = runAdb(adb, ['devices', '-l']);
      if (r.notFound) {
        return opsErrorResult(ERROR_CODES.ADB_NOT_FOUND, 'adb not found. Install Android platform-tools or set ANDROID_ADB env.', {
          suggestion: 'Install Android platform-tools (Android Studio SDK Manager) or set ANDROID_ADB to the adb binary path.',
        });
      }
      const devices = parseDevices(r.stdout);
      if (devices.length === 0) {
        return opsErrorResult(ERROR_CODES.NO_DEVICES, 'No Android devices attached.', {
          suggestion: 'Connect a device with USB debugging enabled, or start an emulator.',
        });
      }
      return textResult(JSON.stringify({ devices, count: devices.length, adb_path: adb }));
    }
    default:
      return null;  // get_preset_info/deploy 后续 task 实现
  }
}

export function getToolDefinitions(): Tool[] {
  return [{
    name: 'android',
    description: 'Android Deploy 工具。list_devices: adb 设备列表。get_preset_info: 读 export_presets.cfg Android preset。deploy: export APK + adb install + launch(可选)。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list_devices', 'get_preset_info', 'deploy'] },
        project_path: { type: 'string', description: 'Godot 项目目录' },
        preset_name: { type: 'string', description: 'get_preset_info/deploy: preset 名' },
        preset_index: { type: 'number', description: 'deploy: preset 索引' },
        device_serial: { type: 'string', description: 'deploy: 设备 serial(adb -s)' },
        debug: { type: 'boolean', description: 'deploy: --export-debug(默认 true)' },
        launch: { type: 'boolean', description: 'deploy: 安装后启动(默认 true)' },
        skip_export: { type: 'boolean', description: 'deploy: 跳过导出(已有 APK)' },
      },
      required: ['action'],
    },
  }];
}

export const TOOL_META: Record<string, { readonly: boolean; long_running: boolean }> = {
  android: { readonly: false, long_running: true },
};
