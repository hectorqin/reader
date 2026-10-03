import { create } from 'zustand';
import type { Session, User } from '../../api/types.ts';

interface AuthState {
  session: Session | null;
  verifiedUser: User | null;
  setSession(session: Session | null): void;
  verify(user: User): void;
}
export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  verifiedUser: null,
  setSession: session => set({ session, verifiedUser: null }),
  verify: verifiedUser => set({ verifiedUser }),
}));
