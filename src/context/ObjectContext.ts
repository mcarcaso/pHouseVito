import type { Context } from "./Context.js";

type ContextFactory = (x: Context) => unknown;
type ContextFactoryMap = Readonly<Record<string, ContextFactory>>;

/**
 * Lazily constructs and caches dependencies registered for this scope.
 *
 * Parent fallback is appropriate for trusted overlays such as the dashboard's
 * scheduler scope. Restricted user/agent contexts must explicitly expose only
 * authorized dependencies and should not inherit directly from RootContext.
 */
export class ObjectContext implements Context {
  private readonly cache = new Map<string, unknown>();

  constructor(
    private readonly factories: ContextFactoryMap,
    private readonly parent?: Context,
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
