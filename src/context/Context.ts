/**
 * Opaque dependency scope.
 *
 * Concrete contexts may expose different dependency subsets. Consumers should
 * resolve dependencies through the x* convenience accessors rather than using
 * string keys directly.
 */
export interface Context {
  get(key: string): unknown;
}
