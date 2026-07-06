import type { NextFunction, Request, Response } from 'express';
import type { ProblemDetails } from '@de/shared';
import { AppError } from '../../util/errors.js';
import { logger } from '../../logger.js';
import { config } from '../../config.js';

/** 404 for unmatched routes. */
export function notFoundHandler(req: Request, res: Response) {
  const problem: ProblemDetails = {
    type: 'about:blank',
    title: 'Not Found',
    status: 404,
    detail: `No route for ${req.method} ${req.path}`,
    instance: req.originalUrl,
  };
  res.status(404).type('application/problem+json').json(problem);
}

/** Central error handler → RFC-7807 problem+json. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;

  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ err, path: req.path }, 'request error');
    return res
      .status(err.status)
      .type('application/problem+json')
      .json(err.toProblem(req.originalUrl));
  }

  logger.error({ err, path: req.path }, 'unhandled error');
  const problem: ProblemDetails = {
    type: 'about:blank',
    title: 'Internal Server Error',
    status: 500,
    detail: config.isProd ? undefined : (err as Error)?.message,
    instance: req.originalUrl,
  };
  res.status(500).type('application/problem+json').json(problem);
}
