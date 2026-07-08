/**
 * Tool module auto-registration — C-ARCH-01
 *
 * Centralizes all tool module imports and registration in one place.
 * GodotServer.ts only needs to call registerAllModules().
 * Adding a new tool module requires editing ONLY this file.
 */

import { registerModule, TOOL_GROUPS, getToolMeta, type RiskLevel } from './tool-registry.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// ─── Tool module imports ─────────────────────────────────────────────────────
import * as runtime from '../tools/runtime.js';
import * as screenshot from '../tools/screenshot.js';
import * as project from '../tools/project.js';
import * as scene from '../tools/scene.js';
import * as script from '../tools/script.js';
import * as validation from '../tools/validation.js';
import * as docs from '../tools/docs.js';
import * as physicsOps from '../tools/physics-ops.js';
import * as audioOps from '../tools/audio-ops.js';
import * as tilemapOps from '../tools/tilemap-ops.js';
import * as materialOps from '../tools/material-ops.js';
import * as gameBridge from '../tools/game-bridge.js';
import * as workflow from '../tools/workflow.js';
import * as animationOps from '../tools/animation/animation-ops.js';
import * as profilerOps from '../tools/profiler-ops.js';
// test-framework → merged into validation (v0.18.0)
// import * as testFramework from '../tools/test-framework.js';
import * as animtreeOps from '../tools/animtree.js';
import * as navigationOps from '../tools/navigation.js';
import * as particlesOps from '../tools/particles.js';
import * as signalOps from '../tools/signal-ops.js';
// batch-tools → merged into workflow (v0.18.0)
// import * as batchTools from '../tools/batch-tools.js';
import * as uiOps from '../tools/ui-tools.js';
// recording → merged into runtime (v0.18.0)
// import * as recordingOps from '../tools/recording.js';
import * as editorSync from '../tools/editor-sync.js';
import * as animationTrack from '../tools/animation/animation-track.js';
// delivery → merged into validation (v0.18.0)
// import * as delivery from '../tools/delivery.js';
// code-templates → merged into project (v0.18.0)
// import * as codeTemplates from '../tools/code-templates.js';
// ik-tools → merged into animation-ops (v0.18.0)
// import * as ikTools from '../tools/ik-tools.js';
// game-design → merged into validation (v0.18.0)
// import * as gameDesign from '../tools/game-design.js';
import * as manageTools from '../tools/manage-tools.js';
import * as instanceTools from '../tools/instance-tools.js';
import * as advancedProxy from '../tools/advanced-proxy.js';
import * as loadSkill from '../tools/load-skill.js';
import * as androidOps from '../tools/android.js';
import * as cpp from '../tools/cpp.js';
import * as dataImport from '../tools/data-import.js';
import * as getContext from '../tools/get-context.js';
import * as asset from '../tools/asset/asset-ops.js';

// ─── Registration ─────────────────────────────────────────────────────────────

/** All tool modules in registration order. */
const ALL_MODULES = [
  runtime, screenshot, project, scene, script, validation, docs,
  physicsOps, audioOps, tilemapOps, materialOps,
  gameBridge, workflow, animationOps, animationTrack, profilerOps,
  /* testFramework → validation */ animtreeOps, navigationOps, particlesOps,
  signalOps, /* batchTools → workflow */ uiOps, /* recordingOps → runtime */ editorSync,
  /* delivery → validation */ /* codeTemplates → project */ /* ikTools → animation-ops */ /* gameDesign → validation */ manageTools, instanceTools, advancedProxy,
  loadSkill,
  androidOps,
  cpp,
  dataImport,
  getContext,
  asset,
];

// ─── Tag injection ─────────────────────────────────────────────────────────────

/** Build tool→group mapping for tag injection. */
function buildToolGroupMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const [group, def] of Object.entries(TOOL_GROUPS)) {
    for (const tool of def.tools) {
      map.set(tool, group);
    }
  }
  return map;
}

const toolGroupMap = buildToolGroupMap();

/**
 * Derive MCP-standard ToolAnnotations hints from a tool's actionRisks.
 *
 * Maps the project's internal RiskLevel taxonomy (read/write/destructive/process)
 * to the four MCP-standard hints (spec 2025-06-18). Clients use these to decide
 * whether to prompt for user confirmation before executing the tool.
 *
 * Rules (conservative — never over-claim safety):
 * - readOnlyHint:    true only if every action is 'read'
 * - destructiveHint: true if any action is 'destructive'
 * - idempotentHint:  true only if readOnlyHint (side-effect-free ⇒ re-runnable)
 * - openWorldHint:   omitted (tools operate on Godot's closed world; default false)
 *
 * Tools without actionRisks default to write semantics (readOnlyHint=false),
 * matching the registry's default readonly=false for untagged tools (A-10).
 */
function deriveMcpHints(actionRisks?: Record<string, RiskLevel>): {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
} {
  if (!actionRisks) {
    return { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
  }
  const risks = Object.values(actionRisks);
  if (risks.length === 0) {
    return { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
  }
  const hasDestructive = risks.some(r => r === 'destructive');
  const hasWrite = risks.some(r => r === 'write' || r === 'destructive' || r === 'process');
  const isReadOnly = !hasWrite; // every action is 'read'
  return {
    readOnlyHint: isReadOnly,
    destructiveHint: hasDestructive,
    idempotentHint: isReadOnly,
  };
}

/**
 * Inject annotations.tags (group:xxx) AND MCP-standard hints into tool definitions.
 *
 * Tags come from the TOOL_GROUPS mapping. Hints come from each tool's actionRisks
 * via deriveMcpHints. Manually-set hints on a tool definition take precedence —
 * auto-derivation only fills hints the tool author left unset, so explicit
 * annotations (e.g. marking a tool destructiveHint=true manually) are respected.
 */
function injectTags(defs: Tool[]): Tool[] {
  return defs.map(def => {
    const hints = deriveMcpHints(getToolMeta(def.name)?.actionRisks);
    return {
      ...def,
      annotations: {
        ...def.annotations,
        tags: [`group:${toolGroupMap.get(def.name) ?? 'unknown'}`],
        // 手动标注优先, 缺失才用 RiskLevel 派生（MCP spec 2025-06-18）
        readOnlyHint: def.annotations?.readOnlyHint ?? hints.readOnlyHint,
        destructiveHint: def.annotations?.destructiveHint ?? hints.destructiveHint,
        idempotentHint: def.annotations?.idempotentHint ?? hints.idempotentHint,
      },
    };
  });
}

let registered = false;

/** Register all tool modules into the global registry. Idempotent — safe to call multiple times. */
export function registerAllModules(): void {
  if (registered) return;
  registered = true;
  for (const mod of ALL_MODULES) {
    const originalGetDefs = mod.getToolDefinitions;
    const wrappedMod = {
      ...mod,
      TOOL_META: mod.TOOL_META,
      getToolDefinitions: () => injectTags(originalGetDefs.call(mod)),
    };
    registerModule(wrappedMod);
  }
}
