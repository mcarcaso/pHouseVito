import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { z } from "zod";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { DefaultProviderService } from "../../src/services/providers/DefaultProviderService.js";
import { FileSecretService } from "../../src/services/secrets/FileSecretService.js";

function createHarness() {
  const root = mkdtempSync(join(tmpdir(), "vito-provider-service-"));
  const piAuthPath = join(root, "auth.json");
  const x = new ObjectContext({
    secretsPath: () => join(root, "secrets.json"),
    piAuthPath: () => piAuthPath,
    secretService: () => new FileSecretService(),
  });
  return { root, piAuthPath, x, service: new DefaultProviderService() };
}

describe("DefaultProviderService", () => {
  it("returns framework provider metadata and model IDs", () => {
    const { root, x, service } = createHarness();
    try {
      const overview = service.getOverview(x);
      const providers = z.array(z.string()).parse(overview.providers);
      assert.ok(providers.length > 0);
      assert.ok(Array.isArray(overview.oauthProviders));
      const models = service.listModels(x, providers[0]);
      assert.ok(models.length > 0);
      assert.ok(models.every((model) => typeof model.id === "string"));
      assert.throws(() => service.listModels(x, "not-a-provider"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports persisted OAuth status when no login is pending", () => {
    const { root, piAuthPath, x, service } = createHarness();
    try {
      assert.deepEqual(service.getLoginStatus(x, "test-provider"), { status: "none" });
      writeFileSync(
        piAuthPath,
        JSON.stringify({
          "test-provider": { type: "oauth", access: "token" },
        }),
      );
      assert.deepEqual(service.getLoginStatus(x, "test-provider"), { status: "success" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
