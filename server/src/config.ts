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
    // Connectivity check against both upstream sandboxes (POS Portal + Fortis), independent of
    // whether there are in-flight orders — feeds the admin System Status page.
    STATUS_POLL_INTERVAL_SECONDS: z.coerce.number().default(300),
    // Local snapshot of consigned inventory, refreshed on a timer instead of live-per-request.
    INVENTORY_POLL_INTERVAL_SECONDS: z.coerce.number().default(900),
    // Full paginated re-sync of Fortis Gateway locations into the local cache (8,500+ rows —
    // infrequent by design; the admin Fortis Gateway page can also trigger it on demand).
    FORTIS_LOCATION_SYNC_INTERVAL_SECONDS: z.coerce.number().default(21_600),

    // Tax (prototype structure for future Avalara + direct billing). none | mock | avalara
    TAX_MODE: z.enum(['none', 'mock', 'avalara']).default('none'),
    TAX_RATE: z.coerce.number().default(0), // mock flat rate, e.g. 0.0775
    AVALARA_BASE_URL: z.string().url().default('https://sandbox-rest.avatax.com'),
    AVALARA_ACCOUNT_ID: z.string().optional(),
    AVALARA_LICENSE_KEY: z.string().optional(),
    AVALARA_COMPANY_CODE: z.string().optional(),

    FORTIS_BASE_URL: z.string().url().optional(),
    // Terminal provisioning (create/list/update) lives on a DIFFERENT host than merchant/location
    // search: verified live 2026-07-16 — FORTIS_BASE_URL (api.sandbox.fortis.tech) serves /v1
    // locations (200) but 403s on /v2/terminals; api.sandbox.zeamster.com serves /v2/terminals
    // (200) but 404s on /v1/locations. These are not interchangeable.
    FORTIS_TERMINALS_BASE_URL: z.string().url().default('https://api.sandbox.zeamster.com'),
    FORTIS_MERCHANT_LOGIN_URL: z.string().url().optional(),
    FORTIS_DEVELOPER_ID: z.string().optional(),
    FORTIS_USER_ID: z.string().optional(),
    FORTIS_USER_NAME: z.string().optional(),
    FORTIS_USER_API_KEY: z.string().optional(),
    FORTIS_USER_HASH_KEY: z.string().optional(),
    FORTIS_TICKET_HASH_KEY: z.string().optional(),
    // Which set of per-bundle Fortis terminal ids (manufacturer/application/CVM) to use.
    // Sandbox and production are different Fortis accounts with different ids for the same
    // device (confirmed live 2026-07-20 — e.g. Ingenico Tetra Lane has a different application
    // id in each). Flip to 'production' together with pointing FORTIS_BASE_URL/credentials at
    // the real production Fortis account, to run a genuine end-to-end production test.
    FORTIS_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
    FORTIS_LOCATION_ID: z.string().optional(),
    // Fortis has no self-service "create a merchant account" API (POST /v1/onboarding is a full
    // underwriting/boarding application requiring a template_code we don't have and likely
    // resolves to a pending application, not an instantly-usable location). So the public Apply
    // flow links every new merchant to ONE pre-created sandbox location instead of creating a
    // new one per applicant. This location has no account_number (per the account owner).
    FORTIS_APPLY_LOCATION_ID: z.string().optional(),
    FORTIS_TERMINAL_ID: z.string().optional(),
    FORTIS_TERMINAL_APPLICATION_ID: z.string().optional(),
    FORTIS_TERMINAL_CVM_ID: z.string().optional(),
    FORTIS_TERMINAL_MANUFACTURER_ID: z.string().optional(),
    // Fortis terminal_manufacturer_code (string): 2=Ingenico, 1=PAX, 4=IDtech, 100=Virtual Device.
    // Admin-configurable per install via the Fortis Gateway page; this is only the seed default.
    FORTIS_TERMINAL_MANUFACTURER_CODE: z.string().default('2'),
    FORTIS_LINK_FIELD: z.string().default('terminal_api_id'),
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
    // Fortis is always the live client (no mock). Missing creds don't block boot — the
    // Fortis features surface a clear "not configured" error until the .env is filled.
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
  // Fortis is usable once the base URL + core credentials are present.
  fortisConfigured: Boolean(raw.FORTIS_BASE_URL && raw.FORTIS_DEVELOPER_ID && raw.FORTIS_USER_ID && raw.FORTIS_USER_API_KEY),
};

export type AppConfig = typeof config;
