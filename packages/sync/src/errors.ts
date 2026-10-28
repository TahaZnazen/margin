/**
 * Upload error policy. Transient errors (network, 5xx, expired token, connection-class Postgres
 * errors) are retried with backoff; permanent ones (constraint, RLS, bad request) are recorded in
 * `sync_errors` and the operation is dropped, so one bad row never blocks the queue.
 */
export interface UploadFailure {
  /** Postgres SQLSTATE or PostgREST code, when the server answered. */
  code?: string | null;
  /** HTTP status; 0 or missing when the request never got an answer. */
  status?: number | null;
  message?: string | null;
}

/** SQLSTATE classes that mean "try again later": connection (08), serialization (40), resources (53), operator (57), system (58). */
const TRANSIENT_SQLSTATE = /^(08|40|53|57|58)/;

export function isTransient(failure: UploadFailure): boolean {
  const { code, status, message } = failure;
  if (code && TRANSIENT_SQLSTATE.test(code)) return true;
  // PostgREST: PGRST0xx is connectivity, PGRST301 an expired JWT (a token refresh fixes it).
  if (code?.startsWith("PGRST")) return code === "PGRST301" || code.startsWith("PGRST0");
  // A real Postgres error outside the transient classes is permanent, whatever HTTP status
  // PostgREST wrapped it in (it answers 500 for some, e.g. 21000 cardinality violation).
  if (code && /^[0-9A-Z]{5}$/.test(code)) return false;
  if (status === 401 || status === 408 || status === 429) return true;
  if (typeof status === "number" && status >= 500) return true;
  if (typeof status === "number" && status >= 400) return false;
  // No code and no HTTP answer: the network failed (offline, DNS, CORS, aborted).
  if (!code && !status) return true;
  return /fetch|network|timeout|abort/i.test(message ?? "");
}

export function backoffMs(failures: number, baseMs = 500, maxMs = 5000): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, failures - 1));
}
