import {
  canonicalize,
  verifyConsistency,
  verifyInclusion,
  verifyReplayedLog,
  type ConsistencyProof,
  type InclusionProof,
  type LogVerification,
  type OkpPublicJwk,
} from "@agentlicense/core";

export interface RemoteVerification extends LogVerification {
  server_inclusion_ok: boolean;
  server_consistency_ok: boolean;
}

/** Download the log and check it locally. Also checks the proofs the server returns. */
export async function verifyRemoteLog(logUrl: string, logKey: OkpPublicJwk): Promise<RemoteVerification> {
  const entriesResponse = await fetch(`${logUrl}/v1/entries`);
  const headsResponse = await fetch(`${logUrl}/v1/sths`);
  if (!entriesResponse.ok || !headsResponse.ok) {
    throw new Error(`log fetch failed (${entriesResponse.status}, ${headsResponse.status})`);
  }
  const entriesBody = (await entriesResponse.json()) as { entries: unknown[] };
  const headsBody = (await headsResponse.json()) as { sths: string[] };
  const blobs = entriesBody.entries.map((entry) => Buffer.from(canonicalize(entry), "utf8"));
  const report = verifyReplayedLog(blobs, headsBody.sths, logKey);
  let serverInclusionOk = blobs.length === 0;
  let serverConsistencyOk = blobs.length < 2;
  if (blobs.length > 0) {
    const inclusion = (await fetch(
      `${logUrl}/v1/proofs/inclusion?leaf_index=0&tree_size=${blobs.length}`,
    ).then((response) => response.json())) as InclusionProof;
    serverInclusionOk = verifyInclusion(inclusion);
    if (blobs.length > 1) {
      const consistency = (await fetch(
        `${logUrl}/v1/proofs/consistency?first=1&second=${blobs.length}`,
      ).then((response) => response.json())) as ConsistencyProof;
      serverConsistencyOk = verifyConsistency(consistency);
    }
  }
  return {
    ...report,
    ok: report.ok && serverInclusionOk && serverConsistencyOk,
    server_inclusion_ok: serverInclusionOk,
    server_consistency_ok: serverConsistencyOk,
  };
}
