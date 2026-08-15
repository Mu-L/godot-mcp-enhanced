import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, symlinkSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHmac } from 'node:crypto';
import {
  generateApiToken,
  verifyApiToken,
  buildAuthHeaders,
  clearCachedSecret,
  getOrCreateApiSecret,
} from '../../src/core/instance-api-auth.js';

// 将 homedir mock 到临时目录，避免污染真实环境
const MOCK_HOME = join(tmpdir(), `mcp-auth-test-${Date.now()}`);
const MOCK_REGISTRY = join(MOCK_HOME, '.godot-mcp');

// Mock homedir
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => MOCK_HOME };
});

describe('instance-api-auth', () => {
  // 探测文件 symlink 支持(Windows 需管理员/开发者模式;CI Linux 可)。
  // 定义在外层 describe:B-4 的 .api-nonces.json symlink 用例共用。
  const SYMLINK_SUPPORTED = (() => {
    try {
      const d = join(tmpdir(), `sym-probe-${Date.now()}`);
      mkdirSync(d, { recursive: true });
      symlinkSync(join(d, 't'), join(d, 'l'));
      rmSync(d, { recursive: true, force: true });
      return true;
    } catch { return false; }
  })();

  beforeEach(() => {
    clearCachedSecret();
    mkdirSync(MOCK_REGISTRY, { recursive: true });
  });

  afterEach(() => {
    clearCachedSecret();
    try { rmSync(MOCK_HOME, { recursive: true, force: true }); } catch { /* ok */ }
  });

  describe('getOrCreateApiSecret', () => {
    it('generates a new secret when none exists', () => {
      const secret = getOrCreateApiSecret();
      expect(secret).toBeDefined();
      expect(secret.length).toBeGreaterThanOrEqual(64); // 32 bytes hex

      // 验证文件已写入
      const secretPath = join(MOCK_REGISTRY, '.api-secret');
      expect(existsSync(secretPath)).toBe(true);
      expect(readFileSync(secretPath, 'utf-8').trim()).toBe(secret);
    });

    it('reads existing secret from file', () => {
      const preset = 'a'.repeat(64);
      writeFileSync(join(MOCK_REGISTRY, '.api-secret'), preset, 'utf-8');

      const secret = getOrCreateApiSecret();
      expect(secret).toBe(preset);
    });

    it('regenerates if existing secret is too short', () => {
      writeFileSync(join(MOCK_REGISTRY, '.api-secret'), 'tooshort', 'utf-8');

      const secret = getOrCreateApiSecret();
      expect(secret.length).toBeGreaterThanOrEqual(64);
      expect(secret).not.toBe('tooshort');
    });

    // 阶段4-3 (Imp-9 对齐 editor-auth): symlink rejection(探测常量 SYMLINK_SUPPORTED 在外层 describe)
    it.skipIf(!SYMLINK_SUPPORTED)('refuses to read symlinked secret, regenerates instead (阶段4-3)', () => {
      // 攻击者把 .api-secret 换成 symlink 指向 ≥32 字符文件,试图控制/泄露 secret
      const target = join(MOCK_HOME, 'attacker-controlled');
      writeFileSync(target, 'x'.repeat(64), 'utf-8');
      symlinkSync(target, join(MOCK_REGISTRY, '.api-secret'));

      const secret = getOrCreateApiSecret();
      // 不应返回 symlink 目标内容(否则攻击者控制了认证密钥)
      expect(secret).not.toBe('x'.repeat(64));
      expect(secret.length).toBeGreaterThanOrEqual(64);
    });
  });

  describe('generateApiToken + verifyApiToken', () => {
    it('generates verifiable tokens', () => {
      const token = generateApiToken('inst-1');
      expect(token).toContain('.');
      expect(verifyApiToken('inst-1', token)).toBe(true);
    });

    it('rejects wrong instance id', () => {
      const token = generateApiToken('inst-1');
      expect(verifyApiToken('inst-2', token)).toBe(false);
    });

    it('rejects malformed tokens', () => {
      expect(verifyApiToken('inst-1', '')).toBe(false);
      expect(verifyApiToken('inst-1', 'no-dot')).toBe(false);
      expect(verifyApiToken('inst-1', 'abc.123')).toBe(false);
      // C-02: 旧格式（无 nonce）应被拒绝
      expect(verifyApiToken('inst-1', '1234567890.abcdef1234567890')).toBe(false);
    });

    it('rejects expired tokens', () => {
      vi.useFakeTimers();
      try {
        const token = generateApiToken('inst-1');
        // 推进 61 秒，超过 TOKEN_TTL_MS
        vi.advanceTimersByTime(61_000);
        expect(verifyApiToken('inst-1', token)).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('rejects replayed tokens (nonce anti-replay)', () => {
      const token = generateApiToken('inst-1');
      expect(verifyApiToken('inst-1', token)).toBe(true);
      // 同一 token 第二次使用应被拒绝
      expect(verifyApiToken('inst-1', token)).toBe(false);
    });

    it('forged token does not pollute nonce pool (A-2: nonce recorded only after HMAC passes)', () => {
      const token = generateApiToken('inst-1'); // 有效: nonce=N, hmac=H
      const parts = token.split('.');
      // 篡改 HMAC 段(保持长度)→ 伪造 token: 同 nonce=N, 错误签名
      const forged = `${parts[0]!}.${parts[1]!}.${'0'.repeat(parts[2]!.length)}`;
      expect(verifyApiToken('inst-1', forged)).toBe(false); // HMAC 错 → 拒绝
      // 原有效 token 仍可用:伪造 token 未污染 nonce N(修复前此处因 nonce 被占会失败)
      expect(verifyApiToken('inst-1', token)).toBe(true);
    });

    it('A6: rejects far-future timestamps (future-skew upper bound)', () => {
      // 构造远未来 timestamp 的 token:原校验只查过去方向,now+1年的 token 在真实时间
      // 追上前持续有效。需用真实 secret 自签(HMAC 必须正确才能到达时效分支之后被拒)。
      const secret = getOrCreateApiSecret();
      const futureTs = (Date.now() + 365 * 24 * 3600 * 1000).toString();
      const nonce = 'deadbeefdeadbeef';
      const hmac = createHmac('sha256', secret).update(`inst-1:${futureTs}:${nonce}`).digest('hex');
      const futureToken = `${futureTs}.${nonce}.${hmac}`;
      expect(verifyApiToken('inst-1', futureToken)).toBe(false);
    });

    it('A6: nonce replay window survives restart (persistence across clearCachedSecret)', () => {
      const token = generateApiToken('inst-1');
      expect(verifyApiToken('inst-1', token)).toBe(true);
      // clearCachedSecret 清内存 Map + 重置懒加载标记 = 模拟 server 重启
      // (修复前:重启后 _usedNonces 空,60s TTL 内同 token 可重放)
      clearCachedSecret();
      expect(verifyApiToken('inst-1', token)).toBe(false);  // 从盘上回载的 nonce 仍拒重放
    });
  });

  // B-4 (2026-08-14): .api-nonces.json 持久化缺 symlink 预检。
  // _persistNonces 裸 writeFileSync,攻击者预置 .api-nonces.json 为 symlink → 每次合法
  // 验签跟随 symlink 覆盖任意文件(固定格式 JSON)。威胁模型与 .api-secret symlink
  // (阶段4-3 已修,:64-69 lstatSync 预检)完全一致。修复:safeWriteNoSymlink 两处共用
  // + 读侧 _loadPersistedNonces 同检。
  describe('B-4: .api-nonces.json symlink 预检', () => {
    it.skipIf(!SYMLINK_SUPPORTED)('B4-1 预置 symlink → 写入被拒(victim 内容未被覆写,降级不阻断认证)', () => {
      getOrCreateApiSecret(); // 确保-secret 存在,token 验签走真实 secret
      // 攻击者预置:.api-nonces.json 是 symlink → victim 文件(含诱饵内容)
      const victim = join(MOCK_HOME, 'victim-config.json');
      const victimOriginal = '{"user_setting": "do-not-overwrite"}';
      writeFileSync(victim, victimOriginal, 'utf-8');
      symlinkSync(victim, join(MOCK_REGISTRY, '.api-nonces.json'));

      // 合法验签成功 → 内部 _persistNonces 尝试落盘 → symlink 预检拒写
      const token = generateApiToken('inst-1');
      expect(verifyApiToken('inst-1', token)).toBe(true); // 拒写不阻断认证(降级内存-only)

      // victim 文件未被覆写(内容保持),symlink 本身也未被替换成真文件
      expect(readFileSync(victim, 'utf-8')).toBe(victimOriginal);
      expect(lstatSync(join(MOCK_REGISTRY, '.api-nonces.json')).isSymbolicLink()).toBe(true);
    });

    it.skipIf(!SYMLINK_SUPPORTED)('B4-2 读侧 symlink 不回载(攻击者伪造的 nonce 池不生效)', () => {
      getOrCreateApiSecret();
      // 攻击者预置 symlink 指向伪造 nonce 池:声称 inst-1:<nonce> 已使用
      const fakePool = join(MOCK_HOME, 'fake-nonces.json');
      const secret = getOrCreateApiSecret();
      const nonce = 'cafebabecafebabe';
      const ts = (Date.now() - 1000).toString(); // TTL 内
      writeFileSync(fakePool, JSON.stringify({ [`inst-1:${nonce}`]: Date.now() }), 'utf-8');
      symlinkSync(fakePool, join(MOCK_REGISTRY, '.api-nonces.json'));

      // 用该 nonce 自签合法 token:若读侧 follow symlink,nonce 被"预标记已用" → 拒绝(DoS);
      // 修复后读侧不读 symlink → 验签正常通过
      const hmac = createHmac('sha256', secret).update(`inst-1:${ts}:${nonce}`).digest('hex');
      const token = `${ts}.${nonce}.${hmac}`;
      expect(verifyApiToken('inst-1', token)).toBe(true);
    });

    it('B4-3 正常路径写入读取往返不受影响(.api-nonces.json 为真文件且内容合法)', () => {
      const token = generateApiToken('inst-1');
      expect(verifyApiToken('inst-1', token)).toBe(true);
      const storePath = join(MOCK_REGISTRY, '.api-nonces.json');
      expect(existsSync(storePath)).toBe(true);
      expect(lstatSync(storePath).isSymbolicLink()).toBe(false); // 真文件非 symlink
      const stored = JSON.parse(readFileSync(storePath, 'utf-8')) as Record<string, number>;
      expect(Object.keys(stored).length).toBeGreaterThan(0);
      // 重启(清内存)后重放仍被拒 = 读回载生效
      clearCachedSecret();
      expect(verifyApiToken('inst-1', token)).toBe(false);
    });
  });

  describe('buildAuthHeaders', () => {
    it('includes Authorization Bearer header', () => {
      const headers = buildAuthHeaders('inst-1');
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Authorization']).toMatch(/^Bearer \d+\.[a-f0-9]+\.[a-f0-9]+$/);
    });
  });
});
