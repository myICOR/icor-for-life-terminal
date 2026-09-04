/* The Claude Code launcher, as argv. Pure. */

export const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSessionId(value: string): boolean {
  return SESSION_ID_PATTERN.test(value);
}

/**
 * What a user pastes is rarely just the id: Claude Code prints
 * "Resume this session with: claude --resume <id>", and the whole line ends
 * up on the clipboard. Take the id out of any of those shapes.
 */
export function normaliseSessionId(raw: string): string | null {
  const m = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0].toLowerCase() : null;
}

export interface ClaudeLaunch {
  resumeSessionId?: string | null;
}

export function claudeArgs(launch: ClaudeLaunch): string[] {
  const id = launch.resumeSessionId;
  if (id && isSessionId(id)) return ['--resume', id];
  return [];
}
