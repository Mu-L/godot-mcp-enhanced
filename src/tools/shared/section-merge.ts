// src/tools/shared/section-merge.ts
// 共享的 markdown section 解析/合并逻辑，供 claudemd-builder（CLAUDE.md）与
// agentsmd-builder（AGENTS.md）复用。参数化 sectionIds 以区分两套 MCP 管控段白名单。

export type SectionIdSet = Set<string>;

export interface Section {
  header: string;
  headerNorm: string;
  body: string;
  isMcp: boolean;
}

export function normalizeHeader(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

export function parseSections(content: string, sectionIds: SectionIdSet): {
  title: string;
  preSections: string;
  sections: Section[];
} {
  const lines = content.split('\n');

  // Extract title (# ...)
  let title = '';
  let titleEndIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^# /.test(lines[i]!)) {
      title = lines[i]!;
      titleEndIdx = i + 1;
      break;
    }
  }

  // Collect text between title and first ## header
  let preSections = '';
  let firstSectionIdx = lines.length;
  for (let i = titleEndIdx; i < lines.length; i++) {
    if (/^## (?!#)/.test(lines[i]!)) {
      firstSectionIdx = i;
      break;
    }
    preSections += (preSections ? '\n' : '') + lines[i]!;
  }
  preSections = preSections.trim();

  // Parse ## sections
  const sections: Section[] = [];
  let current: Section | null = null;
  for (let i = firstSectionIdx; i < lines.length; i++) {
    const headerMatch = lines[i]!.match(/^## (?!#)\s*(.*)/);
    if (headerMatch) {
      if (current) sections.push(current);
      const fullHeader = '## ' + headerMatch[1]!.trim();
      const norm = normalizeHeader(fullHeader);
      current = {
        header: fullHeader,
        headerNorm: norm,
        body: '',
        isMcp: sectionIds.has(norm),
      };
    } else if (current) {
      current.body += (current.body ? '\n' : '') + lines[i];
    }
  }
  if (current) sections.push(current);

  return { title, preSections, sections };
}

export function mergeSections(
  existing: string,
  newSections: Array<[string, string]>,
  sectionIds: SectionIdSet,
): string {
  if (!existing.trim()) {
    return newSections.map(([h, b]) => `${h}\n${b}`).join('\n\n') + '\n';
  }

  const { title, preSections, sections } = parseSections(existing, sectionIds);

  // Collect user (non-MCP) sections in original order
  const userSections = sections.filter(s => !s.isMcp);

  // Build output
  const parts: string[] = [];
  if (title) parts.push(title);

  // New MCP sections
  for (const [header, body] of newSections) {
    parts.push(`${header}\n${body}`);
  }

  // User pre-section text
  if (preSections !== '') parts.push(preSections);

  // User sections
  for (const s of userSections) {
    parts.push(s.body.trim() ? `${s.header}\n${s.body}` : s.header);
  }

  return parts.join('\n\n') + '\n';
}
