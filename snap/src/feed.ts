/**
 * Feed cache: community.json + addrs.json kept in snap_manageState (unencrypted, it is public data) with a 6 h TTL.
 * An insight never waits for the network: it reads whatever is cached and, if stale, starts a background refresh.
 * Everything fails open (any error means "no feed", never a thrown handler).
 */
import type { AddrFeed, Community, Feed } from "./verdict";

export const API = "https://api.signward.app";
export const TTL_MS = 6 * 60 * 60 * 1000;
/** After a failed attempt, wait this long before trying again. */
export const RETRY_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

export interface State {
  community?: Community | null;
  addrs?: AddrFeed | null;
  communityAt?: number;
  addrsAt?: number;
  communityTry?: number;
  addrsTry?: number;
}

export const toFeed = (s: State | null | undefined): Feed => ({ community: s?.community ?? null, addrs: s?.addrs ?? null });

export function isStale(at: number | undefined, tried: number | undefined, now: number): boolean {
  if (typeof at === "number" && now - at < TTL_MS) return false;
  if (typeof tried === "number" && now - tried < RETRY_MS) return false;
  return true;
}

async function getJson(url: string): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("timeout")), FETCH_TIMEOUT_MS); });
  try {
    const res = await Promise.race([fetch(url, { headers: { Accept: "application/json" } }), timeout]);
    if (!res.ok) throw new Error(`http ${res.status}`);
    return await Promise.race([res.json(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function cleanCommunity(j: unknown): Community | null {
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return { updatedAt: Number(o.updatedAt) || 0, domains: arr(o.domains), auto: arr(o.auto), allow: arr(o.allow), badIps: arr(o.badIps) };
}

function cleanAddrs(j: unknown): AddrFeed | null {
  if (!j || typeof j !== "object" || !Array.isArray((j as { addrs?: unknown }).addrs)) return null;
  const o = j as { updatedAt?: unknown; addrs: unknown[] };
  const addrs = o.addrs
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object" && typeof (e as { addr?: unknown }).addr === "string")
    .map((e) => ({ addr: String(e.addr), chain: e.chain as string | number | undefined, kind: typeof e.kind === "string" ? e.kind : undefined, exp: typeof e.exp === "number" ? e.exp : undefined }));
  return { updatedAt: Number(o.updatedAt) || 0, addrs };
}

export async function loadState(): Promise<State> {
  try {
    const s = await snap.request({ method: "snap_manageState", params: { operation: "get", encrypted: false } });
    return (s ?? {}) as State;
  } catch {
    return {};
  }
}

async function saveState(s: State): Promise<void> {
  await snap.request({ method: "snap_manageState", params: { operation: "update", newState: s as never, encrypted: false } });
}

let inFlight: Promise<void> | null = null;

/** Fetches whatever is stale and writes the result. Never throws. Safe to call without awaiting. */
export function refreshIfStale(state: State, now = Date.now()): Promise<void> {
  if (inFlight) return inFlight;
  const needC = isStale(state.communityAt, state.communityTry, now);
  const needA = isStale(state.addrsAt, state.addrsTry, now);
  if (!needC && !needA) return Promise.resolve();
  inFlight = (async () => {
    try {
      const fresh = await loadState(); // another handler call may have updated it meanwhile
      const next: State = { ...fresh };
      const jobs: Array<Promise<void>> = [];
      if (needC) {
        next.communityTry = now;
        jobs.push(getJson(`${API}/v1/community.json`).then((j) => {
          const c = cleanCommunity(j);
          if (c) { next.community = c; next.communityAt = now; }
        }).catch(() => undefined));
      }
      if (needA) {
        next.addrsTry = now;
        jobs.push(getJson(`${API}/v1/addrs.json`).then((j) => {
          const a = cleanAddrs(j);
          if (a) { next.addrs = a; next.addrsAt = now; }
        }).catch(() => undefined));
      }
      await Promise.all(jobs);
      await saveState(next);
    } catch {
      /* fail open */
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
