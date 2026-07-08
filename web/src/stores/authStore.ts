import { create } from 'zustand';
import { type AuthenticatedPrincipal, type Permission, Role, permissionsForRole } from '@de/shared';
import { api, tokenStore } from '../api/client';

const IMP_BACKUP_KEY = 'de_token_backup';

interface AuthState {
  principal: AuthenticatedPrincipal | null;
  status: 'idle' | 'loading' | 'authed' | 'anon';
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  hydrate: () => Promise<void>;
  can: (perm: Permission) => boolean;
  isMerchant: () => boolean;
  isImpersonating: () => boolean;
  /** Enter a merchant's portal as an internal actor (admin/manager). */
  impersonate: (merchantId: number) => Promise<void>;
  /** Return to the internal app from an impersonation session. */
  exitImpersonation: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  principal: null,
  status: 'idle',

  async login(email, password) {
    const { token, user } = await api.auth.login(email, password);
    tokenStore.set(token);
    localStorage.removeItem(IMP_BACKUP_KEY);
    set({
      status: 'authed',
      principal: {
        kind: 'user',
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        permissions: permissionsForRole(user.role),
        merchantId: user.merchantId,
      },
    });
  },

  logout() {
    tokenStore.clear();
    localStorage.removeItem(IMP_BACKUP_KEY);
    set({ principal: null, status: 'anon' });
  },

  async hydrate() {
    const token = tokenStore.get();
    if (!token) {
      set({ status: 'anon' });
      return;
    }
    set({ status: 'loading' });
    try {
      const { principal } = await api.auth.me();
      set({ status: 'authed', principal });
    } catch {
      tokenStore.clear();
      localStorage.removeItem(IMP_BACKUP_KEY);
      set({ status: 'anon', principal: null });
    }
  },

  can(perm) {
    return get().principal?.permissions.includes(perm) ?? false;
  },

  isMerchant() {
    return get().principal?.role === Role.MERCHANT;
  },

  isImpersonating() {
    return Boolean(get().principal?.impersonatedBy);
  },

  async impersonate(merchantId) {
    const { token } = await api.merchants.impersonate(merchantId);
    const current = tokenStore.get();
    if (current) localStorage.setItem(IMP_BACKUP_KEY, current);
    tokenStore.set(token);
    await get().hydrate();
  },

  async exitImpersonation() {
    const backup = localStorage.getItem(IMP_BACKUP_KEY);
    if (backup) {
      tokenStore.set(backup);
      localStorage.removeItem(IMP_BACKUP_KEY);
    }
    await get().hydrate();
  },
}));
