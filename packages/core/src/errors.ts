/** Stable error codes returned by issuance, verification, and checkpoint checks. */
export class LicenseError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LicenseError";
    this.code = code;
  }
}

export function asLicenseError(error: unknown): LicenseError {
  if (error instanceof LicenseError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new LicenseError("malformed", message);
}
