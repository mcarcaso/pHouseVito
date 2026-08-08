import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import express from "express";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { createAppProxyMiddleware } from "../../src/routers/apps/app-proxy.js";
import { FileAppStore } from "../../src/stores/apps/FileAppStore.js";

const root = mkdtempSync(join(tmpdir(), "vito-app-proxy-"));
let upstream: Server;
let proxy: Server;
let proxyUrl: string;

before(async () => {
  const upstreamApp = express();
  upstreamApp.use(express.text());
  upstreamApp.post("/echo", (req, res) => res.send(`proxied:${req.body}`));
  await new Promise<void>((resolve) => {
    upstream = upstreamApp.listen(0, "127.0.0.1", resolve);
  });
  const upstreamAddress = upstream.address();
  if (!upstreamAddress || typeof upstreamAddress === "string") {
    throw new Error("Missing upstream server address");
  }

  const directory = join(root, "alpha");
  mkdirSync(directory);
  writeFileSync(join(directory, ".vito-app.json"), JSON.stringify({
    port: upstreamAddress.port,
    url: "https://alpha.example.com",
  }));

  const x = new ObjectContext({
    appsDir: () => root,
    appStore: () => new FileAppStore(),
    vitoService: () => ({
      getConfig: () => ({ apps: { baseDomain: "example.com" } }),
    }),
  });
  const proxyApp = express();
  proxyApp.use(createAppProxyMiddleware(x));
  proxyApp.use((req, res) => res.status(404).send(`fallback:${req.headers.host ?? ""}`));
  await new Promise<void>((resolve) => {
    proxy = proxyApp.listen(0, "127.0.0.1", resolve);
  });
  const proxyAddress = proxy.address();
  if (!proxyAddress || typeof proxyAddress === "string") throw new Error("Missing proxy address");
  proxyUrl = `http://127.0.0.1:${proxyAddress.port}`;
});

after(async () => {
  await Promise.all([
    new Promise<void>((resolve, reject) => proxy.close((error) => error ? reject(error) : resolve())),
    new Promise<void>((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve())),
  ]);
  rmSync(root, { recursive: true, force: true });
});

function sendRequest(host: string, method = "GET", body?: string): Promise<{
  status: number;
  body: string;
}> {
  const url = new URL("/echo", proxyUrl);
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        host,
        ...(body ? {
          "content-type": "text/plain",
          "content-length": Buffer.byteLength(body),
        } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode ?? 0,
        body: Buffer.concat(chunks).toString("utf-8"),
      }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

describe("app proxy middleware", () => {
  it("proxies matching hosts with streaming request bodies", async () => {
    const response = await sendRequest("alpha.example.com", "POST", "hello");
    assert.equal(response.status, 200, response.body);
    assert.equal(response.body, "proxied:hello");
  });

  it("does not proxy lookalike domains", async () => {
    const response = await sendRequest("alpha.evilexample.com");
    assert.equal(response.status, 404);
    assert.equal(response.body, "fallback:alpha.evilexample.com");
  });
});
