import type { Request, RequestHandler, Response } from "express";
import { z } from "zod";
import type { Context } from "../context/Context.js";

interface RouteSchemas<
  TParams extends z.ZodTypeAny,
  TQuery extends z.ZodTypeAny,
  TBody extends z.ZodTypeAny,
> {
  params: TParams;
  query: TQuery;
  body: TBody;
}

interface ValidatedRouteInput<
  TParams extends z.ZodTypeAny,
  TQuery extends z.ZodTypeAny,
  TBody extends z.ZodTypeAny,
> {
  params: z.output<TParams>;
  query: z.output<TQuery>;
  body: z.output<TBody>;
}

type ValidatedRouteHandler<
  TParams extends z.ZodTypeAny,
  TQuery extends z.ZodTypeAny,
  TBody extends z.ZodTypeAny,
> = (
  x: Context,
  input: ValidatedRouteInput<TParams, TQuery, TBody>,
  req: Request,
  res: Response
) => Promise<void> | void;

export const emptyRouteSchema = z.object({});
export const unknownRouteSchema = z.unknown();

export function validatedRoute<
  TParams extends z.ZodTypeAny,
  TQuery extends z.ZodTypeAny,
  TBody extends z.ZodTypeAny,
>(
  x: Context,
  schemas: RouteSchemas<TParams, TQuery, TBody>,
  handler: ValidatedRouteHandler<TParams, TQuery, TBody>
): RequestHandler {
  return async (req, res, next) => {
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
      return;
    }

    if (!params.success || !query.success || !body.success) return;

    try {
      await handler(x, {
        params: params.data,
        query: query.data,
        body: body.data,
      }, req, res);
    } catch (error) {
      next(error);
    }
  };
}
