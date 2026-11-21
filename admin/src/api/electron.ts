import type { AdminApi } from './types.ts';

/** Thin adapter over the preload contextBridge. Never accesses ipcRenderer directly. */
export function createElectronAdminApi(bridge: AdminApi): AdminApi {
  return {
    ...bridge,
    auth: {
      ...bridge.auth,
      setup: (input) => bridge.auth.setup({ username: input.username, password: input.password }),
    },
  };
}
