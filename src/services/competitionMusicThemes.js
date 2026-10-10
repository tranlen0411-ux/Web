/**
 * COMPETITION MUSIC THEMES REGISTRY
 *
 * Centralized registry for curated background music themes.
 * Scope: Host Only.
 */

export const DEFAULT_MUSIC_THEME = 'classroom_chill';
export const LOCAL_STORAGE_MUSIC_THEME_KEY = 'competition_music_theme';

export const MUSIC_THEMES = [
  {
    id: 'classroom_chill',
    name: 'Classroom Chill',
    description: 'Ấm áp, tươi vui nhẹ nhàng, phù hợp cho mọi không gian lớp học.',
    lobbyTrack: '/audio/competition/lobby_loop.mp3',
    questionTrack: '/audio/competition/question_active_loop.mp3',
    available: true,
  },
  {
    id: 'light_gameshow',
    name: 'Light Gameshow',
    description: 'Sôi động, hiện đại và hào hứng nhưng không căng thẳng quá mức.',
    lobbyTrack: '/audio/competition/themes/light_gameshow/lobby.mp3',
    questionTrack: '/audio/competition/themes/light_gameshow/question.mp3',
    available: true,
  },
  {
    id: 'calm_focus',
    name: 'Calm Focus',
    description: 'Tối giản, êm dịu, giúp học sinh tập trung tối đa cho bài làm học thuật.',
    lobbyTrack: '/audio/competition/themes/calm_focus/lobby.mp3',
    questionTrack: '/audio/competition/themes/calm_focus/question.mp3',
    available: true,
  },
  {
    id: 'bright_classroom',
    name: 'Bright Classroom',
    description: 'Tươi sáng, năng lượng tích cực, phù hợp hoạt động lớp học và thi đua nhẹ nhàng.',
    lobbyTrack: '/audio/competition/themes/bright_classroom/lobby.mp3',
    questionTrack: '/audio/competition/themes/bright_classroom/question.mp3',
    available: true,
  },
  {
    id: 'scorm_track',
    name: 'SCORM Track',
    description: 'Nhạc từ học liệu SCORM đã tải lên Kho tài liệu.',
    lobbyTrack: null,
    questionTrack: null,
    available: false,
    reason: 'WAITING_FOR_SCORM_AUDIO_AUDIT',
  },
];

export const THEME_NONE_OPTION = {
  id: 'none',
  name: 'Không phát nhạc',
  description: 'Tắt hoàn toàn nhạc nền trong suốt trận đấu (vẫn giữ hiệu ứng âm thanh SFX).',
  lobbyTrack: null,
  questionTrack: null,
  available: true,
};

export const ALL_THEME_OPTIONS = [
  THEME_NONE_OPTION,
  ...MUSIC_THEMES,
];

const REGISTERED_THEME_IDS = new Set(['none', ...MUSIC_THEMES.map((t) => t.id)]);

/**
 * Check if a theme ID is registered in the library
 */
export function isValidThemeId(themeId) {
  return typeof themeId === 'string' && REGISTERED_THEME_IDS.has(themeId);
}

/**
 * Check if a theme is valid AND currently selectable/available
 */
export function isSelectableThemeId(themeId) {
  if (themeId === 'none') return true;
  const theme = MUSIC_THEMES.find((t) => t.id === themeId);
  return Boolean(theme && theme.available !== false);
}

/**
 * Retrieve theme definition by ID (returns null for 'none', fallback to default for unknown)
 */
export function getThemeById(themeId) {
  if (themeId === 'none') {
    return null;
  }
  const found = MUSIC_THEMES.find((t) => t.id === themeId);
  return found || null;
}

/**
 * Helper to obtain storage instance safely in both browser and node test environments
 */
function getStorage() {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  if (typeof localStorage !== 'undefined') {
    return localStorage;
  }
  return null;
}

/**
 * Safely read stored theme from localStorage with default fallback
 * If stored theme is unavailable (e.g. scorm_track) or invalid, falls back safely to default.
 */
export function getStoredThemeId() {
  const storage = getStorage();
  if (!storage) {
    return DEFAULT_MUSIC_THEME;
  }
  try {
    const stored = storage.getItem(LOCAL_STORAGE_MUSIC_THEME_KEY);
    if (stored && isSelectableThemeId(stored)) {
      return stored;
    }
  } catch (_e) {
    // Fail-silent
  }
  return DEFAULT_MUSIC_THEME;
}

/**
 * Safely persist theme ID to localStorage only if selectable
 */
export function setStoredThemeId(themeId) {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    if (isSelectableThemeId(themeId)) {
      storage.setItem(LOCAL_STORAGE_MUSIC_THEME_KEY, themeId);
    }
  } catch (_e) {
    // Fail-silent
  }
}
