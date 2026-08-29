import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as authGuardModule from "../../mobile/src/services/auth/auth-generation-guard.ts";

const { AuthGenerationGuard } =
  authGuardModule.default as typeof import("../../mobile/src/services/auth/auth-generation-guard.ts");

describe("AuthGenerationGuard", () => {
  it("rejects delayed unauthorized callbacks from an earlier login generation", () => {
    const guard = new AuthGenerationGuard();
    const staleRequest = guard.capture();

    guard.advance();
    const currentRequest = guard.capture();

    assert.equal(staleRequest(), false);
    assert.equal(currentRequest(), true);
  });

  it("accepts only the first unauthorized callback in one generation", () => {
    const guard = new AuthGenerationGuard();
    const firstRequest = guard.capture();
    const siblingRequest = guard.capture();

    assert.equal(firstRequest(), true);
    assert.equal(siblingRequest(), false);
  });
});
