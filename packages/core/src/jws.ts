import { createPrivateKey, createPublicKey, sign, verify, type JsonWebKey } from "node:crypto";

import { base64url, base64urlDecode, canonicalize } from "./encoding.js";
import { LicenseError } from "./errors.js";
import { jwkThumbprint, publicJwk } from "./keys.js";
import type { OkpPrivateJwk, OkpPublicJwk } from "./types.js";

export interface DecodedJws {
  header: { alg: string; typ?: string; kid?: string };
  payload: Record<string, unknown>;
}

export function signJws(
  payload: Record<string, unknown>,
  key: OkpPrivateJwk,
  typ: string,
): string {
  const kid = key.kid || jwkThumbprint(key);
  const header = { alg: "EdDSA", typ, kid };
  const encodedHeader = base64url(Buffer.from(JSON.stringify(header), "utf8"));
  const encodedPayload = base64url(Buffer.from(canonicalize(payload), "utf8"));
  const input = `${encodedHeader}.${encodedPayload}`;
  const signature = sign(
    null,
    Buffer.from(input, "utf8"),
    createPrivateKey({ key: key as unknown as JsonWebKey, format: "jwk" }),
  );
  return `${input}.${base64url(signature)}`;
}

export function decodeJws(token: string): DecodedJws {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new LicenseError("malformed", "JWS must have three non-empty segments");
  }
  const [encodedHeader, encodedPayload] = parts;
  let header: DecodedJws["header"];
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(base64urlDecode(encodedHeader!).toString("utf8")) as DecodedJws["header"];
    const parsed = JSON.parse(base64urlDecode(encodedPayload!).toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("payload is not an object");
    }
    payload = parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof LicenseError) throw error;
    throw new LicenseError("malformed", "JWS segments are not JSON");
  }
  if (header.alg !== "EdDSA") {
    throw new LicenseError("bad_signature", `unsupported alg ${String(header.alg)}`);
  }
  if ("crit" in header) {
    throw new LicenseError("malformed", "critical JWS headers are not accepted");
  }
  return { header, payload };
}

export function verifyJws(token: string, key: OkpPublicJwk, expectedTyp?: string): DecodedJws {
  const decoded = decodeJws(token);
  if (expectedTyp && decoded.header.typ !== expectedTyp) {
    throw new LicenseError("malformed", `expected typ ${expectedTyp}`);
  }
  const thumbprint = jwkThumbprint(key);
  if (decoded.header.kid !== thumbprint) {
    throw new LicenseError("bad_signature", "JWS kid does not match the verification key");
  }
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  const input = Buffer.from(`${encodedHeader}.${encodedPayload}`, "utf8");
  let signature: Buffer;
  try {
    signature = base64urlDecode(encodedSignature!);
  } catch {
    throw new LicenseError("bad_signature", "signature is not base64url");
  }
  let ok = false;
  try {
    ok = verify(
      null,
      input,
      createPublicKey({ key: publicJwk(key) as unknown as JsonWebKey, format: "jwk" }),
      signature,
    );
  } catch {
    ok = false;
  }
  if (!ok) throw new LicenseError("bad_signature", "Ed25519 signature did not verify");
  return decoded;
}
