import type { Context } from "../context/Context.js";

export class UnsupportedStoreOperationError extends Error {
  constructor(message = "Store operation is not supported") {
    super(message);
    this.name = "UnsupportedStoreOperationError";
  }
}

export class StorePermissionDeniedError extends Error {
  constructor(message = "Store operation is not permitted") {
    super(message);
    this.name = "StorePermissionDeniedError";
  }
}

export class StoreRecordNotFoundError extends Error {
  constructor(message = "Record not found") {
    super(message);
    this.name = "StoreRecordNotFoundError";
  }
}

export interface Store<TRecord, TListArgs, TCreateArgs, TUpdateArgs, TDeleteArgs, TCmd = never> {
  list(x: Context, args: TListArgs): Promise<TRecord[]> | TRecord[];
  count(x: Context, args: TListArgs): Promise<number> | number;
  create(x: Context, args: TCreateArgs): Promise<TRecord> | TRecord;
  update(x: Context, args: TUpdateArgs): Promise<TRecord> | TRecord;
  delete(x: Context, args: TDeleteArgs): Promise<number> | number;
  cmd(x: Context, args: TCmd): Promise<unknown> | unknown;
}

export class ProxyStore<
  TRecord,
  TListArgs,
  TCreateArgs,
  TUpdateArgs,
  TDeleteArgs,
  TCmd = never,
> implements Store<TRecord, TListArgs, TCreateArgs, TUpdateArgs, TDeleteArgs, TCmd> {
  constructor(
    protected readonly inner: Store<
      TRecord,
      TListArgs,
      TCreateArgs,
      TUpdateArgs,
      TDeleteArgs,
      TCmd
    >,
  ) {}

  list(x: Context, args: TListArgs) {
    return this.inner.list(x, args);
  }
  count(x: Context, args: TListArgs) {
    return this.inner.count(x, args);
  }
  create(x: Context, args: TCreateArgs) {
    return this.inner.create(x, args);
  }
  update(x: Context, args: TUpdateArgs) {
    return this.inner.update(x, args);
  }
  delete(x: Context, args: TDeleteArgs) {
    return this.inner.delete(x, args);
  }
  cmd(x: Context, args: TCmd) {
    return this.inner.cmd(x, args);
  }
}
