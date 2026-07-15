import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment configuration, validated at boot. The process refuses to start with an
 * invalid/missing security-critical variable. Secrets are read from env only and never
 * persisted or logged.
 */
const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === 'true' || v === '1')
  .pipe(z.boolean());

const envSchema = z
  .object({
    NODE_ENV: z.string().default('development'),
    PORT: z.coerce.number().default(8090),
    CORS_ORIGIN: z.string().default('http://localhost:5175'),

    JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
    JWT_ACCESS_TTL: z.coerce.number().default(3600),
    BCRYPT_ROUNDS: z.coerce.number().min(10).max(15).default(12),

    DATABASE_URL: z.string().default('file:./dev.db'),

    POSP_MODE: z.enum(['mock', 'live']).default('mock'),
    POSP_BASE_URL: z.string().url().default('https://sandbox-wapi.posportal.com/v2'),
    POSP_TOKEN_URL: z.string().url().optional(),
    POSP_SCOPE: z.string().optional(),
    POSP_CLIENT_ID: z.string().optional(),
    POSP_CLIENT_SECRET: z.string().optional(),
    // Order-create tunables (account-dependent). Payment type/id are only sent when set;
    // otherwise the order relies on the merchant's configured billing terms.
    POSP_DEFAULT_SHIP_METHOD_ID: z.coerce.number().default(21),
    POSP_DEFAULT_CARRIER: z.string().default('FEDEX'),
    // Orders bill to the CLIENT (Fortis) by default — Fortis handles merchant billing itself,
    // exactly like placing orders on the POS Portal website.
    POSP_ORDER_WHO_PAYS: z.string().default('CLIENT'),
    POSP_ORDER_BILL_TO: z.string().default('CLIENT'),
    // Finalize the created DRAFT into an OPEN (submitted) order so it enters fulfillment.
    POSP_SUBMIT_ORDERS: bool.default(true),
    POSP_ORDER_PAYMENT_TYPE: z.string().optional(),
    POSP_ORDER_PAYMENT_ID: z.coerce.number().optional(),
    POSP_RETURN_ISSUED_BY: z.string().default('Deployment Engine'),
    // When true, a failed live write throws instead of recording locally (full production mode).
    POSP_STRICT_WRITES: bool.default(false),
    // Background poller: watches in-flight orders and pulls serials + activates Fortis when
    // POS Portal ships (no employee copy/paste needed). Live mode only.
    POLL_ENABLED: bool.default(true),
    POLL_INTERVAL_SECONDS: z.coerce.number().default(300),

    // Tax (prototype structure for future Avalara + direct billing). none | mock | avalara
    TAX_MODE: z.enum(['none', 'mock', 'avalara']).default('none'),
    TAX_RATE: z.coerce.number().default(0), // mock flat rate, e.g. 0.0775
    AVALARA_BASE_URL: z.string().url().default('https://sandbox-rest.avatax.com'),
    AVALARA_ACCOUNT_ID: z.string().optional(),
    AVALARA_LICENSE_KEY: z.string().optional(),
    AVALARA_COMPANY_CODE: z.string().optional(),

    FORTIS_MODE: z.enum(['mock', 'live']).default('mock'),
    FORTIS_BASE_URL: z.string().url().optional(),
    FORTIS_DEVELOPER_ID: z.string().optional(),
    FORTIS_USER_ID: z.string().optional(),
    FORTIS_USER_API_KEY: z.string().optional(),
    FORTIS_LOCATION_ID: z.string().optional(),
    FORTIS_TERMINAL_APPLICATION_ID: z.string().optional(),
    FORTIS_TERMINAL_MANUFACTURER_ID: z.string().optional(),
    FORTIS_TERMINAL_CVM_ID: z.string().optional(),
    // When true (and the API user has the "update terminals" privilege), switch from
    // create-on-activate to the placeholder-on-order + PUT-update-on-activate flow.
    FORTIS_UPDATE_MODE: bool.default(false),

    // Inbound webhooks are OFF by default: this app is intentionally polling-only (no public
    // ingress) for security. Flip to true ONLY if an AM provisions POS Portal webhooks AND the
    // receiver is safely exposed. Until then the /webhooks route is not even mounted.
    WEBHOOKS_ENABLED: bool.default(false),
    WEBHOOK_AUTH_SCHEME: z.enum(['apikey', 'hmac', 'bearer']).default('apikey'),
    WEBHOOK_API_KEY: z.string().optional(),
    WEBHOOK_HMAC_SECRET: z.string().optional(),

    PUBLIC_API_KEYS: z.string().default(''),
    PUBLIC_ALLOWED_RETURN_HOSTS: z.string().default('localhost'),

    // Business policy (overridable)
    RETURN_WINDOW_DAYS: z.coerce.number().default(30),
    WARRANTY_DAYS: z.coerce.number().default(365),
  })
  .superRefine((v, ctx) => {
    // Production hardening: refuse to boot with weak/default secrets.
    if (v.NODE_ENV === 'production') {
      if (v.JWT_SECRET.length < 32 || /change-me|dev-only|dev-local/i.test(v.JWT_SECRET)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['JWT_SECRET'], message: 'Set a strong, unique JWT_SECRET (32+ chars) in production' });
      }
      if (v.WEBHOOK_API_KEY && /change-me/i.test(v.WEBHOOK_API_KEY)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['WEBHOOK_API_KEY'], message: 'Set a non-default WEBHOOK_API_KEY in production' });
      }
      if (/demo-partner-key/.test(v.PUBLIC_API_KEYS)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['PUBLIC_API_KEYS'], message: 'Replace the demo partner API key in production' });
      }
    }
    if (v.POSP_MODE === 'live') {
      for (const k of ['POSP_CLIENT_ID', 'POSP_CLIENT_SECRET', 'POSP_TOKEN_URL', 'POSP_SCOPE'] as const) {
        if (!v[k]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [k], message: `${k} required when POSP_MODE=live` });
      }
    }
    if (v.FORTIS_MODE === 'live') {
      for (const k of ['FORTIS_BASE_URL', 'FORTIS_DEVELOPER_ID', 'FORTIS_LOCATION_ID'] as const) {
        if (!v[k]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [k], message: `${k} required when FORTIS_MODE=live` });
      }
    }
    if (v.WEBHOOKS_ENABLED && v.WEBHOOK_AUTH_SCHEME === 'apikey' && !v.WEBHOOK_API_KEY) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['WEBHOOK_API_KEY'], message: 'required for apikey scheme when WEBHOOKS_ENABLED' });
    }
    if (v.WEBHOOKS_ENABLED && v.WEBHOOK_AUTH_SCHEME === 'hmac' && !v.WEBHOOK_HMAC_SECRET) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['WEBHOOK_HMAC_SECRET'], message: 'required for hmac scheme when WEBHOOKS_ENABLED' });
    }
  });

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment configuration:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const raw = parsed.data;

/** Parse "key:label,key2:label2" into a map of apiKey -> partner label. */
function parsePublicKeys(spec: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const pair of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const idx = pair.indexOf(':');
    if (idx === -1) map.set(pair, pair);
    else map.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
  return map;
}

export const config = {
  ...raw,
  isProd: raw.NODE_ENV === 'production',
  corsOrigins: raw.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
  publicApiKeys: parsePublicKeys(raw.PUBLIC_API_KEYS),
  publicAllowedReturnHosts: raw.PUBLIC_ALLOWED_RETURN_HOSTS.split(',').map((s) => s.trim()).filter(Boolean),
};

export type AppConfig = typeof config;
