import type { Context } from "../../context/Context.js";
import type { Store } from "../Store.js";

export type FactKind =
  | "identity"
  | "preference"
  | "decision"
  | "state"
  | "event"
  | "relationship"
  | "measurement"
  | "recommendation";

export type FactStatus = "active" | "historical" | "disputed" | "superseded" | "retracted";
export type FactAuthority = "user_explicit" | "tool_verified" | "assistant_reported";

export interface FactSource {
  id: number;
  factId: number;
  messageId: number;
  sessionId: string;
  messageType: "user" | "assistant" | "tool_end";
  quote: string;
  sourceTimestamp: number;
}

export interface AtomicFact {
  id: number;
  fingerprint: string;
  canonicalText: string;
  kind: FactKind;
  slotKey: string | null;
  canonicalValue: unknown;
  status: FactStatus;
  authority: FactAuthority;
  validFrom: string | null;
  validTo: string | null;
  observedAt: number;
  supersedesFactId: number | null;
  createdAt: number;
  updatedAt: number;
  entities: string[];
  sources: FactSource[];
}

export interface CreateFactArgs {
  fingerprint: string;
  canonicalText: string;
  kind: FactKind;
  slotKey: string | null;
  canonicalValue: unknown;
  status: Extract<FactStatus, "active" | "historical" | "disputed">;
  authority: FactAuthority;
  validFrom: string | null;
  validTo: string | null;
  observedAt: number;
  supersedesFactId: number | null;
  entities: string[];
  sources: Array<Omit<FactSource, "id" | "factId">>;
}

export interface FactListArgs {
  ids?: number[];
  fingerprints?: string[];
  slotKeys?: string[];
  statuses?: FactStatus[];
  kinds?: FactKind[];
  authorities?: FactAuthority[];
  asOf?: string;
  limit?: number;
  order?: "recent" | "oldest";
}

export interface UpdateFactArgs {
  id: number;
  changes: {
    status?: FactStatus;
    validTo?: string | null;
    supersedesFactId?: number | null;
  };
}

export type FactStoreCommand =
  | {
      type: "add_sources";
      factId: number;
      sources: Array<Omit<FactSource, "id" | "factId">>;
      authority: FactAuthority;
      observedAt: number;
    }
  | { type: "get_checkpoint"; sessionId: string; extractorVersion: string }
  | {
      type: "set_checkpoint";
      sessionId: string;
      extractorVersion: string;
      messageId: number;
    };

export interface FactStore extends Store<
  AtomicFact,
  FactListArgs,
  CreateFactArgs,
  UpdateFactArgs,
  never,
  FactStoreCommand
> {
  list(x: Context, args: FactListArgs): AtomicFact[];
  count(x: Context, args: FactListArgs): number;
  create(x: Context, args: CreateFactArgs): AtomicFact;
  update(x: Context, args: UpdateFactArgs): AtomicFact;
  delete(x: Context, args: never): never;
  cmd(x: Context, command: FactStoreCommand): unknown;
  searchFts(
    x: Context,
    args: { query: string; limit: number; statuses?: FactStatus[] },
  ): Array<{ fact: AtomicFact; score: number }>;
}

export class ProxyFactStore implements FactStore {
  constructor(protected readonly inner: FactStore) {}

  list(x: Context, args: FactListArgs) {
    return this.inner.list(x, args);
  }
  count(x: Context, args: FactListArgs) {
    return this.inner.count(x, args);
  }
  create(x: Context, args: CreateFactArgs) {
    return this.inner.create(x, args);
  }
  update(x: Context, args: UpdateFactArgs) {
    return this.inner.update(x, args);
  }
  delete(x: Context, args: never) {
    return this.inner.delete(x, args);
  }
  cmd(x: Context, command: FactStoreCommand) {
    return this.inner.cmd(x, command);
  }
  searchFts(x: Context, args: { query: string; limit: number; statuses?: FactStatus[] }) {
    return this.inner.searchFts(x, args);
  }
}
