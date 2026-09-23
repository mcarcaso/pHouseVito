export type SecretDropStatus = "pending" | "claimed" | "saved" | "failed" | "expired";

export interface CreatedSecretDrop {
  id: string;
  token: string;
  secretKey: string;
  expiresAt: number;
}

export interface SecretDropInfo {
  id: string;
  secretKey: string;
  expiresAt: number;
  status: SecretDropStatus;
}

export type SecretDropSubmission = "saved" | "unavailable" | "failed";

export class SecretReplacementConfirmationError extends Error {
  constructor(key: string) {
    super(`Replacing ${key} requires explicit confirmation`);
    this.name = "SecretReplacementConfirmationError";
  }
}

export interface SecretDropService {
  create(args: { key: string; replace: boolean }): CreatedSecretDrop;
  check(id: string): SecretDropInfo | undefined;
  submit(args: { token: string; value: string }): SecretDropSubmission;
}
