import type { ChildProcess } from 'child_process';

const MAX_OUTPUT_BUFFER_SIZE = 5000;

let _runningProcess: ChildProcess | null = null;
let _outputBuffer: string[] = [];
let _processStartTime = 0;
let _projectDir = '';

export function getRunningProcess(): ChildProcess | null {
  return _runningProcess;
}

export function setRunningProcess(proc: ChildProcess | null): void {
  _runningProcess = proc;
  if (!proc) {
    _outputBuffer = [];
    _processStartTime = 0;
  }
}

export function getOutputBuffer(): string[] {
  return _outputBuffer;
}

export function appendOutput(lines: string[]): void {
  _outputBuffer.push(...lines);
  if (_outputBuffer.length > MAX_OUTPUT_BUFFER_SIZE) {
    _outputBuffer = _outputBuffer.slice(-MAX_OUTPUT_BUFFER_SIZE);
  }
}

export function clearOutputBuffer(): void {
  _outputBuffer = [];
}

export function setOutputBuffer(buf: string[]): void {
  _outputBuffer = buf;
}

export function getProcessStartTime(): number {
  return _processStartTime;
}

export function setProcessStartTime(t: number): void {
  _processStartTime = t;
}

export function getProjectDir(): string {
  return _projectDir;
}

export function setProjectDir(d: string): void {
  _projectDir = d;
}
