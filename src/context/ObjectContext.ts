import type { Context } from "./Context.js";

type Factory = (x: Context) => unknown;

export class ObjectContext implements Context {
  private cache = new Map<string, unknown>();

  constructor(
    private readonly factories: Record<string, Factory>,
    private readonly parent?: Context
  ) {}

  get(key: string): unknown {
    if (this.cache.has(key)) return this.cache.get(key);

    const factory = this.factories[key];
    if (!factory) {
      if (this.parent) return this.parent.get(key);
      throw new Error(`Unknown context key: ${key}`);
    }

    const value = factory(this);
    this.cache.set(key, value);
    return value;
  }
}
