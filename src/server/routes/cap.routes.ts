import { Router } from 'express';
import type { CapService } from '../cap/capService.ts';

export function createCapRouter(cap: CapService): Router {
  const router = Router();

  router.post('/challenge', async (_req, res) => {
    if (!cap.enabled()) {
      res.status(404).json({ error: 'cap_disabled' });
      return;
    }
    try {
      res.json(await cap.challenge());
    } catch {
      res.status(500).json({ error: 'challenge_failed' });
    }
  });

  router.post('/redeem', async (req, res) => {
    if (!cap.enabled()) {
      res.status(404).json({ success: false, error: 'cap_disabled' });
      return;
    }
    try {
      const result = await cap.redeem(req.body);
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'invalid_solution',
      });
    }
  });

  return router;
}
