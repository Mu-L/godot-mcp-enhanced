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
