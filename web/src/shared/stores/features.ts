import type { User } from '../../api/types.ts';
import { useAuthStore } from './auth.store.ts';

export function mediaEnabled(user:User|null|undefined):boolean {
  return !!user&&user.mediaEnabled!==false&&(user.features?.media??true);
}

export function useMediaEnabled():boolean {
  return useAuthStore(state=>mediaEnabled(state.verifiedUser??state.session?.user));
}
