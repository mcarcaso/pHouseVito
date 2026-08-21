import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { providerOverviewSchema } from "../../src/shared/schemas/provider-api.js";

describe("provider API schema", () => {
  it("accepts unauthenticated providers with a null auth type", () => {
    const overview = providerOverviewSchema.parse({
      providers: ["anthropic", "openai"],
      keyStatus: { anthropic: true, openai: false },
      authStatus: {
        anthropic: { hasAuth: true, authType: "oauth", expiresAt: 123 },
        openai: { hasAuth: false, authType: null },
      },
      keyInfo: {
        openai: { envVar: "OPENAI_API_KEY", description: "OpenAI API key" },
      },
      oauthProviders: [{ id: "anthropic", name: "Anthropic" }],
    });

    assert.equal(overview.authStatus.openai.authType, null);
    assert.equal(overview.authStatus.anthropic.hasAuth, true);
  });
});
