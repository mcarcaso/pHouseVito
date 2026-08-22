import type { RequestHandler } from "express";
import type { Context } from "../../../context/Context.js";
import { xVitoService } from "../../../lib/x.js";

export const HSTS_HEADER_VALUE = "max-age=31536000";

function firstForwardedProtocol(value: string | string[] | undefined): string | undefined {
  const firstValue = Array.isArray(value) ? value[0] : value;
  return firstValue?.split(",", 1)[0]?.trim().toLowerCase();
}

function hostnameFromHost(host: string): string | undefined {
  if (host.includes("@")) return undefined;
  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function isConfiguredHost(host: string, baseDomain: string): boolean {
  const hostname = hostnameFromHost(host);
  const normalizedBaseDomain = baseDomain.toLowerCase().replace(/^\.+|\.+$/g, "");
  if (!hostname || !normalizedBaseDomain) return false;
  return hostname === normalizedBaseDomain || hostname.endsWith(`.${normalizedBaseDomain}`);
}

/** Enforces HTTPS only for the configured public domain, leaving direct local access unchanged. */
export function createHttpSecurityMiddleware(x: Context): RequestHandler {
  return (req, res, next) => {
    const host = req.headers.host;
    if (!host) return next();

    let baseDomain: string | undefined;
    try {
      baseDomain = xVitoService(x).getConfig(x).apps?.baseDomain;
    } catch {
      return next();
    }
    if (!baseDomain || !isConfiguredHost(host, baseDomain)) return next();

    const protocol = firstForwardedProtocol(req.headers["x-forwarded-proto"]);
    if (protocol === "http") {
      res.redirect(308, `https://${host}${req.originalUrl}`);
      return;
    }
    if (protocol === "https") res.setHeader("Strict-Transport-Security", HSTS_HEADER_VALUE);
    next();
  };
}
