import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  InstanceManager,
  type InstanceInfo,
  type InstanceStatus,
  discoverInstances,
  getMachineRegistryDir,
  buildInstanceInfo,
} from '../../src/core/instance-manager.js';

const TMP = join(tmpdir(), 'godot-mcp-test-instances');

// Helper: create a mock instance registry file
function writeInstanceFile(dir: string, info: InstanceInfo): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${info.id}.json`), JSON.stringify(info));
}

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('InstanceManager', () => {
  describe('types', () => {
    it('InstanceInfo has required fields', () => {
      const info: InstanceInfo = {
        id: 'uuid-test-1',
        projectPath: 'D:/projects/game',
        projectName: 'game',
        port: 9081,
        pid: 12345,
        lastSeen: new Date().toISOString(),
        godotVersion: '4.4',
        capabilities: ['registry-heartbeat'],
      };
      expect(info.id).toBe('uuid-test-1');
      expect(info.port).toBe(9081);
    });
  });

  describe('registry read/write', () => {
    it('reads instances from machine-level registry', async () => {
      const manager = new InstanceManager({ registryDir: TMP });
      writeInstanceFile(TMP, {
        id: 'uuid-1',
        projectPath: 'D:/game1',
        projectName: 'game1',
        port: 9081,
        pid: 100,
        lastSeen: new Date().toISOString(),
        godotVersion: '4.4',
        capabilities: [],
      });

      const instances = await manager.loadFromRegistry();
      expect(instances).toHaveLength(1);
      expect(instances[0].id).toBe('uuid-1');
    });

    it('reads instances from project-level registry', async () => {
      const projectDir = join(TMP, 'project');
      const manager = new InstanceManager({
        registryDir: TMP,
        projectRegistryDir: projectDir,
      });

      writeInstanceFile(projectDir, {
        id: 'uuid-proj-1',
        projectPath: 'D:/game1',
        projectName: 'game1',
        port: 9082,
        pid: 200,
        lastSeen: new Date().toISOString(),
        godotVersion: '4.4',
        capabilities: [],
      });

      const instances = await manager.loadFromRegistry();
      expect(instances).toHaveLength(1);
      expect(instances[0].id).toBe('uuid-proj-1');
    });

    it('merges machine + project registries, dedup by id', async () => {
      const projectDir = join(TMP, 'project');
      const manager = new InstanceManager({
        registryDir: TMP,
        projectRegistryDir: projectDir,
      });

      writeInstanceFile(TMP, {
        id: 'uuid-1',
        projectPath: 'D:/game1',
        projectName: 'game1',
        port: 9081,
        pid: 100,
        lastSeen: new Date().toISOString(),
        godotVersion: '4.4',
        capabilities: [],
      });
      writeInstanceFile(projectDir, {
        id: 'uuid-1', // same id, different data — project wins
        projectPath: 'D:/game1',
        projectName: 'game1',
        port: 9081,
        pid: 100,
        lastSeen: new Date().toISOString(),
        godotVersion: '4.5',
        capabilities: [],
      });
      writeInstanceFile(projectDir, {
        id: 'uuid-2',
        projectPath: 'D:/game2',
        projectName: 'game2',
        port: 9082,
        pid: 200,
        lastSeen: new Date().toISOString(),
        godotVersion: '4.4',
        capabilities: [],
      });

      const instances = await manager.loadFromRegistry();
      expect(instances).toHaveLength(2);
      const updated = instances.find(i => i.id === 'uuid-1');
      expect(updated?.godotVersion).toBe('4.5');
    });

    it('handles corrupt JSON files gracefully', async () => {
      mkdirSync(TMP, { recursive: true });
      writeFileSync(join(TMP, 'bad.json'), '{not valid json');
      writeFileSync(join(TMP, 'good.json'), JSON.stringify({
        id: 'uuid-good',
        projectPath: 'D:/game',
        projectName: 'game',
        port: 9081,
        pid: 100,
        lastSeen: new Date().toISOString(),
        godotVersion: '4.4',
        capabilities: [],
      }));

      const manager = new InstanceManager({ registryDir: TMP });
      const instances = await manager.loadFromRegistry();
      expect(instances).toHaveLength(1);
      expect(instances[0].id).toBe('uuid-good');
    });

    it('handles missing registry directory gracefully', async () => {
      const manager = new InstanceManager({ registryDir: join(TMP, 'nonexistent') });
      const instances = await manager.loadFromRegistry();
      expect(instances).toHaveLength(0);
    });

    it('rejects registry entries with invalid fields', async () => {
      mkdirSync(TMP, { recursive: true });
      // Port out of range
      writeFileSync(join(TMP, 'bad-port.json'), JSON.stringify({
        id: 'x', projectPath: '/tmp/p', projectName: 'p', port: 99999, pid: 1,
        lastSeen: new Date().toISOString(), godotVersion: '4.4', capabilities: [],
      }));
      // Path traversal
      writeFileSync(join(TMP, 'traversal.json'), JSON.stringify({
        id: 'y', projectPath: '/tmp/../etc/p', projectName: 'p', port: 9081, pid: 1,
        lastSeen: new Date().toISOString(), godotVersion: '4.4', capabilities: [],
      }));
      // Missing id
      writeFileSync(join(TMP, 'no-id.json'), JSON.stringify({
        projectPath: '/tmp/p', projectName: 'p', port: 9081, pid: 1,
        lastSeen: new Date().toISOString(), godotVersion: '4.4', capabilities: [],
      }));
      // Valid entry
      writeFileSync(join(TMP, 'valid.json'), JSON.stringify({
        id: 'uuid-valid', projectPath: 'D:/game', projectName: 'game', port: 9081, pid: 1,
        lastSeen: new Date().toISOString(), godotVersion: '4.4', capabilities: [],
      }));

      const manager = new InstanceManager({ registryDir: TMP });
      const instances = await manager.loadFromRegistry();
      expect(instances).toHaveLength(1);
      expect(instances[0].id).toBe('uuid-valid');
    });

    it('CMP-7 跨语言格式契约: GD instance_registry.gd 写的 JSON 被 TS loadFromRegistry 接受', async () => {
      // B-1 回归守护: GD instance_registry.gd:59 用 Time.get_datetime_string_from_system()
      // 写 lastSeen(ISO 8601 string)。若有人改回 epoch ms(number),TS isInstanceInfo 会静默拒绝
      // → editor discovery 全失效。此测试模拟 GD 输出格式,验证 TS 端真接受。
      mkdirSync(TMP, { recursive: true });
      // 模拟 GD instance_registry.gd 的 _write_instance_json 输出格式
      const gdOutput = {
        id: 'editor-9090',
        projectPath: 'D:/game',
        projectName: 'game',
        port: 9090,
        pid: 12345,
        lastSeen: '2026-08-08T12:34:56',  // Time.get_datetime_string_from_system() 格式(ISO 8601 string)
        godotVersion: '4.6.3.stable.official',
        capabilities: ['editor-instance'],
        status: 'ready',
      };
      writeFileSync(join(TMP, 'editor-9090.json'), JSON.stringify(gdOutput));

      const manager = new InstanceManager({ registryDir: TMP, isPidAlive: () => true });
      const instances = await manager.loadFromRegistry();
      expect(instances).toHaveLength(1);
      expect(instances[0].id).toBe('editor-9090');
      expect(instances[0].lastSeen).toBe('2026-08-08T12:34:56');
    });

    it('CMP-7 跨语言格式契约: number 格式 lastSeen 被拒绝(防 B-1 回归)', async () => {
      // B-1 根因: epoch ms(number)不通过 TS typeof === 'string' 守卫,被静默跳过。
      // 此测试锁定:若 GD 误改回 number 格式,TS 端拒绝该 JSON(而非静默接受致 getStatus 崩溃)。
      mkdirSync(TMP, { recursive: true });
      const badOutput = {
        id: 'editor-bad',
        projectPath: 'D:/game',
        projectName: 'game',
        port: 9090,
        pid: 12345,
        lastSeen: 1723100000000,  // number(epoch ms)——B-1 的 bug 格式
        godotVersion: '4.6.3',
        capabilities: [],
      };
      writeFileSync(join(TMP, 'editor-bad.json'), JSON.stringify(badOutput));

      const manager = new InstanceManager({ registryDir: TMP });
      const instances = await manager.loadFromRegistry();
      expect(instances).toHaveLength(0);  // number lastSeen 被类型守卫拒绝
    });

    it('阶段4-4: 段级检查不误拒含 .. 子串的合法段名(如 ..backup)', async () => {
      // 原 includes("..") 会误拒 "..backup"(字符串包含 ".."); 段级只拒恰好为 ".." 的段
      writeFileSync(join(TMP, 'legit.json'), JSON.stringify({
        id: 'legit-1', projectPath: 'D:/projects/..backup/game', projectName: 'game',
        port: 9081, pid: 1, lastSeen: new Date().toISOString(), godotVersion: '4.4', capabilities: [],
      }));
      const manager = new InstanceManager({ registryDir: TMP });
      const instances = await manager.loadFromRegistry();
      expect(instances).toHaveLength(1);
      expect(instances[0].id).toBe('legit-1');
    });
  });

  describe('zombie detection', () => {
    it('reports alive for recent instance', () => {
      const manager = new InstanceManager({ registryDir: TMP, isPidAlive: () => true });
      const status = manager.getStatus({
        id: 'uuid-1',
        projectPath: 'D:/game',
        projectName: 'game',
        port: 9081,
        pid: 100,
        lastSeen: new Date().toISOString(),
        godotVersion: '4.4',
        capabilities: [],
      });
      expect(status).toBe('alive');
    });

    it('reports stale for old instance', () => {
      const manager = new InstanceManager({ registryDir: TMP, isPidAlive: () => true });
      const oldDate = new Date(Date.now() - 80000).toISOString();
      const status = manager.getStatus({
        id: 'uuid-1',
        projectPath: 'D:/game',
        projectName: 'game',
        port: 9081,
        pid: 100,
        lastSeen: oldDate,
        godotVersion: '4.4',
        capabilities: [],
      });
      expect(status).toBe('stale');
    });

    it('CMP-7: dead pid → unreachable(不等 lastSeen 超时)', () => {
      // I-2 fix: CMP-7 核心——pid liveness probe 检测崩溃进程,直接标 unreachable 不等 70s staleTimeout
      const manager = new InstanceManager({ registryDir: TMP, isPidAlive: () => false });
      const status = manager.getStatus({
        id: 'uuid-dead',
        projectPath: 'D:/game',
        projectName: 'game',
        port: 9081,
        pid: 99999,
        lastSeen: new Date().toISOString(),  // 刚刚更新,但 pid 已死
        godotVersion: '4.4',
        capabilities: [],
      });
      expect(status).toBe('unreachable');
    });
  });

  describe('Phase 2 status field', () => {
    it('treats compiling status as alive even when heartbeat is stale', () => {
      const manager = new InstanceManager({ registryDir: TMP, staleTimeoutMs: 70000 });
      const status = manager.getStatus({
        id: 'uuid-1',
        projectPath: 'D:/game',
        projectName: 'game',
        port: 9081,
        pid: 100,
        lastSeen: new Date(Date.now() - 80000).toISOString(),
        godotVersion: '4.4',
        capabilities: [],
        status: 'compiling',
      });
      expect(status).toBe('alive');
    });

    it('treats ready status with stale heartbeat as stale', () => {
      const manager = new InstanceManager({ registryDir: TMP, staleTimeoutMs: 70000, isPidAlive: () => true });
      const status = manager.getStatus({
        id: 'uuid-1',
        projectPath: 'D:/game',
        projectName: 'game',
        port: 9081,
        pid: 100,
        lastSeen: new Date(Date.now() - 80000).toISOString(),
        godotVersion: '4.4',
        capabilities: [],
        status: 'ready',
      });
      expect(status).toBe('stale');
    });

    it('treats unresponsive status as unreachable', () => {
      const manager = new InstanceManager({ registryDir: TMP });
      const status = manager.getStatus({
        id: 'uuid-1',
        projectPath: 'D:/game',
        projectName: 'game',
        port: 9081,
        pid: 100,
        lastSeen: new Date().toISOString(),
        godotVersion: '4.4',
        capabilities: [],
        status: 'unresponsive',
      });
      expect(status).toBe('unreachable');
    });

    it('treats missing status as regular heartbeat-based detection', () => {
      const manager = new InstanceManager({ registryDir: TMP, staleTimeoutMs: 70000, isPidAlive: () => true });
      // No status field — falls through to stale logic
      const alive = manager.getStatus({
        id: 'uuid-1',
        projectPath: 'D:/game',
        projectName: 'game',
        port: 9081,
        pid: 100,
        lastSeen: new Date().toISOString(),
        godotVersion: '4.4',
        capabilities: [],
      });
      expect(alive).toBe('alive');

      const stale = manager.getStatus({
        id: 'uuid-2',
        projectPath: 'D:/game',
        projectName: 'game',
        port: 9081,
        pid: 100,
        lastSeen: new Date(Date.now() - 80000).toISOString(),
        godotVersion: '4.4',
        capabilities: [],
      });
      expect(stale).toBe('stale');
    });
  });

  describe('port range', () => {
    it('default port range is 9081-9090', () => {
      const manager = new InstanceManager({ registryDir: TMP });
      expect(manager.portRange).toEqual([9081, 9090]);
    });

    it('custom port range from env var', () => {
      const original = process.env.GODOT_MCP_INSTANCE_PORT_RANGE;
      process.env.GODOT_MCP_INSTANCE_PORT_RANGE = '9000-9010';
      const manager = new InstanceManager({ registryDir: TMP });
      expect(manager.portRange).toEqual([9000, 9010]);
      if (original !== undefined) process.env.GODOT_MCP_INSTANCE_PORT_RANGE = original;
      else delete process.env.GODOT_MCP_INSTANCE_PORT_RANGE;
    });

    it('rejects port 0 from empty range segment', () => {
      const original = process.env.GODOT_MCP_INSTANCE_PORT_RANGE;
      process.env.GODOT_MCP_INSTANCE_PORT_RANGE = '-9090';
      const manager = new InstanceManager({ registryDir: TMP });
      expect(manager.portRange).toEqual([9081, 9090]);
      if (original !== undefined) process.env.GODOT_MCP_INSTANCE_PORT_RANGE = original;
      else delete process.env.GODOT_MCP_INSTANCE_PORT_RANGE;
    });

    it('rejects out-of-range ports', () => {
      const original = process.env.GODOT_MCP_INSTANCE_PORT_RANGE;
      process.env.GODOT_MCP_INSTANCE_PORT_RANGE = '0-70000';
      const manager = new InstanceManager({ registryDir: TMP });
      expect(manager.portRange).toEqual([9081, 9090]);
      if (original !== undefined) process.env.GODOT_MCP_INSTANCE_PORT_RANGE = original;
      else delete process.env.GODOT_MCP_INSTANCE_PORT_RANGE;
    });
  });

  describe('async loadFromRegistry', () => {
    it('loadFromRegistry returns asynchronously', async () => {
      const dir = join(tmpdir(), 'godot-mcp-test-async-' + Date.now());
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'inst1.json'), JSON.stringify({
        id: 'async-1', port: 9081, projectPath: 'D:/a', projectName: 'a', pid: 1,
        lastSeen: new Date().toISOString(), godotVersion: '4.4', capabilities: [],
      }));

      const mgr = new InstanceManager({ registryDir: dir });
      const result = await mgr.loadFromRegistry();
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('async-1');

      rmSync(dir, { recursive: true, force: true });
    });
  });

  // ─── 行225 新增：写入能力（registerSelf/unregisterSelf/updateLastSeen/allocatePort）───
  describe('self-registration (行225)', () => {
    it('registerSelf writes JSON to registry dir + loadFromRegistry can read it back', async () => {
      const dir = join(tmpdir(), 'godot-mcp-test-reg-' + Date.now());
      const mgr = new InstanceManager({ registryDir: dir });
      const info = buildInstanceInfo({ port: 9085, projectPath: 'D:/test', projectName: 'test' });
      await mgr.registerSelf(info);
      const loaded = await mgr.loadFromRegistry();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.id).toBe(info.id);
      expect(loaded[0]!.port).toBe(9085);
      expect(loaded[0]!.capabilities).toContain('ts-http-receiver');
      rmSync(dir, { recursive: true, force: true });
    });

    it('unregisterSelf deletes the JSON file (best-effort, missing ok)', async () => {
      const dir = join(tmpdir(), 'godot-mcp-test-unreg-' + Date.now());
      const mgr = new InstanceManager({ registryDir: dir });
      const info = buildInstanceInfo({ port: 9086, projectPath: 'D:/test', projectName: 'test' });
      await mgr.registerSelf(info);
      // 确认写入
      expect((await mgr.loadFromRegistry()).length).toBe(1);
      // 删除
      await mgr.unregisterSelf(info.id);
      expect((await mgr.loadFromRegistry()).length).toBe(0);
      // 再次删除不报错(best-effort)
      await mgr.unregisterSelf(info.id);
      rmSync(dir, { recursive: true, force: true });
    });

    it('updateLastSeen updates only lastSeen field, preserves others', async () => {
      const dir = join(tmpdir(), 'godot-mcp-test-hb-' + Date.now());
      const mgr = new InstanceManager({ registryDir: dir });
      const info = buildInstanceInfo({ port: 9087, projectPath: 'D:/test', projectName: 'test' });
      const originalLastSeen = info.lastSeen;
      await mgr.registerSelf(info);
      // 等 1.1s 确保 lastSeen 变化
      await new Promise(r => setTimeout(r, 1100));
      await mgr.updateLastSeen(info.id);
      const loaded = await mgr.loadFromRegistry();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.lastSeen).not.toBe(originalLastSeen);
      expect(loaded[0]!.port).toBe(9087);  // 其他字段保持
      expect(loaded[0]!.id).toBe(info.id);
      rmSync(dir, { recursive: true, force: true });
    });

    it('allocatePort returns first free port in range', () => {
      const mgr = new InstanceManager({ registryDir: TMP });
      // 默认范围 9081-9090，无占用 → 9081
      expect(mgr.allocatePort([])).toBe(9081);
      // 9081-9083 占用 → 9084
      expect(mgr.allocatePort([9081, 9082, 9083])).toBe(9084);
    });

    it('allocatePort throws when all ports in range are occupied', () => {
      const mgr = new InstanceManager({ registryDir: TMP });
      const allPorts = Array.from({ length: 10 }, (_, i) => 9081 + i); // 9081-9090
      expect(() => mgr.allocatePort(allPorts)).toThrow(/No free port in range 9081-9090/);
    });

    it('buildInstanceInfo generates ts-<pid>-<random> id with required fields', () => {
      const info = buildInstanceInfo({ port: 9088, projectPath: 'D:/myproject', projectName: 'myproject' });
      expect(info.id).toMatch(/^ts-\d+-[0-9a-f]{6}$/);
      expect(info.id).toContain(String(process.pid));
      expect(info.port).toBe(9088);
      expect(info.pid).toBe(process.pid);
      expect(info.capabilities).toContain('ts-http-receiver');
      expect(info.status).toBe('ready');
      expect(typeof info.lastSeen).toBe('string');
      expect(info.lastSeen.length).toBeGreaterThan(0);
    });
  });

});
