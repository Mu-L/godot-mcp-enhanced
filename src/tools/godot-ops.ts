import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolResult } from '../types.js';
import { textResult } from '../types.js';
import { validatePath } from '../helpers.js';
import { executeGdscript } from '../gdscript-executor.js';

// ─── Constants ─────────────────────────────────────────────────────────────

export const TYPE_WHITELIST = [
  'Node3D', 'MeshInstance3D', 'StaticBody3D', 'RigidBody3D',
  'CharacterBody3D', 'Camera3D', 'Light3D', 'DirectionalLight3D',
  'OmniLight3D', 'SpotLight3D', 'CollisionShape3D', 'RayCast3D',
  'Area3D', 'Marker3D', 'PathFollow3D', 'VisibleOnScreenNotifier3D',
] as const;

export const ERROR_CODES = {
  INVALID_PATH: 'INVALID_PATH',
  NODE_NOT_FOUND: 'NODE_NOT_FOUND',
  INVALID_VECTOR: 'INVALID_VECTOR',
  INVALID_TYPE: 'INVALID_TYPE',
  INVALID_SIGNAL: 'INVALID_SIGNAL',
  SCRIPT_EXEC_FAILED: 'SCRIPT_EXEC_FAILED',
} as const;

// ─── Helper Utilities ─────────────────────────────────────────────────────

export function normalizeNodePath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('NodePath cannot be empty');
  if (trimmed.startsWith('res://')) throw new Error('NodePath must be a scene tree path (root/...), not a resource path (res://...)');
  return trimmed.startsWith('/') ? trimmed : '/' + trimmed;
}

export function gdEscape(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"')
    .replace(/\0/g, '');
}

export function validateVector3(v: unknown): { x: number; y: number; z: number } {
  if (typeof v !== 'object' || v === null) throw new Error('Vector3 must be an object with x, y, z number fields');
  const obj = v as Record<string, unknown>;
  for (const key of ['x', 'y', 'z']) {
    if (typeof obj[key] !== 'number') throw new Error(`Vector3 field "${key}" must be a number`);
  }
  return { x: obj.x as number, y: obj.y as number, z: obj.z as number };
}

// Internal helpers (not exported)
function opsError(code: keyof typeof ERROR_CODES, message: string) {
  return { success: false, error: message, error_code: ERROR_CODES[code], warnings: [] };
}

function opsSuccess(data: unknown, warnings: string[] = []) {
  return { success: true, data, warnings };
}

// Placeholder exports for build — will be filled in later tasks
export function getToolDefinitions(): Tool[] { return []; }
export async function handleTool(_name: string, _args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult | null> { return null; }
