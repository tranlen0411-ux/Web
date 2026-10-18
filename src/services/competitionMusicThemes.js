/**
 * COMPETITION MUSIC THEMES REGISTRY
 *
 * Centralized registry for curated background music themes and individual heroic tracks.
 * Scope: Host Only.
 */

export const DEFAULT_MUSIC_THEME = 'classroom_chill';
export const LOCAL_STORAGE_MUSIC_THEME_KEY = 'competition_music_theme';

export const SELECTION_MODE_THEME = 'theme';
export const SELECTION_MODE_CUSTOM = 'custom';
export const LOCAL_STORAGE_MUSIC_SELECTION_MODE_KEY = 'competition_music_selection_mode';
export const LOCAL_STORAGE_CUSTOM_LOBBY_TRACK_KEY = 'competition_music_custom_lobby';
export const LOCAL_STORAGE_CUSTOM_QUESTION_TRACK_KEY = 'competition_music_custom_question';

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
    id: 'heroic_orchestral',
    name: 'Heroic Orchestral',
    description: 'Tráng lệ, hào hùng và kịch tính với dàn nhạc giao hưởng, thúc đẩy ý chí quyết tâm thi đấu.',
    lobbyTrack: '/audio/competition/heroic/at_launch.mp3',
    questionTrack: '/audio/competition/heroic/titan.mp3',
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
    id: 'scorm_inspired_calm',
    name: 'SCORM-Inspired Calm',
    description: 'Ấm áp, êm dịu, mang năng lượng lớp học thư thái và thân thiện.',
    lobbyTrack: '/audio/competition/themes/scorm_inspired_calm/lobby.mp3',
    questionTrack: '/audio/competition/themes/scorm_inspired_calm/question.mp3',
    available: true,
  },
  {
    id: 'scorm_inspired_bright',
    name: 'SCORM-Inspired Bright',
    description: 'Rực rỡ, vui tươi và rộn rã, tràn đầy hứng khởi cho trò chơi lớp học.',
    lobbyTrack: '/audio/competition/themes/scorm_inspired_bright/lobby.mp3',
    questionTrack: '/audio/competition/themes/scorm_inspired_bright/question.mp3',
    available: true,
  },
  {
    id: 'scorm_inspired_focus',
    name: 'SCORM-Inspired Focus',
    description: 'Hiện đại, tập trung và nhịp nhàng, tối ưu cho suy nghĩ và giải đố.',
    lobbyTrack: '/audio/competition/themes/scorm_inspired_focus/lobby.mp3',
    questionTrack: '/audio/competition/themes/scorm_inspired_focus/question.mp3',
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
 * 5 BẢN GIAO HƯỞNG HÀO HÙNG GỐC CÓ NGUỒN CẤP PHÉP HỢP LỆ (CC-BY 4.0)
 */
export const HEROIC_TRACKS = [
  {
    id: 'sb_titan',
    title: 'Titan',
    artist: 'Scott Buckley',
    album: 'Creative Commons Music Library',
    genre: 'Cinematic Orchestral',
    duration: '~3:39',
    src: '/audio/competition/heroic/titan.mp3',
    sourceUrl: 'https://www.scottbuckley.com.au/library/titan/',
    license: 'Creative Commons Attribution 4.0 International (CC-BY 4.0)',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: "'Titan' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au",
    description: 'Dàn nhạc giao hưởng hùng tráng, mở đầu bằng tiếng cello trầm ấm rồi vút lên cao trào đầy nhiệt huyết khám phá.',
    suggestedFor: 'both',
  },
  {
    id: 'km_at_launch',
    title: 'At Launch',
    artist: 'Kevin MacLeod',
    album: 'Incompetech Royalty-Free Music',
    genre: 'Epic Orchestral',
    duration: '~3:08',
    isrc: 'USUAN1100539',
    src: '/audio/competition/heroic/at_launch.mp3',
    sourceUrl: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100539',
    license: 'Creative Commons: By Attribution 4.0 License (CC-BY 4.0)',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: '"At Launch" Kevin MacLeod (incompetech.com)\nLicensed under Creative Commons: By Attribution 4.0 License\nhttp://creativecommons.org/licenses/by/4.0/',
    description: 'Bộ đồng uy lực kết hợp dàn trống trận dồn dập, tạo không khí chuẩn bị phóng tên lửa và xuất kích bùng nổ.',
    suggestedFor: 'lobby',
  },
  {
    id: 'sb_ignis',
    title: 'Ignis',
    artist: 'Scott Buckley',
    album: 'Creative Commons Music Library',
    genre: 'Adventurous Orchestral',
    duration: '~3:59',
    src: '/audio/competition/heroic/ignis.mp3',
    sourceUrl: 'https://www.scottbuckley.com.au/library/ignis/',
    license: 'Creative Commons Attribution 4.0 International (CC-BY 4.0)',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: "'Ignis' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au",
    description: 'Giao hưởng phiêu lưu tràn đầy năng lượng, phối hợp synthesizer hiện đại và bè đồng âm thúc đẩy nhịp độ trả lời.',
    suggestedFor: 'question',
  },
  {
    id: 'sb_the_fury',
    title: 'Monomyth – The Fury',
    artist: 'Scott Buckley',
    album: 'Monomyth (Album)',
    genre: 'Epic Action Orchestral',
    duration: '~8:52',
    src: '/audio/competition/heroic/the_fury.mp3',
    sourceUrl: 'https://www.scottbuckley.com.au/library/the-fury/',
    license: 'Creative Commons Attribution 4.0 International (CC-BY 4.0)',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: "'The Fury' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au",
    description: 'Đỉnh cao thử thách trong hành trình anh hùng (The Hero’s Journey), bộ gõ dồn dập và vĩ cầm căng thẳng kịch tính.',
    suggestedFor: 'question',
  },
  {
    id: 'sb_terminus',
    title: 'Terminus',
    artist: 'Scott Buckley',
    album: 'Creative Commons Music Library',
    genre: 'Heroic Action-Adventure',
    duration: '~5:29',
    src: '/audio/competition/heroic/terminus.mp3',
    sourceUrl: 'https://www.scottbuckley.com.au/library/terminus/',
    license: 'Creative Commons Attribution 4.0 International (CC-BY 4.0)',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: "'Terminus' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au",
    description: 'Bản hùng ca về điểm đến cuối cùng, kết hợp dàn hợp xướng, trống trận và dàn dây dũng mãnh.',
    suggestedFor: 'both',
  },
];

const HEROIC_TRACK_MAP = new Map(HEROIC_TRACKS.map((t) => [t.id, t]));

export function getHeroicTrackById(trackId) {
  return HEROIC_TRACK_MAP.get(trackId) || null;
}

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

/**
 * Get stored music selection mode ('theme' | 'custom')
 */
export function getStoredMusicSelectionMode() {
  const storage = getStorage();
  if (!storage) return SELECTION_MODE_THEME;
  try {
    const stored = storage.getItem(LOCAL_STORAGE_MUSIC_SELECTION_MODE_KEY);
    if (stored === SELECTION_MODE_CUSTOM || stored === SELECTION_MODE_THEME) {
      return stored;
    }
  } catch (_e) {}
  return SELECTION_MODE_THEME;
}

export function setStoredMusicSelectionMode(mode) {
  const storage = getStorage();
  if (!storage) return;
  try {
    if (mode === SELECTION_MODE_CUSTOM || mode === SELECTION_MODE_THEME) {
      storage.setItem(LOCAL_STORAGE_MUSIC_SELECTION_MODE_KEY, mode);
    }
  } catch (_e) {}
}

/**
 * Get & Set stored custom track choices
 */
export function getStoredCustomLobbyTrack() {
  const storage = getStorage();
  if (!storage) return 'km_at_launch';
  try {
    const stored = storage.getItem(LOCAL_STORAGE_CUSTOM_LOBBY_TRACK_KEY);
    if (stored && HEROIC_TRACK_MAP.has(stored)) {
      return stored;
    }
  } catch (_e) {}
  return 'km_at_launch';
}

export function setStoredCustomLobbyTrack(trackId) {
  const storage = getStorage();
  if (!storage) return;
  try {
    if (HEROIC_TRACK_MAP.has(trackId)) {
      storage.setItem(LOCAL_STORAGE_CUSTOM_LOBBY_TRACK_KEY, trackId);
    }
  } catch (_e) {}
}

export function getStoredCustomQuestionTrack() {
  const storage = getStorage();
  if (!storage) return 'sb_titan';
  try {
    const stored = storage.getItem(LOCAL_STORAGE_CUSTOM_QUESTION_TRACK_KEY);
    if (stored && HEROIC_TRACK_MAP.has(stored)) {
      return stored;
    }
  } catch (_e) {}
  return 'sb_titan';
}

export function setStoredCustomQuestionTrack(trackId) {
  const storage = getStorage();
  if (!storage) return;
  try {
    if (HEROIC_TRACK_MAP.has(trackId)) {
      storage.setItem(LOCAL_STORAGE_CUSTOM_QUESTION_TRACK_KEY, trackId);
    }
  } catch (_e) {}
}
