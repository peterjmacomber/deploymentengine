import type {
  AddressValidationResult,
  ApiKey,
  AuditEntry,
  AuthenticatedPrincipal,
  Bundle,
  DevicePriceRow,
  CreateExceptionInput,
  CreateMerchantInput,
  CreateOrderInput,
  CreateLinkInput,
  CreateReturnInput,
  CreateUserInput,
  DecideExceptionInput,
  DeployedEquipment,
  DeploymentLink,
  LinkOrderInput,
  PublicLinkConfig,
  UpdateLinkInput,
  ExceptionRequest,
  ForecastRow,
  InventoryAlert,
  InventoryItem,
  Merchant,
  Order,
  ReturnCase,
  ShippingMethod,
  ShippingTier,
  UpdateUserInput,
  UpsertBundleInput,
  User,
} from '@de/shared';

export interface ShippingConfig {
  tiers: ShippingTier[];
  additionalDeviceFee: number;
}

export interface PolicyConfig {
  returnWindowDays: number;
  warrantyDays: number;
  courtesyRequiresApproval: boolean;
}

export interface FortisTerminalConfig {
  manufacturerCode: string;
  applicationId: string;
  cvmId: string;
}

export interface FortisTerminalOption {
  id: string;
  label: string;
  manufacturerCode?: string;
}

export interface FortisTerminalOptions {
  manufacturers: FortisTerminalOption[];
  applications: FortisTerminalOption[];
  cvms: FortisTerminalOption[];
}

export interface PortalSummary {
  orders: number;
  activeDevices: number;
  openReturns: number;
  openSwaps: number;
}

export interface PortalIssueDef {
  code: string;
  label: string;
  summary: string;
  help: string[];
  remedy: 'RETURN' | 'REPLACEMENT' | 'REPAIR';
  reasonCode: string;
}

export interface PortalIssueResult {
  case: ReturnCase;
  outcome: 'submitted' | 'pending_review';
  message: string;
}

const TOKEN_KEY = 'de_token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  status: number;
  detail?: string;
  fieldErrors?: Record<string, string[]>;
  constructor(status: number, title: string, detail?: string, fieldErrors?: Record<string, string[]>) {
    super(detail || title);
    this.status = status;
    this.detail = detail;
    this.fieldErrors = fieldErrors;
  }
}

interface RequestOpts {
  auth?: boolean; // attach bearer token (default true)
  apiKey?: string; // for the public/embed plane
}

async function request<T>(method: string, path: string, body?: unknown, opts: RequestOpts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.apiKey) headers['X-API-Key'] = opts.apiKey;
  else if (opts.auth !== false) {
    const token = tokenStore.get();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });

  if (res.status === 401 && opts.auth !== false && !opts.apiKey) {
    tokenStore.clear();
    window.dispatchEvent(new CustomEvent('de:unauthorized'));
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new ApiError(res.status, data?.title ?? res.statusText, data?.detail, data?.errors);
  }
  return data as T;
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      request<{ token: string; user: User }>('POST', '/api/v1/auth/login', { email, password }, { auth: false }),
    me: () => request<{ principal: AuthenticatedPrincipal }>('GET', '/api/v1/auth/me'),
  },
  dashboard: {
    get: () =>
      request<{
        kpis: Record<string, number>;
        ordersByStatus: Record<string, number>;
        recentOrders: Order[];
      }>('GET', '/api/v1/dashboard'),
  },
  merchants: {
    list: (search?: string) => request<{ merchants: Merchant[] }>('GET', `/api/v1/merchants${search ? `?search=${encodeURIComponent(search)}` : ''}`),
    get: (id: number) => request<{ merchant: Merchant }>('GET', `/api/v1/merchants/${id}`),
    create: (input: CreateMerchantInput) => request<{ merchant: Merchant }>('POST', '/api/v1/merchants', input),
    portalUsers: (id: number) => request<{ users: User[] }>('GET', `/api/v1/merchants/${id}/portal-users`),
    createPortalUser: (id: number, input: { email: string; name: string; password: string }) =>
      request<{ user: User }>('POST', `/api/v1/merchants/${id}/portal-users`, input),
    impersonate: (id: number) => request<{ token: string; merchant: { id: number; dbaName: string } }>('POST', `/api/v1/merchants/${id}/impersonate`),
  },
  orders: {
    list: (q: { status?: string; merchantId?: number; search?: string } = {}) => {
      const p = new URLSearchParams();
      if (q.status) p.set('status', q.status);
      if (q.merchantId) p.set('merchantId', String(q.merchantId));
      if (q.search) p.set('search', q.search);
      const qs = p.toString();
      return request<{ orders: Order[] }>('GET', `/api/v1/orders${qs ? `?${qs}` : ''}`);
    },
    get: (id: number, refresh = false) => request<{ order: Order }>('GET', `/api/v1/orders/${id}${refresh ? '?refresh=true' : ''}`),
    create: (input: CreateOrderInput) => request<{ order: Order }>('POST', '/api/v1/orders', input),
    cancel: (id: number) => request<{ order: Order }>('POST', `/api/v1/orders/${id}/cancel`),
    activity: (id: number) => request<{ entries: AuditEntry[] }>('GET', `/api/v1/orders/${id}/activity`),
    shareToken: (id: number) => request<{ token: string }>('POST', `/api/v1/orders/${id}/share-token`),
  },
  shipping: {
    validateAddress: (address: unknown) => request<AddressValidationResult>('POST', '/api/v1/shipping/validate-address', address),
    quote: (input: { address: unknown; cart: Array<{ pospBundleId: number; quantity: number }> }) =>
      request<{ methods: ShippingMethod[] }>('POST', '/api/v1/shipping/quote', input),
  },
  returns: {
    list: (q: { lifecycle?: string; merchantId?: number } = {}) => {
      const p = new URLSearchParams();
      if (q.lifecycle) p.set('lifecycle', q.lifecycle);
      if (q.merchantId) p.set('merchantId', String(q.merchantId));
      const qs = p.toString();
      return request<{ returns: ReturnCase[] }>('GET', `/api/v1/returns${qs ? `?${qs}` : ''}`);
    },
    get: (id: number) => request<{ return: ReturnCase }>('GET', `/api/v1/returns/${id}`),
    activity: (id: number) => request<{ entries: AuditEntry[] }>('GET', `/api/v1/returns/${id}/activity`),
    reasons: (type: string) => request<{ reasons: Array<{ id: number; description: string }> }>('GET', `/api/v1/returns/reasons/${type}`),
    create: (input: CreateReturnInput) => request<{ return: ReturnCase }>('POST', '/api/v1/returns', input),
    receive: (id: number, receivedItemCount: number) => request<{ return: ReturnCase }>('POST', `/api/v1/returns/${id}/receive`, { receivedItemCount }),
  },
  deployed: {
    list: (q: { merchantId?: number; orderId?: number; status?: string; search?: string } = {}) => {
      const p = new URLSearchParams();
      if (q.merchantId) p.set('merchantId', String(q.merchantId));
      if (q.orderId) p.set('orderId', String(q.orderId));
      if (q.status) p.set('status', q.status);
      if (q.search) p.set('search', q.search);
      const qs = p.toString();
      return request<{ equipment: DeployedEquipment[] }>('GET', `/api/v1/deployed-equipment${qs ? `?${qs}` : ''}`);
    },
    setStatus: (id: number, status: string) => request<{ equipment: DeployedEquipment }>('POST', `/api/v1/deployed-equipment/${id}/status`, { status }),
  },
  inventory: {
    consigned: () => request<{ items: InventoryItem[]; totals: Record<string, number> }>('GET', '/api/v1/inventory/consigned'),
    forecast: () => request<{ rows: ForecastRow[]; alerts: InventoryAlert[]; buyPlan: ForecastRow[]; metrics: Record<string, number> }>('GET', '/api/v1/inventory/forecast'),
    setEstimate: (newPartId: string, month: string, qty: number) => request<{ ok: boolean }>('POST', '/api/v1/inventory/forecast/estimate', { newPartId, month, qty }),
  },
  bundles: {
    list: () => request<{ bundles: Bundle[] }>('GET', '/api/v1/bundles'),
    listActive: () => request<{ bundles: Bundle[] }>('GET', '/api/v1/bundles/active'),
    upsert: (input: UpsertBundleInput) => request<{ bundle: Bundle }>('POST', '/api/v1/bundles', input),
    import: (tagId?: number) => request<{ imported: number }>('POST', '/api/v1/bundles/import', { tagId }),
    setActive: (id: number, active: boolean) => request<{ bundle: Bundle }>('POST', `/api/v1/bundles/${id}/active`, { active }),
    bulkSetActive: (pospBundleIds: number[], active: boolean) => request<{ updated: number }>('POST', '/api/v1/bundles/bulk-active', { pospBundleIds, active }),
    setPrice: (id: number, price: number | null) => request<{ bundle: Bundle }>('POST', `/api/v1/bundles/${id}/price`, { price }),
    applyPricing: () => request<{ updated: number; unmatched: string[] }>('POST', '/api/v1/bundles/apply-pricing'),
    remove: (id: number) => request<void>('DELETE', `/api/v1/bundles/${id}`),
    devicePrices: () => request<{ devicePrices: DevicePriceRow[] }>('GET', '/api/v1/bundles/device-prices'),
    setDevicePrice: (id: number, price: number) => request<{ rows: DevicePriceRow[]; bundlesUpdated: number }>('POST', `/api/v1/bundles/device-prices/${id}`, { price }),
  },
  exceptions: {
    list: (q: { status?: string; type?: string } = {}) => {
      const p = new URLSearchParams();
      if (q.status) p.set('status', q.status);
      if (q.type) p.set('type', q.type);
      const qs = p.toString();
      return request<{ exceptions: ExceptionRequest[] }>('GET', `/api/v1/exceptions${qs ? `?${qs}` : ''}`);
    },
    create: (input: CreateExceptionInput) => request<{ exception: ExceptionRequest }>('POST', '/api/v1/exceptions', input),
    decide: (id: number, input: DecideExceptionInput) => request<{ exception: ExceptionRequest }>('POST', `/api/v1/exceptions/${id}/decide`, input),
  },
  users: {
    list: () => request<{ users: User[] }>('GET', '/api/v1/users'),
    create: (input: CreateUserInput) => request<{ user: User }>('POST', '/api/v1/users', input),
    update: (id: number, input: UpdateUserInput) => request<{ user: User }>('PATCH', `/api/v1/users/${id}`, input),
  },
  apiKeys: {
    list: () => request<{ apiKeys: ApiKey[] }>('GET', '/api/v1/api-keys'),
    create: (name: string) => request<{ apiKey: ApiKey; raw: string }>('POST', '/api/v1/api-keys', { name }),
    setActive: (id: number, active: boolean) => request<{ apiKey: ApiKey }>('POST', `/api/v1/api-keys/${id}/active`, { active }),
    remove: (id: number) => request<void>('DELETE', `/api/v1/api-keys/${id}`),
  },
  audit: {
    list: (q: { limit?: number; actor?: string; action?: string } = {}) => {
      const p = new URLSearchParams();
      if (q.limit) p.set('limit', String(q.limit));
      if (q.actor) p.set('actor', q.actor);
      if (q.action) p.set('action', q.action);
      const qs = p.toString();
      return request<{ entries: AuditEntry[] }>('GET', `/api/v1/audit${qs ? `?${qs}` : ''}`);
    },
  },
  links: {
    list: () => request<{ links: DeploymentLink[] }>('GET', '/api/v1/links'),
    create: (input: CreateLinkInput) => request<{ link: DeploymentLink }>('POST', '/api/v1/links', input),
    update: (id: number, patch: UpdateLinkInput) => request<{ link: DeploymentLink }>('PATCH', `/api/v1/links/${id}`, patch),
    remove: (id: number) => request<void>('DELETE', `/api/v1/links/${id}`),
  },
  settings: {
    getShipping: () => request<ShippingConfig>('GET', '/api/v1/settings/shipping'),
    setShipping: (cfg: ShippingConfig) => request<ShippingConfig>('PUT', '/api/v1/settings/shipping', cfg),
    getPolicy: () => request<PolicyConfig>('GET', '/api/v1/settings/policy'),
    setPolicy: (cfg: PolicyConfig) => request<PolicyConfig>('PUT', '/api/v1/settings/policy', cfg),
  },
  fortis: {
    status: () => request<{
      configured: boolean; baseUrl: string | null; merchantLoginUrl: string | null; linkField: string;
      credentials: Record<string, boolean>;
    }>('GET', '/api/v1/fortis/status'),
    test: () => request<{ ok: boolean; detail: string; status?: number }>('POST', '/api/v1/fortis/test'),
    search: (q: string) => request<{ locations: Array<{ id: string; name: string; accountNumber: string | null; locationType?: string }> }>('GET', `/api/v1/fortis/search?q=${encodeURIComponent(q)}`),
    link: (input: { merchantId: number; fortisLocationId: string; fortisLocationName?: string }) =>
      request<{ merchantId: number; fortisLocationId: string | null; fortisLocationName: string | null }>('POST', '/api/v1/fortis/link', input),
    activate: (input: { serialNumber: string; locationId?: string; merchantId?: number; title?: string }) =>
      request<{ serialNumber: string; linksValue: string; accountId?: string; terminalId?: string; activated: boolean; status: string; error?: string }>('POST', '/api/v1/fortis/activate', input),
    terminalOptions: () => request<FortisTerminalOptions>('GET', '/api/v1/fortis/terminal-options'),
    getTerminalDefaults: () => request<FortisTerminalConfig>('GET', '/api/v1/fortis/terminal-defaults'),
    saveTerminalDefaults: (cfg: FortisTerminalConfig) => request<FortisTerminalConfig>('PUT', '/api/v1/fortis/terminal-defaults', cfg),
  },
  portal: {
    me: () => request<{ merchant: Merchant; summary: PortalSummary; impersonatedBy: string | null }>('GET', '/api/v1/portal/me'),
    orders: () => request<{ orders: Order[] }>('GET', '/api/v1/portal/orders'),
    order: (id: number) => request<{ order: Order }>('GET', `/api/v1/portal/orders/${id}`),
    returns: () => request<{ returns: ReturnCase[] }>('GET', '/api/v1/portal/returns'),
    deployed: () => request<{ equipment: DeployedEquipment[] }>('GET', '/api/v1/portal/deployed'),
    issueOptions: () => request<{ devices: DeployedEquipment[]; issues: PortalIssueDef[] }>('GET', '/api/v1/portal/issues/options'),
    submitIssue: (input: { issueCode: string; deployedEquipmentId?: number; serialNumber?: string; wantsReplacement?: boolean; notes?: string }) =>
      request<PortalIssueResult>('POST', '/api/v1/portal/issues', input),
  },
  dev2: {
    importSandbox: (fresh: boolean, orders = 60) => request<{ bundles: number; orders: number; deployed: number; merchants: number; returns: number; priced: number }>('POST', '/api/v1/dev/import-sandbox', { fresh, orders }),
  },
  dev: {
    ship: (id: number, serialNumbers?: string[]) => request<{ order: Order }>('POST', `/api/v1/dev/orders/${id}/ship`, { serialNumbers }),
    deliver: (id: number, signedBy?: string) => request<{ order: Order }>('POST', `/api/v1/dev/orders/${id}/deliver`, { signedBy }),
  },
};

// ---- Public / embed plane (simulates an external partner using a shared API key) ----
const PUBLIC_KEY = (import.meta.env.VITE_PUBLIC_API_KEY as string) || 'demo-partner-key';

export interface PublicTrackSummary {
  reference?: string;
  status: string;
  placedAt: string;
  shippingMethodLabel?: string;
  items: Array<{ name: string; quantity: number }>;
  serials: string[];
  packages: Array<{ carrier?: string; trackingNumber?: string; status?: string; shippedAt?: string; deliveredAt?: string }>;
}

// ---- Public sanitized order tracking (share token is the credential; no API key, no PII) ----
export const publicTrack = {
  get: (token: string) => request<PublicTrackSummary>('GET', `/api/public/v1/track/${token}`, undefined, { auth: false }),
};

// ---- Public deployment-link pages (token is the credential; no API key) ----
export const publicLink = {
  resolve: (token: string, password?: string) =>
    request<PublicLinkConfig>('GET', `/api/public/v1/link/${token}${password ? `?password=${encodeURIComponent(password)}` : ''}`, undefined, { auth: false }),
  order: (token: string, input: LinkOrderInput) =>
    request<{ order: { id: number; reference?: string; status: string }; redirectUrl?: string }>('POST', `/api/public/v1/link/${token}/order`, input, { auth: false }),
  orderStatus: (token: string, orderId: number) =>
    request<{ order: { id: number; reference?: string; status: string; packages: import('@de/shared').Package[]; serialNumbers: string[] } }>('GET', `/api/public/v1/link/${token}/order/${orderId}`, undefined, { auth: false }),
  tax: (token: string, input: { cart: Array<{ pospBundleId: number; quantity: number }>; address: unknown }) =>
    request<{ subtotal: number; customFeeName?: string; customFee: number; tax: number; taxRate: number; taxProvider: string; taxNote?: string; total: number }>('POST', `/api/public/v1/link/${token}/tax`, input, { auth: false }),
};

export const publicApi = {
  bundles: () =>
    request<{ bundles: Array<{ pospBundleId: number; displayName: string; description?: string; items: Bundle['items']; application?: string; price?: number }> }>(
      'GET',
      '/api/public/v1/bundles',
      undefined,
      { apiKey: PUBLIC_KEY },
    ),
  validateAddress: (address: unknown) => request<AddressValidationResult>('POST', '/api/public/v1/validate-address', address, { apiKey: PUBLIC_KEY }),
  quote: (input: { address: unknown; cart: Array<{ pospBundleId: number; quantity: number }> }) =>
    request<{ methods: ShippingMethod[] }>('POST', '/api/public/v1/quote', input, { apiKey: PUBLIC_KEY }),
  createOrder: (input: unknown) =>
    request<{ order: { id: number; reference?: string; status: string }; redirectUrl?: string }>('POST', '/api/public/v1/orders', input, { apiKey: PUBLIC_KEY }),
  getOrder: (id: number) =>
    request<{ order: { id: number; reference?: string; status: string; packages: Order['packages']; serialNumbers: string[] } }>(
      'GET',
      `/api/public/v1/orders/${id}`,
      undefined,
      { apiKey: PUBLIC_KEY },
    ),
};
