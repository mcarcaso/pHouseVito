import assert from "node:assert/strict";
import { request, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import {
  createHttpSecurityMiddleware,
  HSTS_HEADER_VALUE,
} from "../../src/services/channels/dashboard/http-security.js";

let server: Server;
let serverUrl: string;

before(async () => {
  const x = new ObjectContext({
    vitoService: () => ({
      getConfig: () => ({ apps: { baseDomain: "example.com" } }),
    }),
  });
  const app = express();
  app.use(createHttpSecurityMiddleware(x));
  app.use((_req, res) => res.status(200).send("ok"));
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  serverUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

function sendRequest(args: {
  host: string;
  forwardedProtocol?: string;
  path?: string;
}): Promise<{ status: number; headers: Record<string, string | string[] | undefined> }> {
  const url = new URL(args.path ?? "/", serverUrl);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        headers: {
          Host: args.host,
          ...(args.forwardedProtocol ? { "X-Forwarded-Proto": args.forwardedProtocol } : {}),
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("HTTP security middleware", () => {
  it("redirects configured public hosts from HTTP to HTTPS", async () => {
    const response = await sendRequest({
      host: "app.example.com",
      forwardedProtocol: "http",
      path: "/path?value=1",
    });

    assert.equal(response.status, 308);
    assert.equal(response.headers.location, "https://app.example.com/path?value=1");
  });

  it("adds HSTS to HTTPS responses", async () => {
    const response = await sendRequest({
      host: "example.com",
      forwardedProtocol: "https",
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers["strict-transport-security"], HSTS_HEADER_VALUE);
  });

  it("does not trust forwarded protocols for unrelated hosts", async () => {
    const response = await sendRequest({
      host: "example.net",
      forwardedProtocol: "http",
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.location, undefined);
  });

  it("leaves direct local requests unchanged", async () => {
    const response = await sendRequest({ host: "example.com" });

    assert.equal(response.status, 200);
    assert.equal(response.headers["strict-transport-security"], undefined);
  });
});
