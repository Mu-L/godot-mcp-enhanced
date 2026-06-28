import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createProofRun, archiveFrame, writeMetrics } from '../../../src/tools/frame-verify/proof-bundle.js';

describe('proof-bundle', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('createProofRun creates proof/<runId>/ under project', () => {
    const run = createProofRun(tmp);
    expect(run.runId).toMatch(/^run_\d+$/);
    expect(fs.existsSync(run.dir)).toBe(true);
    expect(run.dir.startsWith(path.join(tmp, 'proof'))).toBe(true);
  });

  it('archiveFrame writes frame_00.png with zero-padded index', () => {
    const run = createProofRun(tmp);
    const rel = archiveFrame(run, 0, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const abs = path.join(run.dir, 'frame_00.png');
    expect(fs.existsSync(abs)).toBe(true);
    expect(rel).toBe('frame_00.png');
  });

  it('archiveFrame pads to 2 digits', () => {
    const run = createProofRun(tmp);
    archiveFrame(run, 12, Buffer.from('x'));
    expect(fs.existsSync(path.join(run.dir, 'frame_12.png'))).toBe(true);
  });

  it('writeMetrics writes metrics.json', () => {
    const run = createProofRun(tmp);
    const rel = writeMetrics(run, { degraded: false, meanConsecutive: 0.7 });
    const abs = path.join(run.dir, 'metrics.json');
    expect(fs.existsSync(abs)).toBe(true);
    expect(JSON.parse(fs.readFileSync(abs, 'utf-8')).degraded).toBe(false);
    expect(rel).toBe('metrics.json');
  });

  it('two runs get distinct runIds', () => {
    const a = createProofRun(tmp);
    const b = createProofRun(tmp);
    expect(a.runId).not.toBe(b.runId);
  });
});
