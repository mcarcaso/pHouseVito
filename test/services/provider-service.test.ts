import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, mock } from "node:test";
import { z } from "zod";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
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
  it("returns framework provider metadata and model IDs", async () => {
    const { root, x, service } = createHarness();
    try {
      const overview = await service.getOverview(x);
      const providers = z.array(z.string()).parse(overview.providers);
      assert.ok(providers.length > 0);
      assert.ok(Array.isArray(overview.oauthProviders));
      assert.ok(
        overview.oauthProviders.some((provider) => provider.id === "xai"),
        "xAI subscription login should be exposed through Provider Access",
      );
      const models = await service.listModels(x, providers[0]);
      assert.ok(models.length > 0);
      assert.ok(models.every((model) => typeof model.id === "string"));
      const matches = await service.searchModels(x, `${providers[0]}/`);
      assert.ok(matches.length > 0 && matches.length <= 25);
      assert.ok(matches.every((model) => model.startsWith(`${providers[0]}/`)));
      await assert.rejects(service.listModels(x, "not-a-provider"));
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
  it("cancels an unfinished login on logout and permits a fresh login", async () => {
    const { root, x, service } = createHarness();
    let cancellations = 0;
    const runtime = {
      getProvider: () => ({ auth: { oauth: {} } }),
      login: async (
        _id: string,
        _type: string,
        interaction: Parameters<ModelRuntime["login"]>[2],
      ) => {
        interaction.notify({ type: "auth_url", url: "https://login.example.test" });
        await new Promise<void>((_resolve, reject) => {
          interaction.signal!.addEventListener(
            "abort",
            () => {
              cancellations++;
              reject(interaction.signal!.reason);
            },
            { once: true },
          );
        });
      },
      logout: async () => {},
    };
    const create = mock.method(
      ModelRuntime,
      "create",
      async () => runtime as unknown as ModelRuntime,
    );
    try {
      assert.equal((await service.startLogin(x, "openai-codex")).status, "login_started");
      await assert.rejects(service.startLogin(x, "openai-codex"), /already in progress/);
      await service.logout(x, "openai-codex");
      assert.equal(cancellations, 1);
      assert.deepEqual(service.getLoginStatus(x, "openai-codex"), { status: "none" });
      assert.equal((await service.startLogin(x, "openai-codex")).status, "login_started");
      await service.logout(x, "openai-codex");
      assert.equal(cancellations, 2);
    } finally {
      create.mock.restore();
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("expires abandoned logins so retry is possible", async (t) => {
    const { root, x, service } = createHarness();
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const runtime = {
      getProvider: () => ({ auth: { oauth: {} } }),
      login: async (
        _id: string,
        _type: string,
        interaction: Parameters<ModelRuntime["login"]>[2],
      ) => {
        interaction.notify({ type: "auth_url", url: "https://login.example.test" });
        await interaction.prompt({ type: "input", message: "Code", signal: interaction.signal });
      },
      logout: async () => {},
    };
    const create = mock.method(
      ModelRuntime,
      "create",
      async () => runtime as unknown as ModelRuntime,
    );
    try {
      await service.startLogin(x, "openai-codex");
      assert.equal(service.getLoginStatus(x, "openai-codex").status, "prompt");
      t.mock.timers.tick(10 * 60 * 1000);
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.deepEqual(service.getLoginStatus(x, "openai-codex"), {
        status: "error",
        error: "Login expired; please try again",
      });
      assert.equal((await service.startLogin(x, "openai-codex")).status, "login_started");
      await service.logout(x, "openai-codex");
    } finally {
      create.mock.restore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
