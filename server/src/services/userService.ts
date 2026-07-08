import { type CreateUserInput, Role, type UpdateUserInput, type User, canManageRole } from '@de/shared';
import { prisma } from '../db.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signAccessToken } from '../auth/jwt.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../util/errors.js';

type UserRow = { id: number; email: string; name: string; role: string; active: boolean; merchantId: number | null; createdAt: Date; lastLoginAt: Date | null; merchant?: { dbaName: string } | null };

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as User['role'],
    active: row.active,
    merchantId: row.merchantId ?? undefined,
    merchantName: row.merchant?.dbaName,
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: row.lastLoginAt?.toISOString(),
  };
}

export const userService = {
  async login(email: string, password: string): Promise<{ token: string; user: User }> {
    const row = await prisma.user.findUnique({ where: { email }, include: { merchant: { select: { dbaName: true } } } });
    if (!row || !row.active) throw unauthorized('Invalid credentials');
    const ok = await verifyPassword(password, row.passwordHash);
    if (!ok) throw unauthorized('Invalid credentials');
    await prisma.user.update({ where: { id: row.id }, data: { lastLoginAt: new Date() } });
    const user = toUser(row);
    const token = signAccessToken({ sub: row.id, email: row.email, name: row.name, role: user.role, merchantId: row.merchantId ?? undefined });
    return { token, user };
  },

  async list(): Promise<User[]> {
    const rows = await prisma.user.findMany({ orderBy: { createdAt: 'asc' }, include: { merchant: { select: { dbaName: true } } } });
    return rows.map(toUser);
  },

  /** Portal logins for a single merchant (shown on the merchant card). */
  async listForMerchant(merchantId: number): Promise<User[]> {
    const rows = await prisma.user.findMany({ where: { merchantId, role: Role.MERCHANT }, orderBy: { createdAt: 'asc' }, include: { merchant: { select: { dbaName: true } } } });
    return rows.map(toUser);
  },

  async create(input: CreateUserInput, actorRole: Role): Promise<User> {
    // Merchant logins are provisioned through the merchant portal-access flow (they need a
    // merchantId), never the generic internal user create.
    if (input.role === Role.MERCHANT) throw badRequest('Create merchant logins from the merchant’s Portal Access section');
    if (!canManageRole(actorRole, input.role)) throw forbidden(`You cannot create a ${input.role} user`);
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw conflict('A user with that email already exists');
    const passwordHash = await hashPassword(input.password);
    const row = await prisma.user.create({
      data: { email: input.email, name: input.name, role: input.role, passwordHash },
      include: { merchant: { select: { dbaName: true } } },
    });
    return toUser(row);
  },

  /** Create a MERCHANT self-service login scoped to a merchant. Manager/admin only. */
  async createMerchantUser(merchantId: number, input: { email: string; name: string; password: string }, actorRole: Role): Promise<User> {
    if (!canManageRole(actorRole, Role.MERCHANT)) throw forbidden('You cannot create merchant logins');
    const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
    if (!merchant) throw notFound('Merchant not found');
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw conflict('A user with that email already exists');
    const passwordHash = await hashPassword(input.password);
    const row = await prisma.user.create({
      data: { email: input.email, name: input.name, role: Role.MERCHANT, passwordHash, merchantId },
      include: { merchant: { select: { dbaName: true } } },
    });
    return toUser(row);
  },

  /**
   * Mint a merchant-scoped token so an internal actor can view the portal as a merchant.
   * The token carries the impersonating actor (imp) for the audit trail; sub stays the actor's
   * user id so the session is always traceable back to a real internal user.
   */
  async impersonateMerchant(merchantId: number, actor: { id: number; email: string }): Promise<{ token: string; merchant: { id: number; dbaName: string } }> {
    const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
    if (!merchant) throw notFound('Merchant not found');
    const token = signAccessToken({
      sub: actor.id,
      email: actor.email,
      name: `${merchant.dbaName} (impersonated)`,
      role: Role.MERCHANT,
      merchantId,
      imp: actor.email,
    });
    return { token, merchant: { id: merchant.id, dbaName: merchant.dbaName } };
  },

  async update(id: number, input: UpdateUserInput, actorRole: Role): Promise<User> {
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw notFound('User not found');
    // Can only touch a user at a role you outrank, and can't promote past your own level.
    if (!canManageRole(actorRole, existing.role as Role)) throw forbidden('You cannot modify this user');
    if (input.role !== undefined && !canManageRole(actorRole, input.role)) throw forbidden(`You cannot assign the ${input.role} role`);
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.role !== undefined) data.role = input.role;
    if (input.active !== undefined) data.active = input.active;
    if (input.password) data.passwordHash = await hashPassword(input.password);
    const row = await prisma.user.update({ where: { id }, data });
    return toUser(row);
  },
};
