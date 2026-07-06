import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { unprocessable } from '../../util/errors.js';

type Source = 'body' | 'query' | 'params';

/** Validate + coerce a request part against a Zod schema. The parsed value replaces the
 *  original (so downstream handlers get typed, sanitized input). */
export function validate(schema: ZodTypeAny, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors as Record<string, string[]>;
      return next(unprocessable('Validation failed', fieldErrors));
    }
    // query/params are read-only getters in some Express versions; assign defensively.
    if (source === 'body') req.body = result.data;
    else Object.assign(req[source], result.data);
    next();
  };
}
