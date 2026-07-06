import { create } from 'zustand';
import { type AuthenticatedPrincipal, type Permission, permissionsForRole } from '@de/shared';
import { api, tokenStore } from '../api/client';

interface AuthState {
  principal: AuthenticatedPrincipal | null;
  status: 'idle' | 'loading' | 'authed' | 'anon';
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  hydrate: () => Promise<void>;
  can: (perm: Permission) => boolean;
}

export const useAuth = create<AuthState>((set, get) => ({
  principal: null,
  status: 'idle',

  async login(email, password) {
    const { token, user } = await api.auth.login(email, password);
    tokenStore.set(token);
    set({
      status: 'authed',
      principal: {
        kind: 'user',
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        permissions: permissionsForRole(user.role),
      },
    });
  },

  logout() {
    tokenStore.clear();
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
      set({ status: 'anon', principal: null });
    }
  },

  can(perm) {
    return get().principal?.permissions.includes(perm) ?? false;
  },
}));
