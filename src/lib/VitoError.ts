import type { VitoErrorData } from "../shared/schemas/vito-error.js";

/**
 * A Vito application error with transport-safe structured data.
 *
 * `data` may be presented at HTTP, CLI, or channel boundaries. Private
 * diagnostic information belongs in the standard `cause` property instead.
 */
export class VitoError extends Error {
  readonly data: Readonly<VitoErrorData>;

  constructor(data: VitoErrorData, options?: ErrorOptions) {
    super(data.message, options);
    this.name = "VitoError";
    this.data = Object.freeze(data);
  }
}
