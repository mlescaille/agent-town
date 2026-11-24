import { createHash } from "node:crypto";

import { LicenseError } from "./errors.js";

export function sha256(data: Uint8Array): Buffer {
  return createHash("sha256").update(data).digest();
}

export function base64url(data: Uint8Array): string {
  return Buffer.from(data).toString("base64url");
}

export function base64urlDecode(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new LicenseError("malformed", "invalid base64url");
  }
  return Buffer.from(value, "base64url");
}

export function sha256Prefixed(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return `sha-256:${base64url(sha256(bytes))}`;
}

/**
 * JSON Canonicalization Scheme subset for the types this profile signs:
 * objects, arrays, strings, safe integers, booleans, and null.
 * Object keys are sorted; there is no insignificant whitespace.
 */
export function canonicalize(value: unknown): string {
  return canonical(value);
}

function canonical(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new LicenseError("malformed", "canonical JSON only accepts safe integers");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonical(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  throw new LicenseError("malformed", `cannot canonicalize ${typeof value}`);
}
