import { createHash, randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import type { Context } from "../../context/Context.js";
import { secretKeySchema } from "../../shared/schemas/secret-api.js";
import type { SecretService } from "./SecretService.js";
import {
  SecretReplacementConfirmationError,
  type CreatedSecretDrop,
  type SecretDropInfo,
  type SecretDropService,
  type SecretDropStatus,
  type SecretDropSubmission,
} from "./SecretDropService.js";

const DROP_LIFETIME_MS = 15 * 60 * 1_000;

interface SecretDropRow {
  id: string;
  secret_key: string;
  expires_at: number;
  status: Exclude<SecretDropStatus, "expired">;
  replace_allowed: number;
}

function digestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class SqliteSecretDropService implements SecretDropService {
  constructor(
    private readonly x: Context,
    private readonly db: Database.Database,
    private readonly secrets: SecretService,
    private readonly now: () => number = Date.now,
  ) {}

  create(args: { key: string; replace: boolean }): CreatedSecretDrop {
    const key = secretKeySchema.parse(args.key);
    const configured = this.secrets
      .list(this.x)
      .some((entry) => entry.key === key && entry.configured);
    if (configured && !args.replace) throw new SecretReplacementConfirmationError(key);

    const id = randomBytes(12).toString("hex");
    const token = randomBytes(32).toString("base64url");
    const createdAt = this.now();
    const expiresAt = createdAt + DROP_LIFETIME_MS;
    this.db
      .prepare(
        `INSERT INTO secret_drops (
          id, token_digest, secret_key, expires_at, status, replace_allowed, created_at
        ) VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(id, digestToken(token), key, expiresAt, args.replace ? 1 : 0, createdAt);
    return { id, token, secretKey: key, expiresAt };
  }

  check(id: string): SecretDropInfo | undefined {
    const row = this.db
      .prepare(
        `SELECT id, secret_key, expires_at, status, replace_allowed
         FROM secret_drops WHERE id = ?`,
      )
      .get(id) as SecretDropRow | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      secretKey: row.secret_key,
      expiresAt: row.expires_at,
      status: row.status === "pending" && row.expires_at <= this.now() ? "expired" : row.status,
    };
  }

  submit(args: { token: string; value: string }): SecretDropSubmission {
    const now = this.now();
    const claim = this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT id, secret_key, expires_at, status, replace_allowed
           FROM secret_drops
           WHERE token_digest = ? AND status = 'pending' AND expires_at > ?`,
        )
        .get(digestToken(args.token), now) as SecretDropRow | undefined;
      if (!row) return undefined;
      const configured = this.secrets
        .list(this.x)
        .some((entry) => entry.key === row.secret_key && entry.configured);
      const status = configured && row.replace_allowed !== 1 ? "failed" : "claimed";
      this.db
        .prepare(
          `UPDATE secret_drops
           SET status = ?, token_digest = NULL, completed_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(status, now, row.id);
      return status === "claimed" ? row : null;
    });
    const row = claim();
    if (row === undefined) return "unavailable";
    if (row === null) return "failed";

    try {
      this.secrets.set(this.x, { key: row.secret_key, value: args.value });
      this.db
        .prepare("UPDATE secret_drops SET status = 'saved', completed_at = ? WHERE id = ?")
        .run(this.now(), row.id);
      return "saved";
    } catch {
      this.db
        .prepare("UPDATE secret_drops SET status = 'failed', completed_at = ? WHERE id = ?")
        .run(this.now(), row.id);
      return "failed";
    }
  }
}
