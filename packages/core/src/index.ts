export { LicenseError, asLicenseError } from "./errors.js";
export {
  AGENT_INITIATED_CEILING,
  AUTH_DETAIL_TYPE,
  CHECKPOINT_AUD,
  ISSUER_ID,
  JUSTIFICATION_TYP,
  LICENSE_TYP,
  MAX_CHAIN_DEPTH,
  MAX_JUSTIFICATION_TTL_SECONDS,
  REQUEST_TYP,
  SKEW_SECONDS,
  STH_TYP,
  TRUST_DOMAIN,
} from "./constants.js";
export { base64url, base64urlDecode, canonicalize, sha256, sha256Prefixed } from "./encoding.js";
export {
  agentNameFromSpiffe,
  agentSpiffe,
  generateEd25519Keypair,
  initKeystore,
  isProfileSpiffe,
  jwkThumbprint,
  loadKeystore,
  newId,
  publicJwk,
  userIdOf,
} from "./keys.js";
export type { Keystore } from "./keys.js";
export { decodeJws, signJws, verifyJws } from "./jws.js";
export type { DecodedJws } from "./jws.js";
export { createUserRequest, requestHash, verifyUserRequest } from "./request.js";
export type { CreateUserRequestInput } from "./request.js";
export { issueLicense, verifyLicense } from "./license.js";
export type { IssueLicenseInput } from "./license.js";
export { createJustification, justificationHash, verifyJustification } from "./justify.js";
export type { CreateJustificationInput } from "./justify.js";
export { attenuateLicense } from "./attenuate.js";
export type { AttenuateInput } from "./attenuate.js";
export { assessPresentation, hashPresentedJustification } from "./assess.js";
export type { AssessInput } from "./assess.js";
export {
  agentHops,
  canonicalStatement,
  defaultChildTask,
  defaultIdentity,
  delegationSentence,
  formatPrincipal,
  isPrincipal,
  taskNarrows,
  terminalPrincipal,
} from "./statement.js";
export {
  actorIds,
  delegationChain,
  effectOf,
  expectedBasis,
  parseAction,
  parseAuthorizationDetail,
  parseLicenseClaims,
  parseLocation,
  parseMandate,
} from "./validate.js";
export {
  MerkleLog,
  consistencyProof,
  entryBytes,
  inclusionProof,
  largestPowerOfTwoLessThan,
  leafHash,
  merkleTreeHash,
  parseDecisionRecord,
  verifyConsistency,
  verifyInclusion,
  verifyReplayedLog,
} from "./merkle.js";
export type { AppendResult, ConsistencyProof, InclusionProof, LogVerification } from "./merkle.js";
export { closeServer, createHttpServer, listen, readBody, readJson, requestUrl, sendError, sendJson } from "./http.js";
export type {
  ActClaim,
  AgentInitiatedMandate,
  OrgPrincipal,
  Principal,
  Assessment,
  AuthorizationDetail,
  Budget,
  CheckpointFlags,
  DecisionRecord,
  DirectRequestMandate,
  JustificationBasis,
  JustificationClaims,
  LicenseClaims,
  Mandate,
  MandateType,
  OkpPrivateJwk,
  OkpPublicJwk,
  SignedTreeHeadClaims,
  UserGoalMandate,
  UserPrincipal,
  UserRequestClaims,
} from "./types.js";
