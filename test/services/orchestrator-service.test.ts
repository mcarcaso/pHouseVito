import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { PiOrchestratorService } from "../../src/services/orchestrator/PiOrchestratorService.js";
import { vitoConfigSchema } from "../../src/shared/schemas/vito-config.js";

const config = vitoConfigSchema.parse({
  settings: {},
  channels: {},
  cron: { jobs: [] },
});

describe("PiOrchestratorService", () => {
  it("initializes lazily from its method context and retains process state", () => {
    let configReads = 0;
    const x = new ObjectContext({
      userDir: () => "/tmp/vito-orchestrator-test",
      vitoService: () => ({
        getConfig: () => {
          configReads += 1;
          return config;
        },
      }),
      skillStore: () => ({ list: () => [] }),
    });
    const service = new PiOrchestratorService();

    assert.equal(configReads, 0);
    service.reloadConfig(x, config);
    service.reloadConfig(x, config);
    assert.equal(configReads, 1);
  });
});
