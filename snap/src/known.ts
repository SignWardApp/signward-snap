/**
 * Well-known protocol contracts that are normal spenders/operators. A grant to one of these is not escalated to
 * "critical" by itself (the calm panel still explains it). One shared list with the Worker's never-block list
 * (backend/src/neveraddrs.ts), where every entry is verified on chain and cited.
 */
import { NEVER_ADDRS } from "../../backend/src/neveraddrs";

export const KNOWN_SPENDERS: ReadonlySet<string> = new Set(NEVER_ADDRS.keys());
