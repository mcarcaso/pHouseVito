import type { RequestHandler } from "express";
import type { Context } from "../../context/Context.js";
import { xDashboardAuthService } from "../../lib/x.js";
import { isPublicDriveFile } from "../drive/drive-router.js";

export function createDashboardApiAuthMiddleware(x: Context): RequestHandler {
  return (req, res, next) => {
    if (req.path.startsWith("/auth")) return next();
    if (req.path === "/health") return next();
    if (req.path === "/ask") return next();

    const auth = xDashboardAuthService(x);
    if (!auth.isPasswordSet(x)) {
      res.status(403).json({
        error: "Dashboard password not set. Complete /api/auth/setup first.",
      });
      return;
    }

    if (req.path.startsWith("/drive/file/")) {
      const encodedPath = req.path.slice("/drive/file/".length);
      try {
        if (isPublicDriveFile(x, decodeURIComponent(encodedPath))) return next();
      } catch {
        // Invalid URL encoding continues through normal authentication.
      }
    }

    if (!auth.isAuthenticated(x, req.headers.cookie)) {
      if (req.path.startsWith("/drive/file/")) {
        const returnTo = encodeURIComponent(req.originalUrl);
        res.redirect(302, `/?returnTo=${returnTo}`);
        return;
      }
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
}

export function createAttachmentAuthMiddleware(x: Context): RequestHandler {
  return (req, res, next) => {
    const auth = xDashboardAuthService(x);
    if (!auth.isPasswordSet(x)) {
      res.status(403).json({
        error: "Dashboard password not set. Complete /api/auth/setup first.",
      });
      return;
    }
    if (!auth.isAuthenticated(x, req.headers.cookie)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
}
