import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { xDb, xUserDir } from "../../src/lib/x.js";

describe("ObjectContext", () => {
  it("supports arbitrary dependency subsets", () => {
    const x = new ObjectContext({
      userDir: () => "/tmp/vito-user",
    });

    assert.equal(xUserDir(x), "/tmp/vito-user");
    assert.throws(() => xDb(x), /Unknown context key: db/);
  });

  it("constructs each local dependency once", () => {
    let calls = 0;
    const x = new ObjectContext({
      value: () => {
        calls += 1;
        return { id: "value" };
      },
    });

    assert.equal(x.get("value"), x.get("value"));
    assert.equal(calls, 1);
  });

  it("allows trusted overlays to inherit and override dependencies", () => {
    const rootX = new ObjectContext({
      userDir: () => "/root/user",
      scopeName: () => "root",
    });
    const overlayX = new ObjectContext({
      scopeName: () => "dashboard",
    }, rootX);

    assert.equal(xUserDir(overlayX), "/root/user");
    assert.equal(overlayX.get("scopeName"), "dashboard");
  });
});
