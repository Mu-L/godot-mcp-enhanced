/**
 * 批 4b:零依赖静态文件服务器(127.0.0.1 专用)——serve Web 导出目录供浏览器试玩。
 *
 * 安全(spec §3 批 4b):仅绑定回环地址(不对外);路径穿越防护复用 core/path-utils
 * resolveWithinRoot(2026-08-21 架构审查 MEDIUM-3:迭代解码+realpath+symlink 防护的
 * 最强实现,替代本地 normalize+前缀弱化版——导出目录内 symlink 指向根外会被拒);
 * 目录不列不 serve(仅文件);无 CGI/无上传。Host 校验拒 DNS rebinding;
 * nosniff + SVG 内嵌脚本风险由 X-Content-Type-Options 缓解。
 */
import { createServer, type Server } from 'http';
import { createReadStream, existsSync, statSync } from 'fs';
import { join, extname, normalize } from 'path';
import { InternalError } from '../core/tool-errors.js';
import { resolveWithinRoot } from '../core/path-utils.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.pck': 'application/octet-stream',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.css': 'text/css',
};

/** 请求路径安全化:返回相对 root 的绝对文件路径;穿越形态 → throw(403)。
 *  MEDIUM-3(2026-08-21):核心校验下沉到 core/path-utils.resolveWithinRoot
 *  (迭代解码+realpath+symlink 防护);此处仅做 URL 层预解码与空路径映射。 */
export function sanitizeRequestPath(rawUrlPath: string, rootDir: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawUrlPath);
  } catch {
    throw new InternalError('path traversal: bad encoding');
  }
  const cleaned = decoded.replace(/\\/g, '/');
  if (cleaned.startsWith('/') || /^[a-zA-Z]:/.test(cleaned)) {
    throw new InternalError(`path traversal rejected: ${rawUrlPath}`);
  }
  const rel = cleaned === '' ? 'index.html' : cleaned;
  return resolveWithinRoot(rootDir, rel);
}

/** Host 校验(防 DNS rebinding):仅放行回环主机名,其余(远程域名解析到 127.0.0.1)403。 */
function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return true;  // HTTP/1.0 无 Host 头,非 rebinding 场景,放行
  const hostname = host.split(':')[0]!.toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export interface RunningWebServer {
  server: Server;
  url: string;
  port: number;
  close(): Promise<void>;
}

/** 起服务器(仅 127.0.0.1);listening 后 resolve。port=0 让系统分配。 */
export function startWebServer(rootDir: string, portInput = 0): Promise<RunningWebServer> {
  if (!existsSync(rootDir) || !statSync(rootDir).isDirectory()) {
    return Promise.reject(new InternalError(`serve root is not a directory: ${rootDir}`));
  }
  const root = normalize(rootDir);
  return new Promise<RunningWebServer>((resolveObj, rejectObj) => {
    const server = createServer((req, res) => {
      if (!isLoopbackHost(req.headers.host)) {
        res.writeHead(403, { 'content-type': 'text/plain' });
        res.end('forbidden host');
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'content-type': 'text/plain' });
        res.end('method not allowed');
        return;
      }
      let filePath: string;
      try {
        filePath = sanitizeRequestPath((req.url ?? '/').split('?')[0]!.slice(1), root);
      } catch {
        res.writeHead(403, { 'content-type': 'text/plain' });
        res.end('forbidden');
        return;
      }
      let stat;
      try {
        stat = statSync(filePath);
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      if (stat.isDirectory()) {
        filePath = join(filePath, 'index.html');
        try {
          stat = statSync(filePath);
        } catch {
          res.writeHead(404, { 'content-type': 'text/plain' });
          res.end('not found');
          return;
        }
      }
      res.writeHead(200, {
        'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        'content-length': stat.size,
        'cache-control': 'no-store',
        // MINOR(2026-08-21 架构审查):SVG 内嵌脚本等嗅探向量缓解
        'x-content-type-options': 'nosniff',
      });
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = createReadStream(filePath);
      // N-2(审查):stat 后文件被删/独占时 open 失败若无监听会崩掉常驻 serve 进程
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    });
    server.on('error', (err) => {
      rejectObj(new InternalError(`web server error: ${(err as Error).message}`));
    });
    server.listen(portInput, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : portInput;
      resolveObj({
        server,
        port,
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}
