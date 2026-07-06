import { type CreateUserInput, type Role, type UpdateUserInput, type User, canManageRole } from '@de/shared';
import { prisma } from '../db.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signAccessToken } from '../auth/jwt.js';
import { conflict, forbidden, notFound, unauthorized } from '../util/errors.js';

function toUser(row: { id: number; email: string; name: string; role: string; active: boolean; createdAt: Date; lastLoginAt: Date | null }): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as User['role'],
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: row.lastLoginAt?.toISOString(),
  };
}

export const userService = {
  async login(email: string, password: string): Promise<{ token: string; user: User }> {
    const row = await prisma.user.findUnique({ where: { email } });
    if (!row || !row.active) throw unauthorized('Invalid credentials');
    const ok = await verifyPassword(password, row.passwordHash);
    if (!ok) throw unauthorized('Invalid credentials');
    await prisma.user.update({ where: { id: row.id }, data: { lastLoginAt: new Date() } });
    const user = toUser(row);
    const token = signAccessToken({ sub: row.id, email: row.email, name: row.name, role: user.role });
    return { token, user };
  },

  async list(): Promise<User[]> {
    const rows = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(toUser);
  },

  async create(input: CreateUserInput, actorRole: Role): Promise<User> {
    if (!canManageRole(actorRole, input.role)) throw forbidden(`You cannot create a ${input.role} user`);
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw conflict('A user with that email already exists');
    const passwordHash = await hashPassword(input.password);
    const row = await prisma.user.create({
      data: { email: input.email, name: input.name, role: input.role, passwordHash },
    });
    return toUser(row);
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
