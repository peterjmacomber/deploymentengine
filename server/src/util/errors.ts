import type { ProblemDetails } from '@de/shared';

/** Application error carrying an HTTP status + RFC-7807 fields. Thrown by services/routes;
 *  the error middleware renders it as problem+json. */
export class AppError extends Error {
  status: number;
  type: string;
  detail?: string;
  errors?: Record<string, string[]>;

  constructor(status: number, title: string, opts: { type?: string; detail?: string; errors?: Record<string, string[]> } = {}) {
    super(title);
    this.name = 'AppError';
    this.status = status;
    this.type = opts.type ?? 'about:blank';
    this.detail = opts.detail;
    this.errors = opts.errors;
  }

  toProblem(instance?: string): ProblemDetails {
    return {
      type: this.type,
      title: this.message,
      status: this.status,
      detail: this.detail,
      instance,
      errors: this.errors,
    };
  }
}

export const badRequest = (detail?: string, errors?: Record<string, string[]>) =>
  new AppError(400, 'Bad Request', { detail, errors });
export const unauthorized = (detail?: string) => new AppError(401, 'Unauthorized', { detail });
export const forbidden = (detail?: string) => new AppError(403, 'Forbidden', { detail });
export const notFound = (detail?: string) => new AppError(404, 'Not Found', { detail });
export const conflict = (detail?: string) => new AppError(409, 'Conflict', { detail });
export const unprocessable = (detail?: string, errors?: Record<string, string[]>) =>
  new AppError(422, 'Unprocessable Entity', { detail, errors });
