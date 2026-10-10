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
  },
  {
    id: 'light_gameshow',
    name: 'Light Gameshow',
    description: 'Sôi động, hiện đại và hào hứng nhưng không căng thẳng quá mức.',
    lobbyTrack: '/audio/competition/themes/light_gameshow/lobby.mp3',
    questionTrack: '/audio/competition/themes/light_gameshow/question.mp3',
  },
  {
    id: 'calm_focus',
    name: 'Calm Focus',
    description: 'Tối giản, êm dịu, giúp học sinh tập trung tối đa cho bài làm học thuật.',
    lobbyTrack: '/audio/competition/themes/calm_focus/lobby.mp3',
    questionTrack: '/audio/competition/themes/calm_focus/question.mp3',
  },
];

export const THEME_NONE_OPTION = {
  id: 'none',
  name: 'Không phát nhạc',
  description: 'Tắt hoàn toàn nhạc nền trong suốt trận đấu (vẫn giữ hiệu ứng âm thanh SFX).',
  lobbyTrack: null,
  questionTrack: null,
};

export const ALL_THEME_OPTIONS = [
  THEME_NONE_OPTION,
  ...MUSIC_THEMES,
];

const VALID_THEME_IDS = new Set(['none', ...MUSIC_THEMES.map((t) => t.id)]);

/**
 * Check if a theme ID is valid
 */
export function isValidThemeId(themeId) {
  return typeof themeId === 'string' && VALID_THEME_IDS.has(themeId);
}

/**
 * Retrieve theme definition by ID (returns null for 'none', fallback to default for unknown)
 */
export function getThemeById(themeId) {
  if (themeId === 'none') {
    return null;
  }
  const found = MUSIC_THEMES.find((t) => t.id === themeId);
  return found || MUSIC_THEMES[0];
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
 */
export function getStoredThemeId() {
  const storage = getStorage();
  if (!storage) {
    return DEFAULT_MUSIC_THEME;
  }
  try {
    const stored = storage.getItem(LOCAL_STORAGE_MUSIC_THEME_KEY);
    if (stored && isValidThemeId(stored)) {
      return stored;
    }
  } catch (_e) {
    // Fail-silent
  }
  return DEFAULT_MUSIC_THEME;
}

/**
 * Safely persist theme ID to localStorage
 */
export function setStoredThemeId(themeId) {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    if (isValidThemeId(themeId)) {
      storage.setItem(LOCAL_STORAGE_MUSIC_THEME_KEY, themeId);
    }
  } catch (_e) {
    // Fail-silent
  }
}
