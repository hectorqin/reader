import { createContext, useContext } from 'react';
import type { AppRuntime } from '../runtime.ts';

export const RuntimeContext = createContext<AppRuntime | null>(null);
export function useRuntime(): AppRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('App runtime is unavailable');
  return runtime;
}
