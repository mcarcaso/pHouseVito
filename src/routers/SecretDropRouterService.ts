import express from "express";
import type { Request, Response, Router } from "express";
import { z } from "zod";
import type { Context } from "../context/Context.js";
import { xSecretDropService } from "../lib/x.js";
import { jsonResponseSchema } from "../shared/schemas/json.js";
import { secretKeySchema } from "../shared/schemas/secret-api.js";
import { SecretReplacementConfirmationError } from "../services/secrets/SecretDropService.js";
import type { RouterService } from "./RouterService.js";
import { emptyRouteSchema, registerRoute, unknownRouteSchema } from "./register-route.js";

const createDropSchema = z
  .object({
    key: secretKeySchema,
    replace: z.boolean().default(false),
  })
  .strict();
const dropIdSchema = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/) }).strict();
const submitDropSchema = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    value: z.string().min(1).max(32_768),
  })
  .strict();

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vito · Secret drop</title><link rel="stylesheet" href="/secret-drop/style.css"></head><body><main><h1>Secret drop</h1><p>Private delivery to Vito. This link expires after 15 minutes and accepts one submission.</p><form><label for="secret">Secret value</label><input id="secret" type="password" autocomplete="off" required maxlength="32768"><button>Save securely</button></form><p id="result" role="status"></p></main><script src="/secret-drop/app.js"></script></body></html>`;
const SCRIPT = `const token=location.hash.slice(1);history.replaceState(null,'','/secret-drop/');const form=document.querySelector('form'),input=document.querySelector('input'),button=document.querySelector('button'),result=document.querySelector('#result');if(!token){form.hidden=true;result.textContent='Open a fresh secret-drop link from Vito.';}form.addEventListener('submit',async e=>{e.preventDefault();button.disabled=true;try{const value=input.value;input.value='';const response=await fetch('/secret-drop/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,value}),cache:'no-store',credentials:'omit'});form.hidden=true;result.textContent=response.ok?'Saved securely. You can close this page.':'Not saved or link no longer usable. Ask Vito to check the request status and issue a fresh link if needed.';}catch{form.hidden=true;result.textContent='Connection interrupted. Ask Vito to check the request status before trying again.';}});`;
const STYLE = `body{font:18px system-ui;background:#111815;color:#eff5ef;margin:0}main{max-width:480px;margin:12vh auto;padding:24px}p{line-height:1.6;color:#b7c7bc}label{display:block}input,button{box-sizing:border-box;width:100%;padding:16px;margin-top:14px;font:inherit;border:1px solid #607769;border-radius:5px}button{background:#bfd8c6;color:#101b14;cursor:pointer}input{background:#1c2821;color:white}`;

function forwardedProtocol(req: Request): string | undefined {
  const header = req.headers["x-forwarded-proto"];
  const value = Array.isArray(header) ? header[0] : header;
  return value?.split(",", 1)[0]?.trim().toLowerCase();
}

function secureOrigin(req: Request): string | undefined {
  const encrypted = "encrypted" in req.socket && req.socket.encrypted === true;
  if (!encrypted && forwardedProtocol(req) !== "https") return undefined;
  const host = req.headers.host;
  if (!host || host.includes("@")) return undefined;
  try {
    const origin = new URL(`https://${host}`);
    if (origin.pathname !== "/" || origin.username || origin.password) return undefined;
    return origin.origin;
  } catch {
    return undefined;
  }
}

function setPrivateHeaders(res: Response): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

export class SecretDropRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    const router = express.Router();

    registerRoute(x, {
      router,
      method: "POST",
      path: "/",
      auth: "dashboard",
      schemas: { params: emptyRouteSchema, query: emptyRouteSchema, body: createDropSchema },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { body }, req, res }) => {
        const origin = secureOrigin(req);
        if (!origin) {
          res.status(400).json({ error: "Secret Drop requires HTTPS" });
          return;
        }
        try {
          const drop = xSecretDropService(routeX).create(body);
          return {
            id: drop.id,
            url: `${origin}/secret-drop/#${drop.token}`,
            secretKey: drop.secretKey,
            expiresAt: drop.expiresAt,
          };
        } catch (error) {
          if (!(error instanceof SecretReplacementConfirmationError)) throw error;
          res.status(409).json({ error: error.message, replacementRequired: true });
        }
      },
    });

    registerRoute(x, {
      router,
      method: "GET",
      path: "/:id",
      auth: "dashboard",
      schemas: { params: dropIdSchema, query: emptyRouteSchema, body: unknownRouteSchema },
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { params }, res }) => {
        const drop = xSecretDropService(routeX).check(params.id);
        if (!drop) {
          res.status(404).json({ error: "Secret drop not found" });
          return;
        }
        return drop;
      },
    });

    return router;
  }
}

export class PublicSecretDropRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    const router = express.Router();
    router.use((_req, res, next) => {
      setPrivateHeaders(res);
      next();
    });
    router.get("/", (_req, res) => res.type("html").send(PAGE));
    router.get("/app.js", (_req, res) => res.type("text/javascript").send(SCRIPT));
    router.get("/style.css", (_req, res) => res.type("text/css").send(STYLE));

    registerRoute(x, {
      router,
      method: "POST",
      path: "/submit",
      auth: "public",
      schemas: { params: emptyRouteSchema, query: emptyRouteSchema, body: submitDropSchema },
      jsonLimit: "40kb",
      responseSchema: jsonResponseSchema,
      handler: (routeX, { data: { body }, req, res }) => {
        const origin = secureOrigin(req);
        if (!origin || req.headers.origin !== origin) {
          res.status(403).json({ error: "Forbidden" });
          return;
        }
        const result = xSecretDropService(routeX).submit(body);
        if (result === "unavailable") {
          res.status(410).json({ error: "Link unavailable" });
          return;
        }
        if (result === "failed") {
          res.status(500).json({ error: "Secret was not saved" });
          return;
        }
        return { saved: true };
      },
    });

    return router;
  }
}
