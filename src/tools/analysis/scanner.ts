// src/tools/analysis/scanner.ts — 项目级静态扫描（.tscn 解析 + node→脚本 映射）
//
// C 批（v0.30）理解层底座：scanFiles + parseTscn 的组合此前不存在（最近先例是
// delivery.ts 的 buildSceneContentCache，只缓存原文不解析）。本模块补上项目级
// 结构化扫描，signal_map / impact_check 共用。单次调用内完成，不做跨调用缓存
// （分析类调用低频，避免失效语义）。

import { readFileSync } from 'fs';
import { relative } from 'path';
import { scanFiles } from '../../core/file-scanner.js';
import { parseTscn, type ParsedScene, type ParsedNode, type ExtResource } from '../../tscn/tscn-parser.js';

export interface SceneScan {
  /** res:// 相对路径 */
  scenePath: string;
  absPath: string;
  parsed: ParsedScene | null;
  parseError?: string;
}

export interface ProjectScan {
  root: string;
  scenes: SceneScan[];
  /** res:// 相对 .gd 路径 */
  scripts: string[];
  stats: {
    sceneCount: number;
    scriptCount: number;
    connectionCount: number;
    parseErrors: number;
  };
}

/** 绝对路径 → res:// 相对（正斜杠） */
export function toResPath(root: string, absPath: string): string {
  const rel = relative(root, absPath).replace(/\\/g, '/');
  return rel.startsWith('res://') ? rel : `res://${rel}`;
}

/** 项目级扫描：全部 .tscn 逐个 parse + 全部 .gd 列表 */
export function scanProject(projectPath: string): ProjectScan {
  const sceneFiles = scanFiles(projectPath, ['.tscn']);
  const scriptFiles = scanFiles(projectPath, ['.gd']);

  const scenes: SceneScan[] = sceneFiles.map(abs => {
    const entry: SceneScan = { scenePath: toResPath(projectPath, abs), absPath: abs, parsed: null };
    try {
      entry.parsed = parseTscn(readFileSync(abs, 'utf-8'));
    } catch (err) {
      entry.parseError = err instanceof Error ? err.message : String(err);
    }
    return entry;
  });

  return {
    root: projectPath,
    scenes,
    scripts: scriptFiles.map(abs => toResPath(projectPath, abs)),
    stats: {
      sceneCount: scenes.length,
      scriptCount: scriptFiles.length,
      connectionCount: scenes.reduce((n, s) => n + (s.parsed?.connections.length ?? 0), 0),
      parseErrors: scenes.filter(s => s.parseError).length,
    },
  };
}

/** 节点绑定的脚本 res:// 路径（script = ExtResource("id") → extResources.path）。无脚本返回 null。 */
export function nodeScriptPath(node: ParsedNode, scene: ParsedScene): string | null {
  const scriptProp = node.properties.find(
    p => p.name === 'script' && p.value && typeof p.value === 'object' && (p.value as { __type?: string }).__type === 'ExtResource',
  );
  if (!scriptProp) return null;
  const id = (scriptProp.value as { id: string | number }).id;
  const ext = scene.extResources.find((e: ExtResource) => e.id === id && String(e.type).toLowerCase().includes('script'));
  // 宽容回退：按 id 匹配不到 type 时仍取同 id 资源（脚本 ext_resource type=Script）
  const extAny = ext ?? scene.extResources.find(e => e.id === id);
  return extAny?.path ?? null;
}

/** 场景内全部 node→脚本 对（含递归子节点）。instance 场景的脚本在子场景文件内，不在此列。 */
export function sceneScriptBindings(scene: ParsedScene): Array<{ nodePath: string; scriptPath: string }> {
  const out: Array<{ nodePath: string; scriptPath: string }> = [];
  const walk = (node: ParsedNode, prefix: string): void => {
    const path = prefix ? `${prefix}/${node.name}` : node.name;
    const sp = nodeScriptPath(node, scene);
    if (sp) out.push({ nodePath: path, scriptPath: sp });
    for (const c of node.children) walk(c, path);
  };
  for (const n of scene.nodes) walk(n, '');
  return out;
}
