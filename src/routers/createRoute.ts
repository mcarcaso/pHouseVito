import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import type { Context } from "../context/Context.js";
import { VitoError } from "../lib/VitoError.js";
import {
  vitoErrorDataSchema,
  type VitoErrorData,
  type VitoErrorResponse,
} from "../shared/schemas/vito-error.js";
import { DashboardUserContext } from "../context/DashboardUserContext.js";
import {
  AskApiContext,
  DashboardAuthContext,
  PublicDriveContext,
  PublicHttpContext,
} from "../context/HttpContext.js";
import { xAskApiService, xDashboardAuthService, xSecretService } from "../lib/x.js";

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
  auth: HttpAuthPolicy;
  schemas: RouteSchemas<TParams, TQuery, TBody>;
}

interface CreateRouteArgs<
  TParams extends z.ZodTypeAny,
  TQuery extends z.ZodTypeAny,
  TBody extends z.ZodTypeAny,
  TResponse extends z.ZodTypeAny,
> extends BaseRouteArgs<TParams, TQuery, TBody> {
  responseSchema: TResponse;
  handler: (
    x: Context,
    args: RouteHandlerArgs<ValidatedRouteInput<TParams, TQuery, TBody>>,
  ) => Promise<z.input<TResponse>> | z.input<TResponse>;
}

interface CreateRawRouteArgs<
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

export function createRoute<
  TParams extends z.ZodTypeAny,
  TQuery extends z.ZodTypeAny,
  TBody extends z.ZodTypeAny,
  TResponse extends z.ZodTypeAny,
>(rootX: Context, args: CreateRouteArgs<TParams, TQuery, TBody, TResponse>): RequestHandler {
  return async (req, res, next) => {
    const requestX = resolveRequestContext(rootX, args.auth, req, res);
    if (!requestX) return;
    const data = parseRequest(args.schemas, req, res);
    if (!data) return;
    try {
      const result = await args.handler(requestX, { data, req, res });
      res.json(args.responseSchema.parse(result));
    } catch (error) {
      handleRouteError(error, req, res, next);
    }
  };
}

export function createRawRoute<
  TParams extends z.ZodTypeAny,
  TQuery extends z.ZodTypeAny,
  TBody extends z.ZodTypeAny,
>(rootX: Context, args: CreateRawRouteArgs<TParams, TQuery, TBody>): RequestHandler {
  return async (req, res, next) => {
    const requestX = resolveRequestContext(rootX, args.auth, req, res);
    if (!requestX) return;
    const data = parseRequest(args.schemas, req, res);
    if (!data) return;
    try {
      await args.handler(requestX, data, req, res);
    } catch (error) {
      next(error);
    }
  };
}
