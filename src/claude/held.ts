/* Which pane holds which Claude session id.
 *
 * The rule this enforces was measured, not assumed: two live writers on one
 * session file do not collide, they FORK it silently, and the next resume
 * follows one branch and orphans the other. So a session id is held by at
 * most one pane of this plugin at a time, and a second `claude --resume` on a
 * held id is refused before it spawns. */

export class HeldSessions {
  private readonly holders = new Map<string, string>();

  /** True when the claim succeeded or the holder already held it. */
  claim(sessionId: string, holder: string): boolean {
    const current = this.holders.get(sessionId);
    if (current !== undefined && current !== holder) return false;
    this.holders.set(sessionId, holder);
    return true;
  }

  release(sessionId: string, holder: string): void {
    if (this.holders.get(sessionId) === holder) this.holders.delete(sessionId);
  }

  releaseAll(holder: string): void {
    for (const [id, h] of this.holders) if (h === holder) this.holders.delete(id);
  }

  holderOf(sessionId: string): string | null {
    return this.holders.get(sessionId) ?? null;
  }

  get size(): number {
    return this.holders.size;
  }
}
