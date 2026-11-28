import type { AdminSettings } from '../../../shared/ipcTypes.ts';
import type { CoreServices } from '../../container.ts';

/** Shared admin settings view, used by Electron IPC and the headless HTTP adapter. */
export function buildAdminSettings(services: CoreServices): AdminSettings {
  const ai = services.ai.adminSettings() as {
    enabled: boolean;
    mode: 'admin' | 'user';
    baseUrl: string;
    model: string;
    hasApiKey: boolean;
    apiKeyMasked: string;
    dailyLimit: number;
  };

  const lowLevel = services.settings.getLowLevel();
  lowLevel.maxConcurrentExtractions = services.settings.get('maxConcurrentExtractions');
  lowLevel.maxConcurrentScans = services.settings.get('maxConcurrentScans');
  lowLevel.maxConcurrentHeavyPreviews = services.settings.get('maxConcurrentHeavyPreviews');
  lowLevel.maxConcurrentPreviewsPerUser = services.settings.get('maxConcurrentPreviewsPerUser');
  lowLevel.maxLogSizeMB = services.settings.get('maxLogSizeMB');

  return {
    allowPublicRegistration: services.settings.get('allow_public_registration'),
    trustProxy: services.settings.get('network.trustProxy'),
    adminWeb: { intranetOnly: services.settings.get('adminWeb.intranetOnly') },
    security: {
      mode: services.settings.get('security.mode'),
      enabled: services.settings.get('security.lockEnabled'),
      maxLoginFailures: services.settings.get('security.maxLoginFailures'),
      lockBaseMinutes: services.settings.get('security.lockBaseMinutes'),
      lockMaxMinutes: services.settings.get('security.lockMaxMinutes'),
      ipLoginLimit: services.settings.get('security.ipLoginLimit'),
      ipWindowMinutes: services.settings.get('security.ipWindowMinutes'),
      ipLockMinutes: services.settings.get('security.ipLockMinutes'),
      simpleRegisterLimit: services.settings.get('security.simpleRegisterLimit'),
      renameEnabled: services.settings.get('security.renameEnabled'),
      renameLimit: services.settings.get('security.renameLimit'),
      renameWindowHours: services.settings.get('security.renameWindowHours'),
      renameLockHours: services.settings.get('security.renameLockHours'),
      capEnabled: services.settings.get('security.capEnabled'),
      capLoginFailures: services.settings.get('security.capLoginFailures'),
      capRegistrationLimit: services.settings.get('security.capRegistrationLimit'),
      capShareLimit: services.settings.get('security.capShareLimit'),
      policy: services.settings.get('security.policy'),
      adminIdleEnabled: services.settings.get('security.adminIdleEnabled'),
      adminIdleMinutes: services.settings.get('security.adminIdleMinutes'),
      lowLevel,
    },
    cacheCleanup: {
      autoEnabled: services.settings.get('cacheCleanup.autoEnabled'),
      intervalHours: services.settings.get('cacheCleanup.intervalHours'),
    },
    resources: {
      maxConcurrentExtractions: services.settings.get('maxConcurrentExtractions'),
      maxConcurrentScans: services.settings.get('maxConcurrentScans'),
      maxConcurrentHeavyPreviews: services.settings.get('maxConcurrentHeavyPreviews'),
      maxConcurrentPreviewsPerUser: services.settings.get('maxConcurrentPreviewsPerUser'),
      maxLogSizeMB: services.settings.get('maxLogSizeMB'),
    },
    defaultQuotaBytes: services.settings.get('user.defaultQuotaBytes'),
    permissions: {
      allowUserPreviewImage: services.settings.get('allow_user_preview_image'),
      allowUserPreviewVideo: services.settings.get('allow_user_preview_video'),
      allowUserPreviewPdf: services.settings.get('allow_user_preview_pdf'),
      allowUserPreviewOffice: services.settings.get('allow_user_preview_office'),
      allowUserExtract: services.settings.get('allow_user_extract'),
      allowUserScan: services.settings.get('allow_user_scan'),
      allowUserCompress: services.settings.get('allow_user_compress'),
      allowUserDirectShare: services.settings.get('allow_user_direct_share'),
      allowUserArchivePreview: services.settings.get('allow_user_archive_preview'),
      allowGuestMode: services.settings.get('allow_guest_mode'),
    },
    scan: {
      enabled: services.settings.get('scan.enabled'),
      mode: services.settings.get('scan.mode'),
      apiKey: services.settings.get('scan.api_key'),
      localPath: services.settings.get('scan.local_path'),
    },
    ai: {
      enabled: ai.enabled,
      mode: ai.mode,
      baseUrl: ai.baseUrl,
      model: ai.model,
      hasApiKey: ai.hasApiKey,
      apiKeyMasked: ai.apiKeyMasked,
      dailyLimit: ai.dailyLimit,
    },
    guestAddressMode: services.settings.get('guest.addressMode'),
    shareAddressMode: services.settings.get('share.addressMode'),
    hosting: {
      enabled: services.settings.get('hosting.enabled'),
      baseUrl: services.settings.get('hosting.base_url'),
      mode: services.settings.get('hosting.mode'),
    },
    mail: services.mail.adminSettings() as AdminSettings['mail'],
  };
}
