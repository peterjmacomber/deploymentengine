/**
 * Role -> permission grants. Shared so the server can enforce and the web can gate nav/UI.
 * The server is the source of truth (it re-derives permissions from the DB role); the web
 * uses this only for optimistic UI hiding — never for actual authorization.
 */
import { Permission, Role } from './enums.js';

const P = Permission;

const READONLY_GRANTS: Permission[] = [
  P.MERCHANT_READ,
  P.ORDER_READ,
  P.SHIPPING_READ,
  P.RETURN_READ,
  P.DEPLOYED_READ,
  P.INVENTORY_READ,
  P.FORECAST_READ,
  P.BUNDLE_READ,
  P.LINK_READ,
  P.EXCEPTION_READ,
];

const AGENT_GRANTS: Permission[] = [
  ...READONLY_GRANTS,
  P.MERCHANT_WRITE,
  P.ORDER_WRITE,
  P.ORDER_CANCEL,
  P.RETURN_WRITE,
  P.DEPLOYED_WRITE,
  P.EXCEPTION_REQUEST,
];

const MANAGER_GRANTS: Permission[] = [
  ...AGENT_GRANTS,
  P.EXCEPTION_APPROVE,
  P.LINK_WRITE,
  // Managers manage users too, but only below their own level (enforced server-side).
  P.USER_READ,
  P.USER_WRITE,
];

const ADMIN_GRANTS: Permission[] = [
  ...MANAGER_GRANTS,
  P.BUNDLE_WRITE,
  // Audit log is an admin area (managers no longer see it after the Management/Admin split).
  P.AUDIT_READ,
  P.APIKEY_MANAGE,
  P.DEV_TOOLS,
];

// External partner principal: only what the embed flow needs.
const PARTNER_GRANTS: Permission[] = [
  P.MERCHANT_WRITE,
  P.ORDER_WRITE,
  P.ORDER_READ,
  P.SHIPPING_READ,
  P.BUNDLE_READ,
];

/**
 * Integration API keys: everything an operator can do in the UI EXCEPT admin functions
 * (no user management, catalog/pricing edits, audit log, approvals, dev tools, or key mgmt).
 */
const API_KEY_GRANTS: Permission[] = [
  P.MERCHANT_READ, P.MERCHANT_WRITE,
  P.ORDER_READ, P.ORDER_WRITE, P.ORDER_CANCEL,
  P.SHIPPING_READ,
  P.RETURN_READ, P.RETURN_WRITE,
  P.DEPLOYED_READ, P.DEPLOYED_WRITE,
  P.INVENTORY_READ, P.FORECAST_READ,
  P.BUNDLE_READ,
  P.LINK_READ, P.LINK_WRITE,
  P.EXCEPTION_READ, P.EXCEPTION_REQUEST,
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.READONLY]: READONLY_GRANTS,
  [Role.AGENT]: AGENT_GRANTS,
  [Role.MANAGER]: MANAGER_GRANTS,
  [Role.ADMIN]: ADMIN_GRANTS,
  [Role.PARTNER]: PARTNER_GRANTS,
  [Role.APIKEY]: API_KEY_GRANTS,
};

export function permissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function roleHasPermission(role: Role, perm: Permission): boolean {
  return permissionsForRole(role).includes(perm);
}

/** Privilege ordering for internal login roles. Partners are not login users (rank 0). */
export const ROLE_RANK: Record<Role, number> = {
  [Role.PARTNER]: 0,
  [Role.APIKEY]: 0,
  [Role.READONLY]: 1,
  [Role.AGENT]: 2,
  [Role.MANAGER]: 3,
  [Role.ADMIN]: 4,
};

/**
 * Whether `actor` may create/modify a user with role `target`. Admins manage every internal
 * role (including other admins); everyone else may only manage roles strictly below their own.
 * Partner is never a manageable login role.
 */
export function canManageRole(actor: Role, target: Role): boolean {
  if (target === Role.PARTNER) return false;
  if (actor === Role.ADMIN) return true;
  return ROLE_RANK[target] < ROLE_RANK[actor];
}

/** Internal roles an actor is allowed to assign, for populating a role dropdown. */
export function assignableRoles(actor: Role): Role[] {
  return [Role.READONLY, Role.AGENT, Role.MANAGER, Role.ADMIN].filter((r) => canManageRole(actor, r));
}
