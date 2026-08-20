import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { request } from 'http';

// ─── 批 4b:Web 试玩闭环测试 ───────────────────────────────────────────────────

const FAKE_HOME = mkdtempSync(join(tmpdir(), 'gme-web-'));
const FAKE_APPDATA = join(FAKE_HOME, 'AppData', 'Roaming');
beforeAll(() => {
  vi.stubEnv('HOME', FAKE_HOME);
  vi.stubEnv('USERPROFILE', FAKE_HOME);
  vi.stubEnv('APPDATA', FAKE_APPDATA);
});
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(FAKE_HOME, { recursive: true, force: true });
});

const exporter = await import('../src/cli/web-exporter.js');
const server = await import('../src/cli/web-server.js');

describe('export templates 目录与检测', () => {
  it('templatesDirFor 平台形态(AppData/Godot/export_templates/<ver>)', () => {
    expect(exporter.templatesDirFor('4.7.2.stable')).toBe(join(FAKE_APPDATA, 'Godot', 'export_templates', '4.7.2.stable'));
  });

  it('isWebTemplatesInstalled:wasm(≤4.5)或 zip(4.6+)存在即 true', () => {
    expect(exporter.isWebTemplatesInstalled('9.9.9.stable')).toBe(false);
    const tdir = join(FAKE_APPDATA, 'Godot', 'export_templates', '9.9.8.stable');
    mkdirSync(tdir, { recursive: true });
    writeFileSync(join(tdir, 'web_release.zip'), 'x');
    expect(exporter.isWebTemplatesInstalled('9.9.8.stable')).toBe(true);
    const tdir2 = join(FAKE_APPDATA, 'Godot', 'export_templates', '9.9.7.stable');
    mkdirSync(tdir2, { recursive: true });
    writeFileSync(join(tdir2, 'web_release.wasm'), 'x');
    expect(exporter.isWebTemplatesInstalled('9.9.7.stable')).toBe(true);
  });

  it('资产名模板:版本串校验 + {v} 占位', () => {
    expect(exporter.exportTemplatesAssetTemplate('4.7.2.stable')).toBe('Godot_v{v}-stable_export_templates.tpz');
    expect(() => exporter.exportTemplatesAssetTemplate('evil')).toThrow();
    expect(() => exporter.exportTemplatesAssetTemplate('4.8-dev')).toThrow();
  });
});

describe('ensureWebPreset', () => {
  it('无 cfg 生成含 Web preset;已有则不覆盖', () => {
    const proj = mkdtempSync(join(tmpdir(), 'gme-preset-'));
    expect(exporter.ensureWebPreset(proj)).toBe(true);
    const cfg = readFileSync(join(proj, 'export_presets.cfg'), 'utf-8');
    expect(cfg).toContain('name="Web"');
    expect(cfg).toContain('platform="Web"');
    expect(cfg).toContain('export_path="build/web/index.html"');
    // 已存在不覆盖
    writeFileSync(join(proj, 'export_presets.cfg'), 'custom', 'utf-8');
    expect(exporter.ensureWebPreset(proj)).toBe(false);
    expect(readFileSync(join(proj, 'export_presets.cfg'), 'utf-8')).toBe('custom');
    rmSync(proj, { recursive: true, force: true });
  });
});

describe('sanitizeRequestPath(路径穿越防护)', () => {
  const root = mkdtempSync(join(tmpdir(), 'gme-sanitize-'));
  it('普通相对路径放行并归一到 root 下', () => {
    const p = server.sanitizeRequestPath('index.html', root);
    expect(p).toBe(join(root, 'index.html'));
    expect(server.sanitizeRequestPath('sub/a.js', root)).toBe(join(root, 'sub', 'a.js'));
  });
  it('穿越形态全拒:../、绝对、盘符、反斜杠、编码', () => {
    for (const evil of ['../secret.txt', 'a/../../etc/passwd', '/etc/passwd', 'C:/x', 'C:\\x', '..%2Fsecret', '%2e%2e/secret', 'a\\..\\..\\x']) {
      expect(() => server.sanitizeRequestPath(evil, root)).toThrow(/traversal/i);
    }
  });
  it('normalize 后逃出 root 的形态拒绝(如 a/./.. 归一越界)', () => {
    expect(() => server.sanitizeRequestPath('a/./../../x', root)).toThrow(/traversal|escaped/i);
  });
});

describe('startWebServer(真 HTTP 往返)', () => {
  const root = mkdtempSync(join(tmpdir(), 'gme-httpd-'));
  writeFileSync(join(root, 'index.html'), '<html>PLAY</html>', 'utf-8');
  writeFileSync(join(root, 'game.pck'), Buffer.alloc(16, 7), 'utf-8' as never);
  let running: Awaited<ReturnType<typeof server.startWebServer>> | null = null;

  it('index.html 200 + text/html;pck 200 + octet-stream', async () => {
    running = await server.startWebServer(root, 0);
    expect(running.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const html = await get(running.url);
    expect(html.status).toBe(200);
    expect(html.headers['content-type']).toContain('text/html');
    expect(html.body).toContain('PLAY');
    const pck = await get(`${running.url}game.pck`);
    expect(pck.status).toBe(200);
    expect(pck.headers['content-type']).toBe('application/octet-stream');
  });

  it('404(缺失)/405(POST)/403(穿越)', async () => {
    if (!running) throw new Error('server not started');
    expect((await get(`${running.url}missing.js`)).status).toBe(404);
    expect((await post(running.url)).status).toBe(405);
    // 注:%2e%2e 会被规范 URL 客户端(new URL)消段,到达服务器时已无害;服务器侧
    // 防护针对 raw 客户端(直接发原始串)——用 {path} 形态绕过客户端规范化直发
    expect((await get(`${running.url}..%2F..%2Fsecret`)).status).toBe(403);
    expect((await getRawPath(running.port, '/%2e%2e/x')).status).toBe(403);
    expect((await getRawPath(running.port, '/..%2F..%2Fsecret')).status).toBe(403);
    expect((await getRawPath(running.port, '/a/..%5C..%5Cx')).status).toBe(403);
  });

  it('close 后端口释放', async () => {
    if (!running) throw new Error('server not started');
    await running.close();
    await expectAsyncGetFailure(running.url);
  });
});

// ── http helpers ─────────────────────────────────────────────────────────────

function get(url: string): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolveP, rejectP) => {
    const req = request(url, { method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolveP({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', rejectP);
    req.end();
  });
}

function getRawPath(port: number, rawPath: string): Promise<{ status: number }> {
  return new Promise((resolveP, rejectP) => {
    const req = request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, (res) => {
      res.resume();
      res.on('end', () => resolveP({ status: res.statusCode ?? 0 }));
    });
    req.on('error', rejectP);
    req.end();
  });
}

function post(url: string): Promise<{ status: number }> {
  return new Promise((resolveP, rejectP) => {
    const req = request(url, { method: 'POST' }, (res) => {
      res.resume();
      res.on('end', () => resolveP({ status: res.statusCode ?? 0 }));
    });
    req.on('error', rejectP);
    req.end();
  });
}

function expectAsyncGetFailure(url: string): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    const req = request(url, { method: 'GET' }, () => rejectP(new Error('should be closed')));
    req.on('error', () => resolveP());
    req.end();
    setTimeout(() => rejectP(new Error('timeout: server still up')), 2000).unref?.();
  });
}
