/**
 * B-T4: headless gdscript spawn orphan 清理契约（源码级 + 行为级）。
 *
 * 缺陷背景：gdscript-executor.ts:1192 `spawn(godotPath, godotArgs)` 不入
 * _spawnedGodotPids（仅 runtime.ts:224 run_project 注册）。GodotServer.close() 只
 * kill run_project 长进程。挂起脚本 + 关闭 → 孤儿无兜底；orphan 扫描默认只扫
 * run_project PID。修复：spawn 注册 + close 清理 in-flight。
 *
 * 本测试用源码级 grep + 行为级 spy 验证：
 *   1. 源码级：spawn 后调 registerSpawnedGodotPid；三路径 forceKillTree 后调 unregister
 *   2. 源码级：GodotServer.close() 含 killPidTree 遍历活跃 PID
 *   3. 行为级：process-state 导出契约（register/unregister/getSpawnedGodotPids/killPidTree）
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXEC_SRC = readFileSync(join(__dirname, '../src/gdscript-executor.ts'), 'utf-8');
const SERVER_SRC = readFileSync(join(__dirname, '../src/GodotServer.ts'), 'utf-8');

describe('B-T4: gdscript-executor spawn 注册 PID', () => {
  it('import 含 registerSpawnedGodotPid + unregisterSpawnedGodotPid', () => {
    expect(EXEC_SRC).toMatch(/registerSpawnedGodotPid/);
    expect(EXEC_SRC).toMatch(/unregisterSpawnedGodotPid/);
  });

  it('spawn 后立即注册 PID（proc 出现后 400 字符内调 register）', () => {
    const spawnIdx = EXEC_SRC.indexOf('spawn(godotPath, godotArgs');
    expect(spawnIdx, 'spawn(godotPath, godotArgs) 调用点应存在').toBeGreaterThan(0);
    const after = EXEC_SRC.slice(spawnIdx, spawnIdx + 400);
    expect(after).toMatch(/registerSpawnedGodotPid\s*\(\s*proc\.pid\s*\)/);
  });

  it('exit + error 事件均接线 unregister', () => {
    const exitIdx = EXEC_SRC.indexOf("proc.on('exit'");
    const errorIdx = EXEC_SRC.indexOf("proc.on('error'");
    expect(exitIdx, "proc.on('exit' 监听器应存在").toBeGreaterThan(0);
    expect(errorIdx, "proc.on('error' 监听器应存在").toBeGreaterThan(0);
    // 实现可能用闭包 unregisterSpawn() 或直接调 unregisterSpawnedGodotPid(proc.pid)
    const directCalls = EXEC_SRC.match(/unregisterSpawnedGodotPid\s*\(\s*proc\.pid\s*\)/g) ?? [];
    const closureCalls = EXEC_SRC.match(/\bunregisterSpawn\s*\(\s*\)/g) ?? [];
    const total = directCalls.length + closureCalls.length;
    // 闭包实现：exit/error 传引用（不匹配调用正则）+ 三 forceKillTree 分支各 1 + close 1 = 4
    // 直接调：exit/error 各 1 + 三 forceKillTree 各 1 = 5
    // nit#3 后 close handler 补 unregisterSpawn，闭包调用点 = 4（1225/1250/1261/1273）
    expect(total, `unregister 调用总数 ${total}（direct=${directCalls.length} closure=${closureCalls.length}），期望 >=4`).toBeGreaterThanOrEqual(4);
  });

  it('三 forceKillTree 分支后均调 unregister（timeout / stdout 溢出 / stderr 溢出）', () => {
    // 三处 forceKillTree(proc) 后 120 字符内必须出现 unregister（直接或闭包）
    const fktIndices: number[] = [];
    let searchFrom = 0;
    while (true) {
      const idx = EXEC_SRC.indexOf('forceKillTree(proc)', searchFrom);
      if (idx < 0) break;
      fktIndices.push(idx);
      searchFrom = idx + 1;
    }
    expect(fktIndices.length, 'forceKillTree(proc) 调用数').toBeGreaterThanOrEqual(3);
    let covered = 0;
    for (const idx of fktIndices) {
      const window = EXEC_SRC.slice(idx, idx + 120);
      if (/unregisterSpawn|unregisterSpawnedGodotPid/.test(window)) covered++;
    }
    expect(covered, `forceKillTree 后紧跟 unregister 的路径数 ${covered}/${fktIndices.length}，期望全覆盖`).toBe(fktIndices.length);
  });
});

describe('B-T4: GodotServer.close() 清理 in-flight gdscript spawn', () => {
  it('close() 内遍历活跃 PID 并 kill（killPidTree 或 forceKillTree）', () => {
    const closeStart = SERVER_SRC.indexOf('async close(): Promise<void>');
    expect(closeStart, 'close() 方法应存在').toBeGreaterThan(0);
    const closeEnd = SERVER_SRC.indexOf("log('Server shut down')", closeStart);
    const closeBody = closeEnd > 0 ? SERVER_SRC.slice(closeStart, closeEnd) : SERVER_SRC.slice(closeStart, closeStart + 1200);
    expect(closeBody).toMatch(/getSpawnedGodotPids\s*\(\s*\)/);
    expect(closeBody).toMatch(/killPidTree|forceKillTree/);
  });
});

describe('B-T4 行为级: process-state 导出契约', () => {
  it('源码 import 链路完整（register/unregister/getSpawnedGodotPids/killPidTree 均导出）', async () => {
    const ps = await import('../src/core/process-state.js');
    expect(typeof ps.registerSpawnedGodotPid).toBe('function');
    expect(typeof ps.unregisterSpawnedGodotPid).toBe('function');
    expect(typeof ps.getSpawnedGodotPids).toBe('function');
    expect(typeof ps.killPidTree).toBe('function');
  });
});
