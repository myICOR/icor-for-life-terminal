/* Windows has no pty without a native binding or a helper that does not
 * ship with Python, so v1 opens the user's own terminal instead of drawing
 * one. The template comes from settings; {cwd} and {command} are substituted
 * and the result is split like a command line. Not verifiable on the machine
 * this was written on; the README says so. */

import { spawn } from 'node:child_process';
import { parseArgs } from '../profiles';

export interface ExternalLaunch {
  file: string;
  args: string[];
}

export function externalLaunch(template: string, cwd: string, command: string[]): ExternalLaunch | null {
  const line = template
    .replace(/\{cwd\}/g, cwd)
    .replace(/\{command\}/g, command.join(' '));
  const parts = parseArgs(line);
  const file = parts.shift();
  if (!file) return null;
  return { file, args: parts };
}

export function openExternalTerminal(launch: ExternalLaunch, cwd: string, env: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const child = spawn(launch.file, launch.args, { cwd, env, detached: true, stdio: 'ignore', windowsHide: false });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
