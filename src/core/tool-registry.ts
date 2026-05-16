// src/core/tool-registry.ts

export interface ToolMeta {
  name: string;
  readonly: boolean;
  long_running: boolean;
}

const registry = new Map<string, ToolMeta>();

export function registerTools(tools: ToolMeta[]): void {
  registry.clear();
  for (const t of tools) {
    registry.set(t.name, t);
  }
}

export function isReadOnly(name: string): boolean {
  return registry.get(name)?.readonly ?? false;
}

export function isLongRunning(name: string): boolean {
  return registry.get(name)?.long_running ?? false;
}

export function getReadOnlyTools(): string[] {
  return [...registry.entries()].filter(([, m]) => m.readonly).map(([n]) => n);
}

export function getWriteTools(): string[] {
  return [...registry.entries()].filter(([, m]) => !m.readonly).map(([n]) => n);
}

export function getAllToolNames(): string[] {
  return [...registry.keys()];
}

export function getToolMeta(name: string): ToolMeta | undefined {
  return registry.get(name);
}

export const LITE_TOOLS = new Set([
  'list_projects', 'get_project_info', 'list_files', 'read_project_config',
  'read_scene', 'create_scene', 'add_node', 'save_scene',
  'read_script', 'write_script', 'edit_script',
  'execute_gdscript', 'get_godot_version',
  'run_and_verify', 'confirm_and_execute',
]);
