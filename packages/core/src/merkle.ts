import { base64url, base64urlDecode, canonicalize, sha256 } from "./encoding.js";
import { LicenseError } from "./errors.js";
import { verifyJws, signJws } from "./jws.js";
import type { DecisionRecord, OkpPrivateJwk, OkpPublicJwk, SignedTreeHeadClaims } from "./types.js";
import { STH_TYP } from "./constants.js";

/**
 * Merkle tree as defined in RFC 9162 §2.1.
 * Leaf: HASH(0x00 || entry). Internal: HASH(0x01 || left || right).
 * Empty tree: HASH().
 */

function nodeHash(left: Buffer, right: Buffer): Buffer {
  return sha256(Buffer.concat([Buffer.from([0x01]), left, right]));
}

export function leafHash(entry: Uint8Array): Buffer {
  return sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from(entry)]));
}

/** Largest power of two strictly less than n. n must be >= 2. */
export function largestPowerOfTwoLessThan(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

function mth(entries: Uint8Array[]): Buffer {
  if (entries.length === 1) return leafHash(entries[0]!);
  const k = largestPowerOfTwoLessThan(entries.length);
  return nodeHash(mth(entries.slice(0, k)), mth(entries.slice(k)));
}

/** RFC 9162 §2.1.1 Merkle Tree Hash. */
export function merkleTreeHash(entries: Uint8Array[]): Buffer {
  if (entries.length === 0) return sha256(Buffer.alloc(0));
  return mth(entries);
}

function inclusionNodes(index: number, entries: Uint8Array[]): Buffer[] {
  if (entries.length === 0) throw new LicenseError("malformed", "empty tree has no inclusion proof");
  if (index < 0 || index >= entries.length) throw new LicenseError("malformed", "leaf index out of range");
  if (entries.length === 1) return [];
  const k = largestPowerOfTwoLessThan(entries.length);
  if (index < k) return [...inclusionNodes(index, entries.slice(0, k)), mth(entries.slice(k))];
  return [...inclusionNodes(index - k, entries.slice(k)), mth(entries.slice(0, k))];
}

function subproof(size: number, entries: Uint8Array[], complete: boolean): Buffer[] {
  const n = entries.length;
  if (size === n) return complete ? [] : [mth(entries)];
  if (size <= 0 || size > n) throw new LicenseError("malformed", "consistency size out of range");
  const k = largestPowerOfTwoLessThan(n);
  if (size <= k) return [...subproof(size, entries.slice(0, k), complete), mth(entries.slice(k))];
  return [...subproof(size - k, entries.slice(k), false), mth(entries.slice(0, k))];
}

export interface InclusionProof {
  leaf_index: number;
  tree_size: number;
  leaf_hash: string;
  root_hash: string;
  inclusion_path: string[];
}

export interface ConsistencyProof {
  first: number;
  second: number;
  first_hash: string;
  second_hash: string;
  consistency_path: string[];
}

function encode(hash: Buffer): string {
  return base64url(hash);
}

function decode(value: string): Buffer {
  const buffer = base64urlDecode(value);
  if (buffer.length !== 32) throw new LicenseError("malformed", "Merkle node is not 32 bytes");
  return buffer;
}

export function inclusionProof(entries: Uint8Array[], index: number): InclusionProof {
  const path = inclusionNodes(index, entries);
  return {
    leaf_index: index,
    tree_size: entries.length,
    leaf_hash: encode(leafHash(entries[index]!)),
    root_hash: encode(merkleTreeHash(entries)),
    inclusion_path: path.map(encode),
  };
}

export function consistencyProof(entries: Uint8Array[], first: number, second?: number): ConsistencyProof {
  const newer = second ?? entries.length;
  if (!Number.isInteger(first) || !Number.isInteger(newer) || first <= 0 || newer > entries.length || first > newer) {
    throw new LicenseError("malformed", "consistency proof bounds are invalid");
  }
  const prefix = entries.slice(0, newer);
  const path = first === newer ? [] : subproof(first, prefix, true);
  return {
    first,
    second: newer,
    first_hash: encode(merkleTreeHash(entries.slice(0, first))),
    second_hash: encode(merkleTreeHash(prefix)),
    consistency_path: path.map(encode),
  };
}

function shiftUntilLsbClear(fn: number, sn: number): [number, number] {
  while ((fn & 1) === 1) {
    fn >>>= 1;
    sn >>>= 1;
  }
  return [fn, sn];
}

function shiftUntilLsbSetOrZero(fn: number, sn: number): [number, number] {
  while ((fn & 1) === 0 && fn !== 0) {
    fn >>>= 1;
    sn >>>= 1;
  }
  return [fn, sn];
}

/** RFC 9162 §2.1.3.2. `leafHashB64` is HASH(0x00 || entry), not the raw entry. */
export function verifyInclusion(proof: InclusionProof): boolean {
  try {
    if (proof.leaf_index < 0 || proof.leaf_index >= proof.tree_size) return false;
    let fn = proof.leaf_index >>> 0;
    let sn = (proof.tree_size - 1) >>> 0;
    let r = decode(proof.leaf_hash);
    for (const encoded of proof.inclusion_path) {
      if (sn === 0) return false;
      const p = decode(encoded);
      if ((fn & 1) === 1 || fn === sn) {
        r = nodeHash(p, r);
        if ((fn & 1) === 0) [fn, sn] = shiftUntilLsbSetOrZero(fn, sn);
      } else {
        r = nodeHash(r, p);
      }
      fn >>>= 1;
      sn >>>= 1;
    }
    return sn === 0 && encode(r) === proof.root_hash;
  } catch {
    return false;
  }
}

/** RFC 9162 §2.1.4.2. Equal sizes are consistent only when the hashes match and the path is empty. */
export function verifyConsistency(proof: ConsistencyProof): boolean {
  try {
    if (proof.first <= 0 || proof.second < proof.first) return false;
    if (proof.first === proof.second) {
      return proof.consistency_path.length === 0 && proof.first_hash === proof.second_hash;
    }
    if (proof.consistency_path.length === 0 && !isPowerOfTwo(proof.first)) return false;
    const path = proof.consistency_path.map(decode);
    if (isPowerOfTwo(proof.first)) path.unshift(decode(proof.first_hash));
    if (path.length === 0) return false;
    let fn = (proof.first - 1) >>> 0;
    let sn = (proof.second - 1) >>> 0;
    [fn, sn] = shiftUntilLsbClear(fn, sn);
    let fr = path[0]!;
    let sr = path[0]!;
    for (const c of path.slice(1)) {
      if (sn === 0) return false;
      if ((fn & 1) === 1 || fn === sn) {
        fr = nodeHash(c, fr);
        sr = nodeHash(c, sr);
        if ((fn & 1) === 0) [fn, sn] = shiftUntilLsbSetOrZero(fn, sn);
      } else {
        sr = nodeHash(sr, c);
      }
      fn >>>= 1;
      sn >>>= 1;
    }
    return sn === 0 && encode(fr) === proof.first_hash && encode(sr) === proof.second_hash;
  } catch {
    return false;
  }
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

export function entryBytes(record: DecisionRecord): Buffer {
  return Buffer.from(canonicalize(record), "utf8");
}

export interface AppendResult {
  record: DecisionRecord;
  index: number;
  leaf_hash: string;
  inclusion: InclusionProof;
  sth: string;
  root_hash: string;
  tree_size: number;
}

export class MerkleLog {
  private readonly leaves: Buffer[] = [];
  private readonly heads: string[] = [];

  constructor(private readonly signingKey: OkpPrivateJwk) {}

  get treeSize(): number {
    return this.leaves.length;
  }

  get entries(): Buffer[] {
    return this.leaves.slice();
  }

  get signedTreeHeads(): string[] {
    return this.heads.slice();
  }

  rootHash(): string {
    return base64url(merkleTreeHash(this.leaves));
  }

  /**
   * Restore leaves and signed tree heads. Callers that care about integrity
   * should run {@link verifyReplayedLog} after loading.
   */
  load(leaves: Buffer[], sths: string[]): void {
    this.leaves.splice(0, this.leaves.length, ...leaves);
    this.heads.splice(0, this.heads.length, ...sths);
  }

  append(record: Omit<DecisionRecord, "index" | "v"> & { v?: 1 }, now = new Date()): AppendResult {
    const full: DecisionRecord = { ...record, v: 1, index: this.leaves.length };
    const bytes = entryBytes(full);
    this.leaves.push(bytes);
    const sth = this.signHead(now);
    this.heads.push(sth);
    const inclusion = inclusionProof(this.leaves, full.index);
    return {
      record: full,
      index: full.index,
      leaf_hash: inclusion.leaf_hash,
      inclusion,
      sth,
      root_hash: inclusion.root_hash,
      tree_size: this.leaves.length,
    };
  }

  proofFor(index: number, treeSize = this.leaves.length): InclusionProof {
    return inclusionProof(this.leaves.slice(0, treeSize), index);
  }

  consistencyFor(first: number, second = this.leaves.length): ConsistencyProof {
    return consistencyProof(this.leaves, first, second);
  }

  private signHead(now: Date): string {
    const claims: SignedTreeHeadClaims = {
      v: 1,
      log_id: this.signingKey.kid,
      tree_size: this.leaves.length,
      root_hash: this.rootHash(),
      timestamp: now.toISOString(),
    };
    return signJws(claims as unknown as Record<string, unknown>, this.signingKey, STH_TYP);
  }
}

export interface LogVerification {
  ok: boolean;
  tree_size: number;
  root_hash: string;
  inclusion_checked: number;
  consistency_checked: number;
  errors: string[];
}

export function verifyReplayedLog(
  entryBlobs: Uint8Array[],
  sths: string[],
  logKey: OkpPublicJwk,
): LogVerification {
  const errors: string[] = [];
  const root = base64url(merkleTreeHash(entryBlobs));
  let inclusionChecked = 0;
  let consistencyChecked = 0;
  if (sths.length !== entryBlobs.length) {
    errors.push(`signed tree head count ${sths.length} does not match entry count ${entryBlobs.length}`);
  }
  const parsed: SignedTreeHeadClaims[] = [];
  for (let i = 0; i < sths.length; i += 1) {
    try {
      const verified = verifyJws(sths[i]!, logKey, STH_TYP);
      const claims = verified.payload as unknown as SignedTreeHeadClaims;
      if (claims.v !== 1 || claims.log_id !== logKey.kid) errors.push(`sth ${i} has a bad identity`);
      if (claims.tree_size !== i + 1) errors.push(`sth ${i} tree_size is ${claims.tree_size}`);
      const prefixRoot = base64url(merkleTreeHash(entryBlobs.slice(0, i + 1)));
      if (claims.root_hash !== prefixRoot) errors.push(`sth ${i} root does not match the replayed prefix`);
      parsed.push(claims);
    } catch (error) {
      errors.push(`sth ${i} signature failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (let i = 0; i < entryBlobs.length; i += 1) {
    const proof = inclusionProof(entryBlobs, i);
    inclusionChecked += 1;
    if (!verifyInclusion(proof)) errors.push(`inclusion proof failed for index ${i}`);
  }
  if (parsed.length >= 2) {
    for (let i = 1; i < parsed.length; i += 1) {
      const proof = consistencyProof(entryBlobs, parsed[i - 1]!.tree_size, parsed[i]!.tree_size);
      consistencyChecked += 1;
      if (!verifyConsistency(proof)) errors.push(`consistency proof failed for ${proof.first}..${proof.second}`);
    }
  }
  if (entryBlobs.length > 1 && parsed.length === entryBlobs.length) {
    const ends = consistencyProof(entryBlobs, 1, entryBlobs.length);
    consistencyChecked += 1;
    if (!verifyConsistency(ends)) errors.push("consistency proof from the first entry to the head failed");
  }
  return {
    ok: errors.length === 0,
    tree_size: entryBlobs.length,
    root_hash: root,
    inclusion_checked: inclusionChecked,
    consistency_checked: consistencyChecked,
    errors,
  };
}

export function parseDecisionRecord(bytes: Uint8Array): DecisionRecord {
  const text = Buffer.from(bytes).toString("utf8");
  if (canonicalize(JSON.parse(text) as unknown) !== text) {
    throw new LicenseError("malformed", "log entry is not canonical JSON");
  }
  return JSON.parse(text) as DecisionRecord;
}
