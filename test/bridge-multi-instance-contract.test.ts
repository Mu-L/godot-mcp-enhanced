import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// A1 (2026-08-19 反馈 bridge 9081 多实例劫持) 契约测试: mcp_bridge.gd 端口探测避让 +
// machine registry 双写 + ping 实例指纹。修复前: PORT 固定 9081,Windows 双实例 bind 同端口
// 都"成功"(流量全到先占实例),查询被路由到非目标实例返回误导性数据。
//
// ⚠️ 局限(对齐 e2e-bridge-set-prop-coerce-contract 范式): 源码字符串断言验证"修复模式
// 落位"而非运行时行为。运行时行为由双实例 e2e 冒烟覆盖(见开发日志 2026-08-19)。

const gd = readFileSync('src/scripts/mcp_bridge.gd', 'utf8');

function sliceBetween(startAnchor: string, endAnchor: string): string {
  const start = gd.indexOf(startAnchor);
  expect(start, `锚点未找到: ${startAnchor}`).toBeGreaterThanOrEqual(0);
  const end = gd.indexOf(endAnchor, start);
  expect(end, `结束锚点未找到: ${endAnchor}`).toBeGreaterThan(start);
  return gd.slice(start, end);
}

describe('A1: mcp_bridge.gd 端口探测避让 + registry + ping 指纹', () => {
  it('A1-a: PORT 固定常量已移除(改为 PORT_DEFAULT + 运行时 _port)', () => {
    expect(gd.includes('const PORT := '), '残留 const PORT 固定常量').toBe(false);
    expect(gd.includes('const PORT_DEFAULT := 9081')).toBe(true);
    expect(gd.includes('var _port := PORT_DEFAULT')).toBe(true);
  });

  it('A1-b: _bind_available_port 存在且被 _start_server 调用(listen 前置)', () => {
    const startServer = sliceBetween('func _start_server', 'func _bind_available_port');
    expect(startServer.includes('if not _bind_available_port():'), '_start_server 未调用 _bind_available_port').toBe(true);
    expect(startServer.indexOf('_bind_available_port')).toBeLessThan(startServer.indexOf('Listening'));
  });

  it('A1-c: listen 前主动 connect 探测占用(_port_in_use;Windows 双 bind 假成功的唯一可靠检测)', () => {
    const bindFn = sliceBetween('func _bind_available_port', 'func _port_in_use');
    expect(bindFn.includes('_port_in_use(candidate)'), '缺占用探测调用').toBe(true);
    // 探测必须先于 listen(仅靠 listen 错误码检测不出双 bind)
    expect(bindFn.indexOf('_port_in_use(candidate)')).toBeLessThan(bindFn.indexOf('.listen(candidate'));
    expect(bindFn.includes('OS.get_environment("GODOT_MCP_BRIDGE_PORT")'), '缺 env 起点覆盖').toBe(true);
  });

  it('A1-d: listen 失败同样递增重试(A3: Windows 保留端口段 netstat 空闲也绑不上)', () => {
    const bindFn = sliceBetween('func _bind_available_port', 'func _port_in_use');
    expect(bindFn.includes('if err == OK:'), '缺 listen 成功分支').toBe(true);
    // 失败 continue 到下一候选(循环内不 return 即递增)
    expect(bindFn.includes('trying next port'), '缺 listen 失败递增提示').toBe(true);
  });

  it('A1-e: 全部端口失败的 warning 含 Windows 保留端口段排查指引(A3 netsh 提示)', () => {
    const bindFn = sliceBetween('func _bind_available_port', 'func _port_in_use');
    expect(bindFn.includes('excludedportrange'), '缺 netsh excludedportrange 排查提示').toBe(true);
  });

  it('A1-f: registry machine-level 双写(_registry_files 数组,machine_dir 也写)', () => {
    const heartbeat = sliceBetween('func _start_registry_heartbeat', 'func _write_registry_entry');
    expect(heartbeat.includes('_registry_files = ['), '缺双位置赋值').toBe(true);
    const writeFn = sliceBetween('func _write_registry_entry', 'func _stop_registry_heartbeat');
    expect(writeFn.includes('for registry_file in _registry_files:'), '缺循环双写').toBe(true);
    const stopFn = sliceBetween('func _stop_registry_heartbeat', 'func _dir_ensure');
    expect(stopFn.includes('for registry_file in _registry_files:'), '缺双位置退出清理').toBe(true);
  });

  it('A1-g: registry 条目 port 用运行时 _port(避让后实际端口)', () => {
    const writeFn = sliceBetween('func _write_registry_entry', 'func _stop_registry_heartbeat');
    expect(writeFn.includes('"port": _port'), 'registry port 未用 _port').toBe(true);
  });

  it('A1-h: ping 响应带 pid + project 指纹(客户端可校验目标实例)', () => {
    const pingFn = sliceBetween('func _cmd_ping', 'func _cmd_get_tree');
    expect(pingFn.includes('"pid": OS.get_process_id()'), '缺 pid 指纹').toBe(true);
    expect(pingFn.includes('"project"'), '缺 project 指纹').toBe(true);
  });

  it('A1-i: secret 文件名与监听日志用 _port(避让端口下与 TS resolveBridgePort 对齐)', () => {
    expect(gd.includes('mcp_bridge_%d.secret" % _port'), 'secret 文件名未用 _port').toBe(true);
    expect(gd.includes('Listening on 127.0.0.1:%d" % _port'), '监听日志未用 _port').toBe(true);
  });
});
