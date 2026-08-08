import http from "node:http";
import type { RequestHandler } from "express";
import type { Context } from "../../context/Context.js";
import { xAppStore, xVitoService } from "../../lib/x.js";

function isHostWithinDomain(host: string, baseDomain: string): boolean {
  const normalizedHost = host.toLowerCase();
  const normalizedBase = baseDomain.toLowerCase().replace(/^\.+/, "");
  return normalizedHost === normalizedBase || normalizedHost.endsWith(`.${normalizedBase}`);
}

export function createAppProxyMiddleware(x: Context): RequestHandler {
  return (req, res, next) => {
    const host = (req.headers.host ?? "").split(":")[0];
    let baseDomain: string | undefined;
    try {
      baseDomain = xVitoService(x).getConfig(x).apps?.baseDomain;
    } catch {
      return next();
    }
    if (!baseDomain || !isHostWithinDomain(host, baseDomain)) return next();

    const app = xAppStore(x).list(x, {}).find((candidate) => {
      try {
        return new URL(candidate.url).hostname.toLowerCase() === host.toLowerCase();
      } catch {
        return false;
      }
    });
    if (!app) return next();

    const proxyRequest = http.request(
      {
        hostname: "127.0.0.1",
        port: app.port,
        path: req.originalUrl,
        method: req.method,
        headers: req.headers,
      },
      (proxyResponse) => {
        res.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers);
        proxyResponse.pipe(res);
      }
    );
    proxyRequest.on("error", () => res.status(502).send("App not responding"));
    req.pipe(proxyRequest);
  };
}
