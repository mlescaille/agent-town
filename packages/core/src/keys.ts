import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { TRUST_DOMAIN } from "./constants.js";
import { canonicalize, sha256, base64url } from "./encoding.js";
import { LicenseError } from "./errors.js";
import type { OkpPrivateJwk, OkpPublicJwk } from "./types.js";

const NAME = /^[a-z][a-z0-9-]{0,62}$/;

export function jwkThumbprint(jwk: { crv: string; kty: string; x: string }): string {
  const canonical = canonicalize({ crv: jwk.crv, kty: jwk.kty, x: jwk.x });
  return base64url(sha256(Buffer.from(canonical, "utf8")));
}

export function generateEd25519Keypair(): OkpPrivateJwk {
  const { privateKey } = generateKeyPairSync("ed25519");
  const exported = privateKey.export({ format: "jwk" }) as {
    kty: string;
    crv: string;
    x: string;
    d: string;
  };
  if (exported.kty !== "OKP" || exported.crv !== "Ed25519" || !exported.d || !exported.x) {
    throw new LicenseError("malformed", "node did not export an Ed25519 OKP key");
  }
  return {
    kty: "OKP",
    crv: "Ed25519",
    x: exported.x,
    d: exported.d,
    use: "sig",
    kid: jwkThumbprint(exported),
  };
}

export function publicJwk(key: OkpPublicJwk | OkpPrivateJwk): OkpPublicJwk {
  return { kty: "OKP", crv: "Ed25519", x: key.x, kid: key.kid, use: "sig" };
}

export function agentSpiffe(name: string): string {
  if (!NAME.test(name)) {
    throw new LicenseError("bad_agent_id", `agent name ${JSON.stringify(name)} is not a short lowercase slug`);
  }
  return `spiffe://${TRUST_DOMAIN}/agent/${name}`;
}

export function userIdOf(name: string): string {
  if (!NAME.test(name)) {
    throw new LicenseError("malformed", `user name ${JSON.stringify(name)} is not a short lowercase slug`);
  }
  return `user:${name}`;
}

export function agentNameFromSpiffe(spiffe: string): string {
  const prefix = `spiffe://${TRUST_DOMAIN}/agent/`;
  if (!spiffe.startsWith(prefix)) {
    throw new LicenseError("bad_agent_id", `unsupported agent id ${spiffe}`);
  }
  const name = spiffe.slice(prefix.length);
  if (!NAME.test(name)) throw new LicenseError("bad_agent_id", `unsupported agent id ${spiffe}`);
  return name;
}

export function isProfileSpiffe(value: string): boolean {
  try {
    agentNameFromSpiffe(value);
    return true;
  } catch {
    return false;
  }
}

export interface Keystore {
  home: string;
  issuer: OkpPrivateJwk;
  log: OkpPrivateJwk;
  user(id: string): OkpPrivateJwk;
  agent(spiffeOrName: string): OkpPrivateJwk;
  userPublic(): Record<string, OkpPublicJwk>;
  agentPublic(): Record<string, OkpPublicJwk>;
}

function writeKey(path: string, key: OkpPrivateJwk): void {
  writeFileSync(path, `${JSON.stringify(key, null, 2)}\n`, { mode: 0o600 });
}

function readKey(path: string): OkpPrivateJwk {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as OkpPrivateJwk;
  if (parsed.kty !== "OKP" || parsed.crv !== "Ed25519" || !parsed.d || !parsed.x) {
    throw new LicenseError("malformed", `key file ${path} is not an Ed25519 private JWK`);
  }
  const kid = jwkThumbprint(parsed);
  if (parsed.kid !== kid) {
    throw new LicenseError("malformed", `key file ${path} kid does not match its RFC 7638 thumbprint`);
  }
  parsed.use = "sig";
  return parsed;
}

/** Create issuer, log, user `alice`, and agents `planner` and `researcher`. */
export function initKeystore(home: string): Keystore {
  mkdirSync(join(home, "users"), { recursive: true });
  mkdirSync(join(home, "agents"), { recursive: true });
  mkdirSync(join(home, "log"), { recursive: true });
  writeKey(join(home, "issuer.jwk"), generateEd25519Keypair());
  writeKey(join(home, "log.jwk"), generateEd25519Keypair());
  writeKey(join(home, "users", "alice.jwk"), generateEd25519Keypair());
  writeKey(join(home, "agents", "planner.jwk"), generateEd25519Keypair());
  writeKey(join(home, "agents", "researcher.jwk"), generateEd25519Keypair());
  return loadKeystore(home);
}

export function loadKeystore(home: string): Keystore {
  const issuer = readKey(join(home, "issuer.jwk"));
  const log = readKey(join(home, "log.jwk"));
  const users = new Map<string, OkpPrivateJwk>();
  const agents = new Map<string, OkpPrivateJwk>();
  for (const file of readdirSync(join(home, "users"))) {
    if (!file.endsWith(".jwk")) continue;
    const name = file.slice(0, -".jwk".length);
    users.set(userIdOf(name), readKey(join(home, "users", file)));
  }
  for (const file of readdirSync(join(home, "agents"))) {
    if (!file.endsWith(".jwk")) continue;
    const name = file.slice(0, -".jwk".length);
    agents.set(agentSpiffe(name), readKey(join(home, "agents", file)));
  }
  return {
    home,
    issuer,
    log,
    user(id: string) {
      const key = users.get(id);
      if (!key) throw new LicenseError("unknown_user", `no key for ${id}`);
      return key;
    },
    agent(spiffeOrName: string) {
      const id = spiffeOrName.startsWith("spiffe://") ? spiffeOrName : agentSpiffe(spiffeOrName);
      const key = agents.get(id);
      if (!key) throw new LicenseError("unknown_agent", `no key for ${id}`);
      return key;
    },
    userPublic() {
      return Object.fromEntries([...users].map(([id, key]) => [id, publicJwk(key)]));
    },
    agentPublic() {
      return Object.fromEntries([...agents].map(([id, key]) => [id, publicJwk(key)]));
    },
  };
}

export function newId(prefix: string): string {
  return prefix + randomBytes(16).toString("hex");
}
