import { promises as fs } from 'fs';
import { join, basename, isAbsolute, relative } from 'path';

export interface SkillMatch {
  source: string;
  path: string;
  name: string;
  description: string;
  score: number;
  snippet: string;
}

export interface MissingLibrary {
  path: string;
  reason: string;
}

export interface SearchResult {
  matches: SkillMatch[];
  missing: MissingLibrary[];
}

interface ParsedSkill {
  name: string;
  description: string;
  body: string;
}

function parseSkill(content: string, fallbackName: string): ParsedSkill {
  let name = fallbackName;
  let description = '';
  let body = content;
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (fm) {
    const frontmatter = fm[1] ?? '';
    body = fm[2] ?? '';
    const nm = frontmatter.match(/^name:\s*(.+)$/m);
    if (nm?.[1]) name = nm[1].trim();
    const dm = frontmatter.match(/^description:\s*(.+)$/m);
    if (dm?.[1]) description = dm[1].trim();
  }
  return { name, description, body };
}

function scoreMatch(query: string, name: string, description: string, body: string): number {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 0;
  const n = name.toLowerCase();
  const d = description.toLowerCase();
  const b = body.toLowerCase();
  let total = 0;
  for (const term of terms) {
    let s = 0;
    if (n.includes(term)) s = Math.max(s, 1.0);
    if (d.includes(term)) s = Math.max(s, 0.6);
    if (b.includes(term)) s = Math.max(s, 0.3);
    total += s;
  }
  return total / terms.length;
}

async function* walkMd(dir: string): AsyncGenerator<string> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    // 子目录读取失败(权限/竞态)静默跳过;根目录缺失已由外层 realpath 兜住
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkMd(full);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      yield full;
    }
  }
}

function validateLibraryPath(p: string): { ok: true } | { ok: false; reason: string } {
  if (!p || typeof p !== 'string' || p.trim() === '') return { ok: false, reason: 'empty path' };
  if (p.split(/[/\\]/).includes('..')) return { ok: false, reason: 'traversal detected' };
  if (!isAbsolute(p)) return { ok: false, reason: 'not absolute path' };
  return { ok: true };
}

// ─── CRITICAL 脚本警示(来源:godot-ai-kit docs/enhanced-load-skill-warning-requirement.md,spec §4.3)───
// load_skill 召回 .md 文档;若所属 skill 含已知 CRITICAL 脚本,在 snippet 末尾附 warning,提示参考代码
// 复制到生产前必须人工审。命中按 skill 名(match.path 含 <skill>/ 段),非精确 .gd 路径(.md≠.gd)。
// 详见 godot-ai-kit docs/enhanced-boundaries.md #12。
interface CriticalItem { cid: string; desc: string; }

const CRITICAL_SKILLS: { skill: string; items: CriticalItem[] }[] = [
  {
    skill: 'godot-adapt-desktop-to-mobile',
    items: [
      { cid: 'C1', desc: '硬编码密钥+无完整性校验' },
      { cid: 'C2', desc: '缺 InputEventMouseButton 分支' },
      { cid: 'C3', desc: 'zoom.x 单分量非等比缩放' },
    ],
  },
  {
    skill: 'godot-3d-lighting',
    items: [
      { cid: 'C4', desc: '动态光泄漏' },
      { cid: 'C5', desc: 'visible 硬切换与 distance_fade 冲突' },
    ],
  },
  {
    skill: 'godot-3d-materials',
    items: [{ cid: 'C6', desc: '未判 null 必崩' }],
  },
];

/** 召回 .md 路径所属 skill 含 CRITICAL 时返回其 CRITICAL 列表,否则 null。 */
function findCritical(mdPath: string): CriticalItem[] | null {
  const norm = mdPath.replace(/\\/g, '/');
  for (const s of CRITICAL_SKILLS) {
    if (norm === s.skill || norm.startsWith(s.skill + '/') || norm.includes('/' + s.skill + '/')) {
      return s.items;
    }
  }
  return null;
}

function buildWarning(items: CriticalItem[]): string {
  const label = items.map(i => `${i.cid} ${i.desc}`).join(' / ');
  return `\n\n⚠️ 参考代码含已知 CRITICAL(${label}),复制到生产前必须人工审。详见 godot-ai-kit docs/enhanced-boundaries.md #12。`;
}

export async function searchSkills(
  libraries: string[],
  query: string,
  limit = 10
): Promise<SearchResult> {
  const matches: SkillMatch[] = [];
  const missing: MissingLibrary[] = [];
  const q = (query ?? '').trim();

  for (const lib of libraries) {
    const v = validateLibraryPath(lib);
    if (!v.ok) {
      missing.push({ path: lib, reason: v.reason });
      continue;
    }
    let real: string;
    try {
      real = await fs.realpath(lib);
    } catch {
      missing.push({ path: lib, reason: 'not found' });
      continue;
    }
    const source = basename(real);
    for await (const filePath of walkMd(real)) {
      let content: string;
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch {
        continue;
      }
      const { name, description, body } = parseSkill(content, basename(filePath, '.md'));
      const score = q ? scoreMatch(q, name, description, body) : 0;
      if (score > 0) {
        const relPath = relative(real, filePath) || filePath;
        const crit = findCritical(relPath);
        matches.push({
          source,
          path: relPath,
          name,
          description,
          score,
          snippet: crit ? `${body.slice(0, 200).trim()}${buildWarning(crit)}` : body.slice(0, 200).trim(),
        });
      }
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return { matches: matches.slice(0, limit), missing };
}
