import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { InstanceRef } from './agent-context.js';
import { getLogger } from './logger.js';

const STATE_FILENAME = 'mcp-state.json';
const DEBOUNCE_MS = 2000;
const STALE_AGENT_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 小时

export interface PersistedAgentState {
  selectedInstance: InstanceRef | null;
  activeProfile: string;
  contextMeta: { scenePath: string; fetchedAt: number } | null;
}

export interface PersistedState {
  version: 1;
  savedAt: number;
  agents: Record<string, PersistedAgentState>;
  globalProfile: string;
  lastConnectedPort: number | null;
}

export class FileStateStore {
  private filePath: string;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private cachedState: PersistedState | null = null;
  private generation = 0;

  constructor(projectPath: string) {
    const dir = projectPath
      ? path.join(projectPath, '.godot')
      : path.join(os.homedir(), '.godot-mcp');
    this.filePath = path.join(dir, STATE_FILENAME);
  }

  async load(): Promise<PersistedState | null> {
    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedState;
      return this.validate(parsed);
    } catch {
      return null;
    }
  }

  markDirty(getState: () => PersistedState): void {
    // 立即调用 getState 捕获当前状态快照
    this.cachedState = getState();
    this.generation++;
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), DEBOUNCE_MS);
    }
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.cachedState) return;

    // C-01 fix: 记录写入前的 generation，写入完成后仅在没有新脏数据时清空
    const genBeforeWrite = this.generation;
    const state: PersistedState = { ...this.cachedState, savedAt: Date.now() };
    const tmp = this.filePath + '.mcp-tmp';

    try {
      const dir = path.dirname(this.filePath);
      await fs.promises.mkdir(dir, { recursive: true });
      // M-4: 原子写——先写临时文件再 rename（同盘 rename 原子）。避免崩溃/断电留下截断 JSON，
      // 导致 load() 的 catch 吞掉 JSON.parse 错误而静默丢失全部 agent 状态。
      await fs.promises.writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8');
      await fs.promises.rename(tmp, this.filePath);
      // 仅在没有新 markDirty 调用时清空缓存，避免覆盖更新快照
      if (this.generation === genBeforeWrite) {
        this.cachedState = null;
      }
    } catch (err) {
      // M-4: 清理残留临时文件（rename 失败时 tmp 可能残留），再记日志
      await fs.promises.unlink(tmp).catch(() => { /* tmp 未创建或已被 rename 消费 */ });
      // A-18: Log flush failure instead of silently swallowing
      getLogger().error('state-store', `flush failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  destroy(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private validate(state: PersistedState): PersistedState {
    const fresh = (): PersistedState => ({
      version: 1, savedAt: Date.now(), agents: {}, globalProfile: 'full', lastConnectedPort: null,
    });
    if (state.version !== 1) return fresh();

    // M-4: 结构校验——防畸形/被篡改的 mcp-state.json 导致后续处理异常。
    // 注意："selectedInstance 指向攻击者端口"的风险不成立——InstanceRouter.getSelectedInstance
    // 从注册表 instanceMap 查询(instance-router.ts:46)，非法 selectedId 返回 null 不路由。
    // 此处仅做结构合法性校验（低成本加固），完整"实例存在于注册表"由路由端注册表查询保证。
    if (typeof state.agents !== 'object' || state.agents === null) return fresh();
    if (typeof state.globalProfile !== 'string') return fresh();
    for (const id of Object.keys(state.agents)) {
      const agent = state.agents[id];
      if (!agent || typeof agent !== 'object') { delete state.agents[id]; continue; }
      if (typeof agent.activeProfile !== 'string') agent.activeProfile = 'full';
      // selectedInstance 结构: InstanceRef = { type: 'port'|'path', value: string } | null
      const si = agent.selectedInstance as unknown;
      if (si !== null && si !== undefined) {
        const sio = si as Record<string, unknown>;
        if (typeof sio !== 'object' || sio === null ||
            (sio.type !== 'port' && sio.type !== 'path') ||
            typeof sio.value !== 'string') {
          agent.selectedInstance = null;
        }
      }
    }

    const isStale = Date.now() - state.savedAt > STALE_AGENT_THRESHOLD_MS;
    if (isStale) {
      state.agents = {};
    }

    return state;
  }
}
