// Parameter validation utilities for tool handlers.

/** Clamps a timeout value (seconds) to [min, max], defaulting on invalid input.
 *  Guarantees the result is >= 1 (rounding a sub-second min up to 1). */
export function validateTimeout(value: unknown, min = 5, max = 120, defaultVal = 30): number {
  if (value === undefined || value === null) return defaultVal;
  const num = Number(value);
  if (!Number.isFinite(num)) return defaultVal;
  return Math.max(1, Math.min(max, Math.max(min, Math.round(num))));
}

/** Ensure a value converts to a finite number; throws with descriptive error on failure. */
export function ensureNumber(v: unknown, name: string): number {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a finite number, got: ${JSON.stringify(v)}`);
  return n;
}

/** Clamp a numeric parameter to [min, max], pushing a warning when clamped. Returns undefined if input is undefined. */
export function clampParam(val: number | undefined, min: number, max: number, name: string, warnings: string[]): number | undefined {
  if (val === undefined) return undefined;
  if (val < min) { warnings.push(`${name} ${val} clamped to ${min}`); return min; }
  if (val > max) { warnings.push(`${name} ${val} clamped to ${max}`); return max; }
  return val;
}

/** Validates that a string is a safe GDScript identifier (class name, type name, etc.). */
export function validateIdentifier(name: string, label = 'Identifier'): void {
  if (name.length > 64) {
    throw new Error(`${label} "${name.slice(0, 20)}..." must be 1-64 characters (got ${name.length})`);
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`${label} "${name}" is not a valid GDScript identifier`);
  }
}

// 标准 camelCase→snake_case（nodeType→node_type）。连续大写会逐字插入下划线（HTTPClient→h_t_t_p_client），但 Godot 属性无此模式。
export function toSnakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (ch, idx) => (idx > 0 ? '_' : '') + ch.toLowerCase());
}

export function validateVector3(v: unknown): { x: number; y: number; z: number } {
  if (typeof v !== 'object' || v === null) throw new Error('Vector3 must be an object with x, y, z number fields');
  const obj = v as Record<string, unknown>;
  for (const key of ['x', 'y', 'z']) {
    if (typeof obj[key] !== 'number' || !Number.isFinite(obj[key] as number)) throw new Error(`Vector3 field "${key}" must be a finite number`);
  }
  return { x: obj.x as number, y: obj.y as number, z: obj.z as number };
}

/**
 * 跑 dotnet build --no-restore 做 C# 编译验证（公共 helper）。
 *
 * 2026-08-06 审查 P1/P2：消除 script.ts csharpValidateAndRevert 与 validation.ts validate_project
 * 的重复 dotnet build 逻辑（漂移风险）。两处都调此 helper。
 *
 * ⚠️ 安全：dotnet build 执行任意 MSBuild <Target>/.csproj 预构建步骤 = 任意代码执行面，
 * 调用方须自行做 action-gate opt-in 校验（如 script.ts 检查 GODOT_MCP_PRIVILEGED_GROUPS=code-execution）。
 *
 * @returns on success: { ok: true }
 *          on ENOENT (dotnet 不在 PATH): { ok: true, skipped: true, skipReason: 'dotnet CLI not found' }
 *          on build failure: { ok: false, output: string }
 */
export async function runDotnetBuild(
  projectPath: string,
  execFileAsync: (cmd: string, args: string[], opts: Record<string, unknown>) => Promise<unknown>,
  timeoutMs = 30000,
): Promise<{ ok: true } | { ok: true; skipped: true; skipReason: string } | { ok: false; output: string }> {
  try {
    await execFileAsync('dotnet', ['build', '--no-restore'], {
      cwd: projectPath,
      timeout: timeoutMs,
      encoding: 'utf-8',
    });
    return { ok: true };
  } catch (e: unknown) {
    const err = e as Record<string, unknown>;
    if (err.code === 'ENOENT') {
      return { ok: true, skipped: true, skipReason: 'dotnet CLI not found in PATH' };
    }
    const output = (err.stdout as string) || (err.message as string) || 'dotnet build failed';
    return { ok: false, output };
  }
}
