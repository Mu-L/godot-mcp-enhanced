#!/usr/bin/env node
import { cpSync, existsSync, readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const projectIndex = args.indexOf('--project');
const isVerify = args.includes('--verify');

if (projectIndex === -1 || !args[projectIndex + 1]) {
  console.error('Usage: npx godot-mcp-enhanced install-plugin --project /path/to/godot/project');
  console.error('       npx godot-mcp-enhanced install-plugin --verify --project /path/to/godot/project');
  process.exit(1);
}

const projectPath = resolve(args[projectIndex + 1]);
const addonSource = join(__dirname, '..', 'addons', 'godot_mcp_server');
const addonDest = join(projectPath, 'addons', 'godot_mcp_server');

if (isVerify) {
  const cfgPath = join(addonDest, 'plugin.cfg');
  if (!existsSync(cfgPath)) {
    console.error('FAIL: plugin.cfg not found at', cfgPath);
    console.error('Run: npx godot-mcp-enhanced install-plugin --project', projectPath);
    process.exit(1);
  }
  const content = readFileSync(cfgPath, 'utf-8');
  if (!content.includes('[plugin]') || !content.includes('script="plugin.gd"')) {
    console.error('FAIL: plugin.cfg is malformed');
    process.exit(1);
  }
  console.log('OK: Plugin installed and valid at', addonDest);
  process.exit(0);
}

if (!existsSync(projectPath)) {
  console.error('ERROR: Project directory does not exist:', projectPath);
  process.exit(1);
}

if (!existsSync(join(projectPath, 'project.godot'))) {
  console.error('ERROR: Not a Godot project (no project.godot):', projectPath);
  process.exit(1);
}

try {
  cpSync(addonSource, addonDest, { recursive: true });
  console.log('OK: Plugin installed to', addonDest);
  console.log('Next: Open Godot Editor > Project Settings > Plugins > Enable "MCP Server"');
} catch (err) {
  console.error('ERROR:', err.message);
  console.error('Manual: Copy addons/godot_mcp_server/ to your project addons/ directory');
  process.exit(1);
}
