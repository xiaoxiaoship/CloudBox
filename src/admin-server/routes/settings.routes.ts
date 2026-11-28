import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { CoreServices } from '../../core/container.ts';
import type { AdminSettings } from '../../shared/ipcTypes.ts';
import { clampLowLevelSecurity, type LowLevelSecurity } from '../../shared/lowLevelSecurity.ts';
import { resetLimitedIps } from '../../server/middleware/rateLimit.ts';
import { buildAdminSettings } from '../../core/services/admin/adminSettingsService.ts';
import { clearResourceCache } from '../../core/services/cacheCleanupService.ts';

const securitySchema = z.object({
  mode: z.enum(['simple', 'advanced']),
  enabled: z.boolean(),
  maxLoginFailures: z.number().int().min(3).max(50),
  lockBaseMinutes: z.number().int().min(1).max(1440),
  lockMaxMinutes: z.number().int().min(1).max(10080),
  ipLoginLimit: z.number().int().min(1).max(10000),
  ipWindowMinutes: z.number().int().min(1).max(1440),
  ipLockMinutes: z.number().int().min(1).max(1440),
  simpleRegisterLimit: z.number().int().min(1).max(1000),
  renameEnabled: z.boolean(),
  renameLimit: z.number().int().min(1).max(100),
  renameWindowHours: z.number().int().min(1).max(8760),
  renameLockHours: z.number().int().min(1).max(8760),
  capEnabled: z.boolean(),
  capLoginFailures: z.number().int().min(1).max(100),
  capRegistrationLimit: z.number().int().min(1).max(100),
  capShareLimit: z.number().int().min(1).max(100),
  policy: z.string().max(50_000),
  adminIdleEnabled: z.boolean().default(true),
  adminIdleMinutes: z.number().int().min(1).max(1440).default(30),
  lowLevel: z.record(z.string(), z.unknown()).default({}),
});

export function createAdminSettingsRouter(services: CoreServices, csrf: RequestHandler): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(buildAdminSettings(services));
  });

  router.post('/public-registration', csrf, (req, res) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    services.settings.set('allow_public_registration', enabled, null);
    res.json(buildAdminSettings(services));
  });

  router.post('/trust-proxy', csrf, (req, res) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    services.settings.set('network.trustProxy', enabled, null);
    res.json(buildAdminSettings(services));
  });

  router.post('/admin-web', csrf, (req, res) => {
    const { intranetOnly } = z.object({ intranetOnly: z.boolean() }).parse(req.body);
    services.settings.set('adminWeb.intranetOnly', intranetOnly, null);
    res.json(buildAdminSettings(services));
  });

  router.post('/security', csrf, (req, res) => {
    const input = securitySchema.parse(req.body);
    const previousMode = services.settings.get('security.mode');
    if (previousMode !== input.mode) services.securityPolicy.clearAll();
    services.settings.set('security.mode', input.mode, null);
    services.settings.set('security.lockEnabled', input.enabled, null);
    services.settings.set('security.maxLoginFailures', input.maxLoginFailures, null);
    services.settings.set('security.lockBaseMinutes', input.lockBaseMinutes, null);
    services.settings.set('security.lockMaxMinutes', input.lockMaxMinutes, null);
    services.settings.set('security.ipLoginLimit', input.ipLoginLimit, null);
    services.settings.set('security.ipWindowMinutes', input.ipWindowMinutes, null);
    services.settings.set('security.ipLockMinutes', input.ipLockMinutes, null);
    services.settings.set('security.simpleRegisterLimit', input.simpleRegisterLimit, null);
    services.settings.set('security.renameEnabled', input.renameEnabled, null);
    services.settings.set('security.renameLimit', input.renameLimit, null);
    services.settings.set('security.renameWindowHours', input.renameWindowHours, null);
    services.settings.set('security.renameLockHours', input.renameLockHours, null);
    services.settings.set('security.capEnabled', input.capEnabled, null);
    services.settings.set('security.capLoginFailures', input.capLoginFailures, null);
    services.settings.set('security.capRegistrationLimit', input.capRegistrationLimit, null);
    services.settings.set('security.capShareLimit', input.capShareLimit, null);
    services.settings.set('security.policy', input.policy, null);
    services.settings.set('security.adminIdleEnabled', input.adminIdleEnabled, null);
    services.settings.set('security.adminIdleMinutes', input.adminIdleMinutes, null);
    const lowLevel = clampLowLevelSecurity(input.lowLevel as Partial<LowLevelSecurity>);
    services.settings.set('security.lowLevel', JSON.stringify(lowLevel), null);
    services.settings.set('upload.maxFileBytes', lowLevel.maxFileBytes, null);
    services.settings.set('security.simpleRegisterLimit', lowLevel.registrationLimit, null);
    services.settings.set('security.sessionTtlHours', lowLevel.sessionTtlHours, null);
    services.settings.set('scan.localMaxBytes', lowLevel.clamavMaxBytes, null);
    services.settings.set('scan.localTimeoutSeconds', lowLevel.clamavTimeoutSeconds, null);
    services.settings.set('maxConcurrentExtractions', lowLevel.maxConcurrentExtractions, null);
    services.settings.set('maxConcurrentScans', lowLevel.maxConcurrentScans, null);
    services.settings.set('maxConcurrentHeavyPreviews', lowLevel.maxConcurrentHeavyPreviews, null);
    services.settings.set('maxConcurrentPreviewsPerUser', lowLevel.maxConcurrentPreviewsPerUser, null);
    services.settings.set('maxLogSizeMB', lowLevel.maxLogSizeMB, null);
    resetLimitedIps();
    res.json(buildAdminSettings(services));
  });

  router.post('/resources', csrf, (req, res) => {
    const input = z.object({
      maxConcurrentExtractions: z.number().int().min(1).max(1000),
      maxConcurrentScans: z.number().int().min(1).max(1000),
      maxConcurrentHeavyPreviews: z.number().int().min(1).max(1000),
      maxConcurrentPreviewsPerUser: z.number().int().min(1).max(1000),
      maxLogSizeMB: z.number().int().min(1).max(100000),
    }).parse(req.body);
    for (const [key, value] of Object.entries(input)) services.settings.set(key as 'maxConcurrentExtractions', value, null);
    res.json(buildAdminSettings(services));
  });

  router.post('/permissions', csrf, (req, res) => {
    const input = z.object({
      allowUserPreviewImage: z.boolean(), allowUserPreviewVideo: z.boolean(),
      allowUserPreviewPdf: z.boolean(), allowUserPreviewOffice: z.boolean(),
      allowUserExtract: z.boolean(), allowUserScan: z.boolean(),
      allowUserCompress: z.boolean(), allowUserDirectShare: z.boolean(),
      allowUserArchivePreview: z.boolean(), allowGuestMode: z.boolean(),
    }).parse(req.body);
    services.settings.set('allow_user_preview_image', input.allowUserPreviewImage, null);
    services.settings.set('allow_user_preview_video', input.allowUserPreviewVideo, null);
    services.settings.set('allow_user_preview_pdf', input.allowUserPreviewPdf, null);
    services.settings.set('allow_user_preview_office', input.allowUserPreviewOffice, null);
    services.settings.set('allow_user_extract', input.allowUserExtract, null);
    services.settings.set('allow_user_scan', input.allowUserScan, null);
    services.settings.set('allow_user_compress', input.allowUserCompress, null);
    services.settings.set('allow_user_direct_share', input.allowUserDirectShare, null);
    services.settings.set('allow_user_archive_preview', input.allowUserArchivePreview, null);
    services.settings.set('allow_guest_mode', input.allowGuestMode, null);
    res.json(buildAdminSettings(services));
  });

  router.post('/address-mode', csrf, (req, res) => {
    const input = z.object({ target: z.enum(['guest', 'share']), mode: z.enum(['auto', 'public']) }).parse(req.body);
    services.settings.set(input.target === 'guest' ? 'guest.addressMode' : 'share.addressMode', input.mode, null);
    res.json(buildAdminSettings(services));
  });

  router.post('/default-quota', csrf, (req, res) => {
    const input = z.object({ bytes: z.number().int().min(0).max(1024 ** 5) }).parse(req.body);
    services.settings.set('user.defaultQuotaBytes', input.bytes, null);
    res.json(buildAdminSettings(services));
  });

  router.post('/scan', csrf, (req, res) => {
    const input = z.object({ enabled: z.boolean(), mode: z.enum(['api', 'local']), apiKey: z.string().max(256).optional(), localPath: z.string().max(500).optional() }).parse(req.body);
    services.settings.set('scan.enabled', input.enabled, null);
    services.settings.set('scan.mode', input.mode, null);
    if (input.apiKey !== undefined) services.settings.set('scan.api_key', input.apiKey, null);
    if (input.localPath !== undefined) services.settings.set('scan.local_path', input.localPath, null);
    res.json(buildAdminSettings(services));
  });

  router.post('/ai', csrf, (req, res) => {
    const input = z.object({
      enabled: z.boolean(), mode: z.enum(['admin', 'user']), baseUrl: z.string().max(500),
      apiKey: z.string().max(2000).optional(), model: z.string().max(200), dailyLimit: z.number().int().min(1).max(10_000),
    }).parse(req.body);
    services.ai.saveAdmin(input);
    res.json(buildAdminSettings(services));
  });

  router.post('/mail', csrf, (req, res) => {
    const input = z.object({
      enabled: z.boolean(), host: z.string().max(255), port: z.number().int().min(1).max(65_535), secure: z.boolean(),
      user: z.string().max(255), pass: z.string().max(2000).optional(), from: z.string().max(255), to: z.string().max(500),
      eventUserRegistered: z.boolean(), eventSecurityAlert: z.boolean(), eventSecurityLimit: z.boolean(), eventResourceAlert: z.boolean(), eventSystemError: z.boolean(),
    }).parse(req.body);
    services.mail.save(input);
    res.json(buildAdminSettings(services));
  });

  router.post('/hosting', csrf, (req, res) => {
    const input = z.object({
      enabled: z.boolean(),
      baseUrl: z.string().max(500),
      mode: z.enum(['auto', 'public']).default('auto'),
    }).parse(req.body);
    services.settings.set('hosting.enabled', input.enabled, null);
    services.settings.set('hosting.mode', input.mode, null);
    services.settings.set('hosting.base_url', input.baseUrl, null);
    res.json(buildAdminSettings(services));
  });

  router.post('/mail/test', csrf, async (_req, res) => {
    res.json(await services.mail.sendTest());
  });

  router.post('/reset-defaults', csrf, (_req, res) => {
    services.settings.resetUserConfig(null);
    services.securityPolicy.clearAll();
    resetLimitedIps();
    res.json(buildAdminSettings(services));
  });

  router.post('/cache-cleanup', csrf, (req, res) => {
    const input = z.object({
      autoEnabled: z.boolean(),
      intervalHours: z.number().int().min(1).max(720),
    }).parse(req.body);
    services.settings.set('cacheCleanup.autoEnabled', input.autoEnabled, null);
    services.settings.set('cacheCleanup.intervalHours', input.intervalHours, null);
    res.json(buildAdminSettings(services));
  });

  router.post('/clear-cache', csrf, async (_req, res) => {
    res.json(await clearResourceCache(services));
  });

  return router;
}
