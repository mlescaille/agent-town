import { describe, expect, it } from "vitest";

import {
  MerkleLog,
  base64url,
  consistencyProof,
  generateEd25519Keypair,
  inclusionProof,
  leafHash,
  merkleTreeHash,
  publicJwk,
  sha256,
  verifyConsistency,
  verifyInclusion,
  verifyReplayedLog,
  type DecisionRecord,
} from "../src/index.js";

function leaves(count: number): Buffer[] {
  return Array.from({ length: count }, (_, index) => Buffer.from(`entry-${index}`, "utf8"));
}

function b64(buffer: Buffer): string {
  return base64url(buffer);
}

describe("RFC 9162 Merkle proofs", () => {
  it("hashes the empty tree as SHA-256 of the empty string", () => {
    expect(b64(merkleTreeHash([]))).toBe(b64(sha256(Buffer.alloc(0))));
  });

  it("matches the RFC 9162 §2.1.5 seven-leaf proof shapes", () => {
    const all = leaves(7);
    const expectPath = (index: number, nodes: Buffer[]) => {
      expect(inclusionProof(all, index).inclusion_path).toEqual(nodes.map(b64));
    };
    expectPath(0, [leafHash(all[1]!), merkleTreeHash(all.slice(2, 4)), merkleTreeHash(all.slice(4, 7))]);
    expectPath(3, [leafHash(all[2]!), merkleTreeHash(all.slice(0, 2)), merkleTreeHash(all.slice(4, 7))]);
    expectPath(4, [leafHash(all[5]!), leafHash(all[6]!), merkleTreeHash(all.slice(0, 4))]);
    expectPath(6, [merkleTreeHash(all.slice(4, 6)), merkleTreeHash(all.slice(0, 4))]);

    const expectConsistency = (first: number, nodes: Buffer[]) => {
      expect(consistencyProof(all, first, 7).consistency_path).toEqual(nodes.map(b64));
    };
    expectConsistency(3, [
      leafHash(all[2]!),
      leafHash(all[3]!),
      merkleTreeHash(all.slice(0, 2)),
      merkleTreeHash(all.slice(4, 7)),
    ]);
    expectConsistency(4, [merkleTreeHash(all.slice(4, 7))]);
    expectConsistency(6, [
      merkleTreeHash(all.slice(4, 6)),
      leafHash(all[6]!),
      merkleTreeHash(all.slice(0, 4)),
    ]);
  });

  it("verifies inclusion and consistency for every tree up to 32 leaves", () => {
    for (let n = 1; n <= 32; n += 1) {
      const all = leaves(n);
      for (let i = 0; i < n; i += 1) {
        const proof = inclusionProof(all, i);
        expect(verifyInclusion(proof)).toBe(true);
        const tampered = { ...proof, leaf_hash: b64(sha256(Buffer.from(`nope-${i}`))) };
        expect(verifyInclusion(tampered)).toBe(false);
      }
      for (let m = 1; m <= n; m += 1) {
        const proof = consistencyProof(all, m, n);
        expect(verifyConsistency(proof)).toBe(true);
      }
    }
  });

  it("rejects a consistency proof after a historical leaf changes", () => {
    const all = leaves(8);
    const proof = consistencyProof(all, 4, 8);
    const changed = leaves(8);
    changed[1] = Buffer.from("replaced", "utf8");
    const lied = {
      ...consistencyProof(changed, 4, 8),
      first_hash: proof.first_hash,
    };
    expect(verifyConsistency(lied)).toBe(false);
  });

  it("replays an append-only log and catches a mutated leaf", () => {
    const key = generateEd25519Keypair();
    const log = new MerkleLog(key);
    for (let index = 0; index < 5; index += 1) {
      log.append(record(index), new Date("2026-01-01T00:00:00.000Z"));
    }
    const report = verifyReplayedLog(log.entries, log.signedTreeHeads, publicJwk(key));
    expect(report.ok).toBe(true);
    expect(report.tree_size).toBe(5);
    expect(report.inclusion_checked).toBe(5);
    expect(report.consistency_checked).toBeGreaterThan(0);

    const tampered = log.entries.map((entry) => Buffer.from(entry));
    tampered[2]![0] ^= 0xff;
    const bad = verifyReplayedLog(tampered, log.signedTreeHeads, publicJwk(key));
    expect(bad.ok).toBe(false);
  });
});

function record(index: number): Omit<DecisionRecord, "index" | "v"> {
  return {
    time: "2026-01-01T00:00:00.000Z",
    decision: index % 2 === 0 ? "allow" : "deny",
    code: index % 2 === 0 ? "allow" : "over_scope",
    reason: index % 2 === 0 ? "permitted" : "outside the license",
    license_jti: `lic_${index}`,
    justification_jti: `jus_${index}`,
    justification_hash: "sha-256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    agent: "spiffe://agent-license.example/agent/planner",
    sub: "user:alice",
    mandate: "user_goal",
    action: "calendar.read",
    location: "calendar:primary",
    policy_decision: index % 2 === 0 ? "allow" : "deny",
    why: "The call was checked against the signed license.",
  };
}
