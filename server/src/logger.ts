import pino from 'pino';
import { config } from './config.js';

/**
 * Structured logger (NDJSON to stdout). Redaction keys ensure secrets/tokens never land in
 * logs. Pipe through `pino-pretty` in a terminal if you want colorized dev output.
 */
export const logger = pino({
  level: config.isProd ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.passwordHash',
      '*.clientSecret',
      '*.access_token',
      '*.token',
    ],
    censor: '[redacted]',
  },
});
