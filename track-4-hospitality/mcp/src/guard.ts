export type GuardResult = { ok: true } | { ok: false; reason: string };

// Skeleton: deliberately accepts everything so the reject tests fail first.
export function validateSql(_sql: string): GuardResult {
  return { ok: true };
}
