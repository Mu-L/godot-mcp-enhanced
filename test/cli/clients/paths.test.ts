import { describe, it, expect, afterEach, vi } from 'vitest';
import { join } from 'path';
import { homedir } from 'os';

describe('globalConfigRoot', () => {
  const origPlatform = process.platform;
  const origEnv = { ...process.env };

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    process.env = { ...origEnv };
  });

  it('win32 uses APPDATA', async () => {
    vi.resetModules();
    process.env = { ...origEnv, APPDATA: 'C:\\Users\\t\\AppData\\Roaming' };
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const { globalConfigRoot } = await import('../../../src/cli/clients/paths.js');
    expect(globalConfigRoot()).toBe('C:\\Users\\t\\AppData\\Roaming');
  });

  it('darwin uses ~/Library/Application Support', async () => {
    vi.resetModules();
    process.env = { ...origEnv };
    delete process.env.APPDATA;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    const { globalConfigRoot } = await import('../../../src/cli/clients/paths.js');
    expect(globalConfigRoot()).toBe(join(homedir(), 'Library', 'Application Support'));
  });

  it('linux uses XDG_CONFIG_HOME when set', async () => {
    vi.resetModules();
    process.env = { ...origEnv, XDG_CONFIG_HOME: '/custom/xdg' };
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const { globalConfigRoot } = await import('../../../src/cli/clients/paths.js');
    expect(globalConfigRoot()).toBe('/custom/xdg');
  });

  it('linux falls back to ~/.config when XDG unset', async () => {
    vi.resetModules();
    process.env = { ...origEnv };
    delete process.env.XDG_CONFIG_HOME;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const { globalConfigRoot } = await import('../../../src/cli/clients/paths.js');
    expect(globalConfigRoot()).toBe(join(homedir(), '.config'));
  });
});
