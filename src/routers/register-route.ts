import express from "express";
import type { NextFunction, Request, RequestHandler, Response, Router } from "express";
import { z } from "zod";
import type { Context } from "../context/Context.js";
import { DashboardUserContext } from "../context/DashboardUserContext.js";
import {
  AskApiContext,
  DashboardAuthContext,
  PublicDriveContext,
  PublicHttpContext,
} from "../context/HttpContext.js";
import { VitoError } from "../lib/VitoError.js";
import { xAskApiService, xDashboardAuthService, xSecretService } from "../lib/x.js";
import {
  vitoErrorDataSchema,
  type VitoErrorData,
  type VitoErrorResponse,
} from "../shared/schemas/vito-error.js";

export interface RouteSchemas<
  TParams extends z.ZodTypeAny,
  TQuery extends z.ZodTypeAny,
  TBody extends z.ZodTypeAny,
> {
  params: TParams;
  query: TQuery;
  body: TBody;
}

export interface ValidatedRouteInput<
  TParams extends z.ZodTypeAny,
  TQuery extends z.ZodTypeAny,
  TBody extends z.ZodTypeAny,
> {
  params: z.output<TParams>;
  query: z.output<TQuery>;
  body: z.output<TBody>;
}

export type HttpAuthPolicy = "public" | "public-drive" | "dashboard" | "ask";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

const DEFAULT_JSON_LIMIT = "1mb";

type RouteHandlerArgs<TInput> = {
  data: TInput;
  req: Request;
  res: Response;
};

interface BaseRouteArgs<
  TParams extends z.ZodTypeAny,
  TQuery extends z.ZodTypeAny,
  TBody extends z.ZodTypeAny,
> {
  router: Router;
  method: HttpMethod;
  path: string;
  auth: HttpAuthPolicy;
  schemas: RouteSchemas<TParams, TQuery, TBody>;
  /** JSON body limit for this route. Body-capable methods default to 1 MB. */
  jsonLimit?: string | number;
  /** Successful response status. Defaults to 200. */
  successStatus?: number;
  /** Delegate handler errors to router-local error middleware. */
  delegateErrors?: boolean;
}

interface RegisterRouteArgs<
  TParams extends z.ZodTypeAny,
  TQuery extends z.ZodTypeAny,
  TBody extends z.ZodTypeAny,
  TResponse extends z.ZodTypeAny,
> extends BaseRouteArgs<TParams, TQuery, TBody> {
  responseSchema: TResponse;
  handler: (
    x: Context,
    args: RouteHandlerArgs<ValidatedRouteInput<TParams, TQuery, TBody>>,
  ) => Promise<z.input<TResponse> | void> | z.input<TResponse> | void;
}

interface RegisterStreamRouteArgs<
  TParams extends z.ZodTypeAny,
  TQuery extends z.ZodTypeAny,
  TBody extends z.ZodTypeAny,
> extends BaseRouteArgs<TParams, TQuery, TBody> {
  handler: (
    x: Context,
    data: ValidatedRouteInput<TParams, TQuery, TBody>,
    req: Request,
    res: Response,
  ) => Promise<void> | void;
}

export const emptyRouteSchema = z.object({});
export const unknownRouteSchema = z.unknown();

function authenticationFailure(res: Response, status: number, error: string): null {
  res.status(status).json({ error });
  return null;
}

function resolveRequestContext(
  rootX: Context,
  auth: HttpAuthPolicy,
  req: Request,
  res: Response,
): Context | null {
  if (auth === "public") return PublicHttpContext(rootX);
  if (auth === "public-drive") return PublicDriveContext(rootX);

  if (auth === "ask") {
    const authX = AskApiContext(rootX);
    const apiKey = xSecretService(authX).get(authX, "VITO_ASK_API_KEY");
    if (!apiKey) {
      return authenticationFailure(
        res,
        503,
        "Ask API is disabled — no VITO_ASK_API_KEY configured",
      );
    }
    const authHeader = req.headers.authorization ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    if (!token || token !== apiKey) {
      return authenticationFailure(res, 401, "Unauthorized — invalid or missing API key");
    }
    if (!xAskApiService(authX).isConfigured(authX)) {
      return authenticationFailure(res, 503, "Ask handler not configured");
    }
    return authX;
  }

  const authX = DashboardAuthContext(rootX);
  const authService = xDashboardAuthService(authX);
  if (!authService.isPasswordSet(authX)) {
    return authenticationFailure(
      res,
      403,
      "Dashboard password not set. Complete /api/auth/setup first.",
    );
  }
  if (!authService.isAuthenticated(authX, req.headers.cookie)) {
    return authenticationFailure(res, 401, "Unauthorized");
  }
  return DashboardUserContext(rootX);
}

function methodHasBody(method: HttpMethod): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH";
}

function parseJsonBody(req: Request, res: Response, parser: RequestHandler): Promise<void> {
  return new Promise((resolve, reject) => {
    parser(req, res, (error?: unknown) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

const bodyParserErrorSchema = z
  .object({
    type: z.string().optional(),
    status: z.number().int().optional(),
    statusCode: z.number().int().optional(),
  })
  .passthrough();

function handleBodyParserError(error: unknown, res: Response): boolean {
  const parsed = bodyParserErrorSchema.safeParse(error);
  if (!parsed.success) return false;
  const status = parsed.data.status ?? parsed.data.statusCode;
  if (status === 413 || parsed.data.type === "entity.too.large") {
    res.status(413).json({ error: "Request body too large" });
    return true;
  }
  if (status === 400 || parsed.data.type === "entity.parse.failed") {
    res.status(400).json({ error: "Invalid JSON body" });
    return true;
  }
  return false;
}

function parseRequest<
  TParams extends z.ZodTypeAny,
  TQuery extends z.ZodTypeAny,
  TBody extends z.ZodTypeAny,
>(
  schemas: RouteSchemas<TParams, TQuery, TBody>,
  req: Request,
  res: Response,
): ValidatedRouteInput<TParams, TQuery, TBody> | null {
  const params = schemas.params.safeParse(req.params);
  const query = schemas.query.safeParse(req.query);
  const body = schemas.body.safeParse(req.body);
  const failures = [
    { location: "params", result: params },
    { location: "query", result: query },
    { location: "body", result: body },
  ].filter((entry) => !entry.result.success);

  if (failures.length > 0) {
    const issues = failures.flatMap((failure) => {
      if (failure.result.success) return [];
      return failure.result.error.issues.map((issue) => ({
        path: [failure.location, ...issue.path].join("."),
        message: issue.message,
        code: issue.code,
      }));
    });
    res.status(400).json({ error: "Invalid request", issues });
    return null;
  }
  if (!params.success || !query.success || !body.success) return null;
  return { params: params.data, query: query.data, body: body.data };
}

const statusByVitoErrorCode = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
} satisfies Record<VitoErrorData["code"], number>;

function safeErrorType(error: unknown): string {
  try {
    if (error instanceof Error) {
      const name = error.name;
      return typeof name === "string" && name.length > 0 ? name.slice(0, 80) : "Error";
    }
  } catch {
    return "UnknownThrownValue";
  }
  return "UnknownThrownValue";
}

function toVitoError(error: unknown): VitoError {
  try {
    if (error instanceof VitoError) {
      const parsed = vitoErrorDataSchema.safeParse(error.data);
      if (parsed.success) return error;
    }
  } catch {
    // Treat malformed or hostile thrown values as unknown internal failures.
  }
  return new VitoError(
    { code: "INTERNAL_ERROR", message: "Internal server error" },
    { cause: error },
  );
}

function toErrorResponse(data: VitoErrorData): VitoErrorResponse {
  const { code, message, ...details } = data;
  return {
    error: message,
    code,
    ...(Object.keys(details).length > 0 ? { details } : {}),
  };
}

function handleRouteError(error: unknown, req: Request, res: Response, next: NextFunction): void {
  if (handleBodyParserError(error, res)) return;
  const vitoError = toVitoError(error);
  const status = statusByVitoErrorCode[vitoError.data.code];

  if (status >= 500) {
    console.error(
      `[HTTP] ${req.method} ${req.path} failed code=${vitoError.data.code} type=${safeErrorType(error)}`,
    );
  }

  if (res.headersSent) {
    next(vitoError);
    return;
  }
  res.status(status).json(toErrorResponse(vitoError.data));
}

async function prepareRequest<
  TParams extends z.ZodTypeAny,
  TQuery extends z.ZodTypeAny,
  TBody extends z.ZodTypeAny,
>(
  rootX: Context,
  args: BaseRouteArgs<TParams, TQuery, TBody>,
  req: Request,
  res: Response,
  jsonParser: RequestHandler | undefined,
): Promise<{
  x: Context;
  data: ValidatedRouteInput<TParams, TQuery, TBody>;
} | null> {
  const requestX = resolveRequestContext(rootX, args.auth, req, res);
  if (!requestX) return null;
  if (jsonParser) await parseJsonBody(req, res, jsonParser);
  const data = parseRequest(args.schemas, req, res);
  return data ? { x: requestX, data } : null;
}

function mountRoute(router: Router, method: HttpMethod, path: string, handler: RequestHandler) {
  switch (method) {
    case "GET":
      router.get(path, handler);
      return;
    case "POST":
      router.post(path, handler);
      return;
    case "PUT":
      router.put(path, handler);
      return;
    case "PATCH":
      router.patch(path, handler);
      return;
    case "DELETE":
      router.delete(path, handler);
      return;
    case "OPTIONS":
      router.options(path, handler);
  }
}

export function registerRoute<
  TParams extends z.ZodTypeAny,
  TQuery extends z.ZodTypeAny,
  TBody extends z.ZodTypeAny,
  TResponse extends z.ZodTypeAny,
>(rootX: Context, args: RegisterRouteArgs<TParams, TQuery, TBody, TResponse>): void {
  const jsonParser = methodHasBody(args.method)
    ? express.json({ limit: args.jsonLimit ?? DEFAULT_JSON_LIMIT })
    : undefined;
  mountRoute(args.router, args.method, args.path, async (req, res, next) => {
    try {
      const prepared = await prepareRequest(rootX, args, req, res, jsonParser);
      if (!prepared) return;
      const result = await args.handler(prepared.x, { data: prepared.data, req, res });
      if (res.headersSent) return;
      const response = args.responseSchema.parse(result);
      const status = args.successStatus ?? 200;
      if (status === 204) {
        res.status(status).end();
        return;
      }
      res.status(status).json(response);
    } catch (error) {
      if (args.delegateErrors) {
        if (handleBodyParserError(error, res)) return;
        next(error);
        return;
      }
      handleRouteError(error, req, res, next);
    }
  });
}

export function registerStreamRoute<
  TParams extends z.ZodTypeAny,
  TQuery extends z.ZodTypeAny,
  TBody extends z.ZodTypeAny,
>(rootX: Context, args: RegisterStreamRouteArgs<TParams, TQuery, TBody>): void {
  const jsonParser = methodHasBody(args.method)
    ? express.json({ limit: args.jsonLimit ?? DEFAULT_JSON_LIMIT })
    : undefined;
  mountRoute(args.router, args.method, args.path, async (req, res, next) => {
    try {
      const prepared = await prepareRequest(rootX, args, req, res, jsonParser);
      if (!prepared) return;
      await args.handler(prepared.x, prepared.data, req, res);
    } catch (error) {
      if (handleBodyParserError(error, res)) return;
      next(error);
    }
  });
}
