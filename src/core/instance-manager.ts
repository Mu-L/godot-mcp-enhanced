// src/core/instance-manager.ts
/**
 * InstanceManager �?multi-instance discovery and registry management (Phase 2b)
 *
 * Discovers running Godot instances via:
 * 1. Machine-level registry: ~/.godot-mcp/instances/
 * 2. Project-level registry: {project}/.godot/mcp-instances/
 *
 * Each instance writes its own JSON file (no concurrent write contention).
 * Stale detection: lastSeen > staleTimeout �?stale status.
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface InstanceInfo {
  id: string;
  projectPath: string;
  projectName: string;
  port: number;
  pid: number;
  lastSeen: string;       // ISO 8601
  godotVersion: string;
  capabilities: string[];  // e.g. ['registry-heartbeat']

  // Phase 2 新增（可选，旧插件不写此字段）
  status?: 'ready' | 'compiling' | 'unresponsive';
  registeredAt?: number;
}

export type InstanceStatus = 'alive' | 'stale' | 'unreachable';

/**
 * C-02 安全：类型守卫函数，验证 JSON 解析后的对象满足 InstanceInfo 必需字段。
 * 防止损坏/恶意 JSON 通过 as 强制转型后产生 undefined 行为。
 */
function isInstanceInfo(obj: unknown): obj is InstanceInfo {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.id === 'string' && o.id.length > 0 &&
    typeof o.projectPath === 'string' && o.projectPath.length > 0 &&
    typeof o.projectName === 'string' && o.projectName.length > 0 &&
    typeof o.port === 'number' && o.port >= 1 && o.port <= 65535 &&
    typeof o.pid === 'number' &&
    typeof o.lastSeen === 'string' && o.lastSeen.length > 0 &&
    typeof o.godotVersion === 'string' &&
    Array.isArray(o.capabilities) &&
    (o.capabilities as unknown[]).every(c => typeof c === 'string')
  );
}

export interface InstanceManagerOptions {
  /** Machine-level registry directory. Defaults to ~/.godot-mcp/instances/ */
  registryDir?: string;
  /** Project-level registry directory. Optional. */
  projectRegistryDir?: string;
  /** Stale timeout in ms. Defaults to 70000 (70s). */
  staleTimeoutMs?: number;
  /** CMP-7: pid liveness probe override (测试注入用)。默认用 process.kill(pid, 0)。 */
  isPidAlive?: (pid: number) => boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_STALE_TIMEOUT_MS = 70000; // 30s × 2 + 10s jitter margin
const DEFAULT_PORT_START = 9081;
const DEFAULT_PORT_END = 9090;

function getDefaultRegistryDir(): string {
  return join(homedir(), '.godot-mcp', 'instances');
}

function parsePortRange(): [number, number] {
  const env = process.env.GODOT_MCP_INSTANCE_PORT_RANGE;
  if (!env) return [DEFAULT_PORT_START, DEFAULT_PORT_END];
  const parts = env.split('-').map(Number);
  if (
    parts.length === 2 &&
    Number.isFinite(parts[0]) && Number.isFinite(parts[1]) &&
    parts[0]! >= 1 && parts[0]! <= 65535 &&
    parts[1]! >= 1 && parts[1]! <= 65535 &&
    parts[0]! < parts[1]!
  ) {
    return [parts[0]!, parts[1]!];
  }
  return [DEFAULT_PORT_START, DEFAULT_PORT_END];
}

// ─── InstanceManager ────────────────────────────────────────────────────────

export class InstanceManager {
  private readonly registryDir: string;
  private readonly projectRegistryDir?: string;
  private readonly staleTimeoutMs: number;
  private readonly _portRange: [number, number];
  private readonly _isPidAlive: (pid: number) => boolean;
  private instances: Map<string, InstanceInfo> = new Map();

  constructor(opts: InstanceManagerOptions = {}) {
    this.registryDir = opts.registryDir ?? getDefaultRegistryDir();
    this.projectRegistryDir = opts.projectRegistryDir;
    this.staleTimeoutMs = opts.staleTimeoutMs ?? DEFAULT_STALE_TIMEOUT_MS;
    this._portRange = parsePortRange();
    this._isPidAlive = opts.isPidAlive ?? defaultIsPidAlive;
  }

  /** Get configured port range. */
  get portRange(): [number, number] {
    return this._portRange;
  }

  /** Load instances from both registry levels. Machine-level first, then project-level overrides. */
  async loadFromRegistry(): Promise<InstanceInfo[]> {
    const merged = new Map<string, InstanceInfo>();

    // Machine-level first
    const machineInstances = await this.readRegistryDir(this.registryDir);
    for (const inst of machineInstances) {
      merged.set(inst.id, inst);
    }

    // Project-level overrides (project wins on duplicate id)
    if (this.projectRegistryDir) {
      const projectInstances = await this.readRegistryDir(this.projectRegistryDir);
      for (const inst of projectInstances) {
        merged.set(inst.id, inst);
      }
    }

    this.instances = merged;
    return [...merged.values()];
  }

  /** Get instance by id. */
  getInstance(id: string): InstanceInfo | undefined {
    return this.instances.get(id);
  }

  /** Get all loaded instances. */
  getAllInstances(): InstanceInfo[] {
    return [...this.instances.values()];
  }

  /** Determine status of an instance based on lastSeen timestamp + pid liveness. */
  getStatus(instance: InstanceInfo): InstanceStatus {
    // Phase 2: compiling overrides stale detection
    if (instance.status === 'compiling') {
      return 'alive';
    }
    if (instance.status === 'unresponsive') {
      return 'unreachable';
    }
    // CMP-7 (2026-08-08): pid liveness probe——pid 不存活直接标 unreachable,
    // 不等 lastSeen 超时(原仅靠时间戳,进程崩溃但 lastSeen 未过期的 zombie instance 误判 alive)。
    if (!this._isPidAlive(instance.pid)) {
      return 'unreachable';
    }
    // Existing stale logic
    const lastSeen = new Date(instance.lastSeen).getTime();
    const elapsed = Date.now() - lastSeen;
    if (elapsed < this.staleTimeoutMs) return 'alive';
    return 'stale';
  }

  /** Read instance JSON files from a directory. Corrupt/invalid files are skipped. */
  private async readRegistryDir(dir: string): Promise<InstanceInfo[]> {
    const results: InstanceInfo[] = [];
    try {
      const files = await readdir(dir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const content = await readFile(join(dir, file), 'utf-8');
          const parsed = JSON.parse(content);
          // C-02 安全：使用类型守卫验证所有必需字段
          if (!isInstanceInfo(parsed)) continue;
          // C-02 安全：段级路径遍历检查 — 任一路径段恰好为 '..'(原 includes('..') 误拒 '..backup' 等合法子串)
          if (parsed.projectPath.split(/[\\/]/).some(seg => seg === '..')) continue;
          results.push(parsed);
        } catch {
          // Skip corrupt/invalid files (ENOENT, SyntaxError, etc.)
        }
      }
    } catch {
      // Directory doesn't exist �?return empty
    }
    return results;
  }
}

/**
 * CMP-7 (2026-08-08): 检测 pid 是否存活。用 process.kill(pid, 0) 发 signal 0(不实际杀进程)。
 * - 存活:返回 true(signal 0 成功无异常)
 * - 不存活:返回 false(ESRCH=no such process / Windows EPERM)
 * 跨平台:POSIX 信号 0 + Windows process.kill 都支持此语义。
 * 注:与 src/core/process-state.ts:52 isPidAlive 同语义(模块独立重复,避免 instance-manager 依赖
 * process-state)。若 pid 检测逻辑变化需两处同步。
 */
function defaultIsPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;  // ESRCH (process not found) or EPERM (Windows permission)
  }
}

/** Convenience: get machine-level registry directory path. */
export function getMachineRegistryDir(): string {
  return getDefaultRegistryDir();
}

/** Convenience: discover all instances. Creates a temporary manager and runs discovery. */
export async function discoverInstances(opts?: InstanceManagerOptions): Promise<InstanceInfo[]> {
  const manager = new InstanceManager(opts);
  return await manager.loadFromRegistry();
}
