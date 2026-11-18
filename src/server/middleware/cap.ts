import type { RequestHandler } from 'express';
import type { CapService } from '../cap/capService.ts';

/** Reject business requests that need Cap but did not bring a valid token. */
export function requireCapToken(cap: CapService): RequestHandler {
  return (req, res, next) => {
    if (!cap.enabled() || cap.hasValidToken(req)) {
      next();
      return;
    }
    res.status(403).json(cap.requireResponse());
  };
}
