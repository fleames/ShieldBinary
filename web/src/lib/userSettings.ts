export const USER_SETTINGS_KEY = 'shieldbinary_user_settings_v1';

export type ProtectionTier = 'minimal' | 'basic' | 'pro' | 'enterprise';
export type ProtectionPreset = 'compatibility' | 'balanced' | 'polymorphic';
export type JobPollIntervalMs = 1000 | 1500 | 2500 | 4000;

export type UserSettings = {
  defaultTier: ProtectionTier;
  defaultPreset: ProtectionPreset;
  forceReducedMotion: boolean;
  compactDensity: boolean;
  confirmBeforeLogout: boolean;
  jobPollIntervalMs: JobPollIntervalMs;
};

export const DEFAULT_USER_SETTINGS: UserSettings = {
  defaultTier: 'basic',
  defaultPreset: 'balanced',
  forceReducedMotion: false,
  compactDensity: false,
  confirmBeforeLogout: true,
  jobPollIntervalMs: 1500,
};

export function loadUserSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(USER_SETTINGS_KEY);
    if (!raw) return DEFAULT_USER_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    const poll = Number(parsed.jobPollIntervalMs);
    const validPoll: JobPollIntervalMs = poll === 1000 || poll === 1500 || poll === 2500 || poll === 4000 ? poll : DEFAULT_USER_SETTINGS.jobPollIntervalMs;
    const validTier: ProtectionTier = parsed.defaultTier === 'minimal' || parsed.defaultTier === 'basic' || parsed.defaultTier === 'pro' || parsed.defaultTier === 'enterprise'
      ? parsed.defaultTier
      : DEFAULT_USER_SETTINGS.defaultTier;
    const validPreset: ProtectionPreset = parsed.defaultPreset === 'compatibility' || parsed.defaultPreset === 'balanced' || parsed.defaultPreset === 'polymorphic'
      ? parsed.defaultPreset
      : DEFAULT_USER_SETTINGS.defaultPreset;
    return {
      defaultTier: validTier,
      defaultPreset: validPreset,
      forceReducedMotion: !!parsed.forceReducedMotion,
      compactDensity: !!parsed.compactDensity,
      confirmBeforeLogout: parsed.confirmBeforeLogout === undefined ? DEFAULT_USER_SETTINGS.confirmBeforeLogout : !!parsed.confirmBeforeLogout,
      jobPollIntervalMs: validPoll,
    };
  } catch {
    return DEFAULT_USER_SETTINGS;
  }
}

export function saveUserSettings(settings: UserSettings) {
  localStorage.setItem(USER_SETTINGS_KEY, JSON.stringify(settings));
}

export function applySettingsToBody(settings: UserSettings) {
  document.body.classList.toggle('sb-reduced-motion-force', !!settings.forceReducedMotion);
  document.body.classList.toggle('sb-density-compact', !!settings.compactDensity);
}

