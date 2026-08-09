import express from "express";
import type { Router } from "express";
import { z } from "zod";
import type { Context } from "../context/Context.js";
import {
  attachmentUploadRequestSchema,
  attachmentUploadResponseSchema,
} from "../shared/contracts/attachment-api.js";
import type { RouterService } from "./RouterService.js";
import {
  attachmentIdSchema,
  attachmentReadResultSchema,
} from "../contracts/attachment.js";
import { xAttachmentStore } from "../lib/x.js";
import {
  emptyRouteSchema,
  unknownRouteSchema,
  createRawRoute,
} from "./createRoute.js";

const attachmentParamsSchema = z.object({ id: attachmentIdSchema }).strict();

function parseByteRange(
  value: string | undefined,
  size: number,
):
  | {
      start: number;
      end: number;
    }
  | undefined
  | null {
  if (!value) return undefined;
  const match = value.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start >= size ||
    end < start
  ) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
}

function createAttachmentUploadRouter(x: Context): Router {
  const router = express.Router();
  router.post(
    "/",
    createRawRoute(x, {
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: attachmentUploadRequestSchema,
      },
      handler: (routeX, { body }, _req, res) => {
        if (typeof body.data !== "string" || !body.data) {
          res.status(400).json({ error: "data (base64 data URL) is required" });
          return;
        }
        const match = body.data.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) {
          res.status(400).json({ error: "Invalid data URL format" });
          return;
        }
        const attachment = xAttachmentStore(routeX).create(routeX, {
          content: Buffer.from(match[2], "base64"),
          mimeType: match[1],
          ...(body.filename ? { filename: String(body.filename) } : {}),
        });
        res.json(
          attachmentUploadResponseSchema.parse({
            path: attachment.path,
            url: attachment.url,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
          }),
        );
      },
    }),
  );
  return router;
}

function createAttachmentFileRouter(x: Context): Router {
  const router = express.Router();
  router.get(
    "/:id",
    createRawRoute(x, {
      auth: "dashboard",
      schemas: {
        params: attachmentParamsSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      handler: (routeX, { params }, req, res) => {
        const store = xAttachmentStore(routeX);
        const attachment = store.list(routeX, { ids: [params.id] })[0];
        if (!attachment) {
          res.status(404).json({ error: "File not found" });
          return;
        }
        const range = parseByteRange(req.headers.range, attachment.size);
        if (range === null) {
          res.setHeader("Content-Range", `bytes */${attachment.size}`);
          res.status(416).end();
          return;
        }
        const result = attachmentReadResultSchema.safeParse(
          store.cmd(routeX, {
            type: "read",
            id: params.id,
            ...(range ? range : {}),
          }),
        );
        if (!result.success) {
          res.status(404).json({ error: "File not found" });
          return;
        }
        res.type(result.data.id);
        res.setHeader("Accept-Ranges", "bytes");
        if (range) {
          res.status(206);
          res.setHeader(
            "Content-Range",
            `bytes ${range.start}-${range.end}/${result.data.size}`,
          );
          res.setHeader("Content-Length", range.end - range.start + 1);
        } else {
          res.setHeader("Content-Length", result.data.size);
        }
        result.data.stream.on("error", () => {
          if (!res.headersSent) res.status(500).end();
          else res.destroy();
        });
        result.data.stream.pipe(res);
      },
    }),
  );
  return router;
}

export class AttachmentUploadRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    return createAttachmentUploadRouter(x);
  }
}

export class AttachmentFileRouterService implements RouterService {
  async createRouter(x: Context): Promise<Router> {
    return createAttachmentFileRouter(x);
  }
}
