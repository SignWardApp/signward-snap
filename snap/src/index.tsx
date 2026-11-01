import type { OnSignatureHandler, OnTransactionHandler } from "@metamask/snaps-sdk";
import { Address, Box, Divider, Heading, Row, Text } from "@metamask/snaps-sdk/jsx";
import { SeverityLevel } from "@metamask/snaps-sdk";
import { loadState, refreshIfStale, toFeed } from "./feed";
import { evaluateSignature, evaluateTransaction, type Verdict } from "./verdict";

const ADDR = /^0x[0-9a-fA-F]{40}$/;

/** Text renders Markdown; strip the characters that could turn site-controlled strings into links or markup. */
const clean = (x: string): string => x.replace(/[\[\]<>*`~]/g, "");

function panel(v: Verdict) {
  const f = v.finding;
  return (
    <Box>
      <Heading>{v.critical ? "Signward warning" : "Signward check"}</Heading>
      {v.critical ? v.reasons.map((r) => <Text>{clean(r)}</Text>) : null}
      {v.critical ? <Divider /> : null}
      {f ? <Text>{clean(f.title)}</Text> : null}
      {f ? f.lines.map((l) => <Text>{clean(l)}</Text>) : null}
      {!f && !v.notes.length ? <Text>Signward found nothing risky in this request. Check the details above before you confirm.</Text> : null}
      {v.notes.map((n) => <Text>{clean(n)}</Text>)}
      {v.origin ? <Row label="Site"><Text>{clean(v.origin)}</Text></Row> : null}
      {f
        ? f.details.map(([label, value]) =>
            ADDR.test(value)
              ? <Row label={clean(label)}><Address address={value as `0x${string}`} /></Row>
              : <Row label={clean(label)}><Text>{clean(value)}</Text></Row>)
        : v.counterparty && ADDR.test(v.counterparty.address)
          ? <Row label={v.counterparty.role}><Address address={v.counterparty.address as `0x${string}`} /></Row>
          : null}
    </Box>
  );
}

async function feedNow() {
  const state = await loadState();
  void refreshIfStale(state); // background: never awaited
  return toFeed(state);
}

export const onTransaction: OnTransactionHandler = async ({ transaction, chainId, transactionOrigin }) => {
  try {
    const v = evaluateTransaction({ transaction, chainId, transactionOrigin }, await feedNow());
    return { content: panel(v), ...(v.critical ? { severity: SeverityLevel.Critical } : {}) };
  } catch {
    return null as never; // fail open: no insight rather than a broken confirmation
  }
};

export const onSignature: OnSignatureHandler = async ({ signature, signatureOrigin }) => {
  try {
    const v = evaluateSignature({ signature: signature as never, signatureOrigin }, await feedNow());
    return { content: panel(v), ...(v.critical ? { severity: SeverityLevel.Critical } : {}) };
  } catch {
    return null;
  }
};
