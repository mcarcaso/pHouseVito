import express from "express";
import type { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import type { Context } from "../../context/Context.js";
import {
  driveDirectoryMetaSchema,
  drivePathSchema,
  driveReadResultSchema,
  nonRootDrivePathSchema,
} from "../../contracts/drive.js";
import { xDriveStore } from "../../lib/x.js";
import {
  InvalidDriveArchiveError,
  InvalidDrivePathError,
} from "../../stores/drive/FileDriveStore.js";
import { StoreRecordNotFoundError } from "../../stores/Store.js";
import {
  emptyRouteSchema,
  unknownRouteSchema,
  validatedRoute,
} from "../route.js";

const pathQuerySchema = z.object({ path: drivePathSchema.default("") }).strict();
const requiredPathQuerySchema = z.object({ path: nonRootDrivePathSchema }).strict();
const uploadBodySchema = z.object({
  data: z.string().min(1),
  filename: z.string().min(1),
  folder: drivePathSchema.optional(),
}).strict();
const siteUploadBodySchema = z.object({
  data: z.string().min(1),
  folder: nonRootDrivePathSchema,
}).strict();
const directoryMetaBodySchema = z.object({
  isPublic: z.boolean().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
}).strict();
const fileMetaBodySchema = z.object({
  isPublic: z.boolean().nullable().optional(),
}).strict();
const wildcardPathSchema = z.object({
  filepath: z.union([z.string(), z.array(z.string())])
    .transform((value) => {
      const path = Array.isArray(value) ? value.join("/") : value;
      return path.replace(/\/+$/, "");
    })
    .pipe(nonRootDrivePathSchema),
}).strict();

function decodeDataUrl(value: string): Buffer | undefined {
  const match = value.match(/^data:[^;]+;base64,([A-Za-z0-9+/]*={0,2})$/);
  if (!match) return undefined;
  return Buffer.from(match[1], "base64");
}

function sendDriveFile(x: Context, path: string, indexFallback: boolean, res: Response): boolean {
  const parsed = driveReadResultSchema.safeParse(
    xDriveStore(x).cmd(x, { type: "read", path, indexFallback })
  );
  if (!parsed.success) return false;
  if (parsed.data.isPublic) sendCorsHeaders(res);
  res.type(parsed.data.name);
  parsed.data.stream.on("error", () => {
    if (!res.headersSent) res.status(500).end();
    else res.destroy();
  });
  parsed.data.stream.pipe(res);
  return true;
}

function sendCorsHeaders(res: Response): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export function isPublicDriveFile(x: Context, path: string): boolean {
  const parsed = drivePathSchema.safeParse(path);
  if (!parsed.success || parsed.data === "") return false;
  const entry = xDriveStore(x).list(x, { paths: [parsed.data], kinds: ["file"] })[0];
  return entry?.isPublic === true;
}

export function createPublicDriveRouter(x: Context): Router {
  const router = express.Router();
  router.get("/*filepath", validatedRoute(
    x,
    {
      params: wildcardPathSchema,
      query: emptyRouteSchema,
      body: unknownRouteSchema,
    },
    (routeX, { params }, _req, res) => {
      const result = driveReadResultSchema.safeParse(
        xDriveStore(routeX).cmd(routeX, {
          type: "read",
          path: params.filepath,
          indexFallback: true,
        })
      );
      if (!result.success || !result.data.isPublic) {
        result.success && result.data.stream.destroy();
        res.status(404).send("Not found");
        return;
      }
      sendCorsHeaders(res);
      res.type(result.data.name);
      result.data.stream.on("error", () => {
        if (!res.headersSent) res.status(500).end();
        else res.destroy();
      });
      result.data.stream.pipe(res);
    }
  ));
  return router;
}

function driveErrorMiddleware(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (error instanceof InvalidDriveArchiveError || error instanceof InvalidDrivePathError) {
    res.status(400).json({ error: error.message });
    return;
  }
  if (error instanceof StoreRecordNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  next(error);
}

export function createDriveRouter(x: Context): Router {
  const router = express.Router();

  router.get("/ls", validatedRoute(
    x,
    { params: emptyRouteSchema, query: pathQuerySchema, body: unknownRouteSchema },
    (routeX, { query }, _req, res) => {
      const store = xDriveStore(routeX);
      const directory = store.list(routeX, {
        paths: [query.path],
        kinds: ["directory"],
      })[0];
      if (!directory) {
        res.status(404).json({ error: "Directory not found" });
        return;
      }
      const children = store.list(routeX, { parentPaths: [query.path] });
      res.json({
        path: query.path,
        meta: directory.meta ?? null,
        isPublic: directory.isPublic,
        dirs: children
          .filter((entry) => entry.kind === "directory")
          .map((entry) => ({
            name: entry.name,
            hasMeta: entry.meta !== null,
            meta: entry.meta ?? null,
          })),
        files: children
          .filter((entry) => entry.kind === "file")
          .map((entry) => ({
            name: entry.name,
            size: entry.size,
            isPublic: entry.isPublic,
            createdAt: entry.createdAt,
          })),
      });
    }
  ));

  router.post("/upload", validatedRoute(
    x,
    { params: emptyRouteSchema, query: emptyRouteSchema, body: uploadBodySchema },
    (routeX, { body }, _req, res) => {
      const content = decodeDataUrl(body.data);
      if (!content) {
        res.status(400).json({ error: "Invalid data URL format" });
        return;
      }
      const path = body.folder ? `${body.folder}/${body.filename}` : body.filename;
      const parsedPath = nonRootDrivePathSchema.safeParse(path);
      if (!parsedPath.success) {
        res.status(400).json({ error: "Invalid drive path" });
        return;
      }
      const entry = xDriveStore(routeX).create(routeX, {
        kind: "file",
        path: parsedPath.data,
        content,
      });
      res.json({ success: true, path: entry.path });
    }
  ));

  router.post("/upload-site", validatedRoute(
    x,
    { params: emptyRouteSchema, query: emptyRouteSchema, body: siteUploadBodySchema },
    (routeX, { body }, _req, res) => {
      const archive = decodeDataUrl(body.data);
      if (!archive) {
        res.status(400).json({ error: "Invalid data URL format" });
        return;
      }
      const entry = xDriveStore(routeX).create(routeX, {
        kind: "site",
        path: body.folder,
        archive,
      });
      res.json({ success: true, path: entry.path });
    }
  ));

  router.put("/meta", validatedRoute(
    x,
    { params: emptyRouteSchema, query: pathQuerySchema, body: directoryMetaBodySchema },
    (routeX, { query, body }, _req, res) => {
      const updated = xDriveStore(routeX).update(routeX, {
        path: query.path,
        changes: { directoryMeta: body },
      });
      res.json(updated.meta ?? driveDirectoryMetaSchema.parse({}));
    }
  ));

  router.put("/file-meta", validatedRoute(
    x,
    { params: emptyRouteSchema, query: requiredPathQuerySchema, body: fileMetaBodySchema },
    (routeX, { query, body }, _req, res) => {
      const updated = xDriveStore(routeX).update(routeX, {
        path: query.path,
        changes: { fileIsPublic: body.isPublic ?? null },
      });
      res.json({ file: updated.name, isPublic: updated.isPublic });
    }
  ));

  router.delete("/", validatedRoute(
    x,
    { params: emptyRouteSchema, query: requiredPathQuerySchema, body: unknownRouteSchema },
    (routeX, { query }, _req, res) => {
      const deleted = xDriveStore(routeX).delete(routeX, { paths: [query.path] });
      if (deleted === 0) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json({ success: true });
    }
  ));

  router.get("/file/*filepath", validatedRoute(
    x,
    { params: wildcardPathSchema, query: emptyRouteSchema, body: unknownRouteSchema },
    (routeX, { params }, _req, res) => {
      if (!sendDriveFile(routeX, params.filepath, false, res)) {
        res.setHeader("Cache-Control", "no-store");
        res.status(404).json({ error: "File not found" });
      }
    }
  ));

  router.options("/file/*filepath", validatedRoute(
    x,
    { params: wildcardPathSchema, query: emptyRouteSchema, body: unknownRouteSchema },
    (routeX, { params }, _req, res) => {
      if (!isPublicDriveFile(routeX, params.filepath)) {
        res.status(403).end();
        return;
      }
      sendCorsHeaders(res);
      res.status(204).end();
    }
  ));

  router.use(driveErrorMiddleware);
  return router;
}
