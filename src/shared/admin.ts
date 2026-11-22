/** Fixed admin Web port. Never use this as the user Web or frp local port. */
export const ADMIN_WEB_PORT = 1250;

/** Admin Web sessions are intentionally short-lived and independent of user sessions. */
export const ADMIN_SESSION_TTL_MS = 4 * 60 * 60 * 1000;
