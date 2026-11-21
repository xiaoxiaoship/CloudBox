import { createContext, useContext, type ReactNode } from 'react';
import type { AdminApi } from './types.ts';
import { api } from './ipc.ts';

const AdminApiContext = createContext<AdminApi>(api);

export function AdminApiProvider({ value, children }: { value?: AdminApi; children: ReactNode }) {
  return <AdminApiContext.Provider value={value ?? api}>{children}</AdminApiContext.Provider>;
}

export function useAdminApi(): AdminApi {
  return useContext(AdminApiContext);
}
