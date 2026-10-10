# Competition V1 Background Music Themes & Assets

## Origin & Provenance
- All playable audio tracks in this directory and its subdirectories are 100% ORIGINAL PROJECT-GENERATED procedural audio assets.
- Created specifically for the Competition Host V1 experience in this repository.
- Synthesized algorithmically using pure mathematical oscillators (sine, harmonic overtone blending, ADSR envelopes) and encoded via LAME MP3 encoder.
- ZERO third-party copyrighted recordings, samples, loops, or external sound libraries were used.
- Royalty-free, clean-license, and completely self-contained within this project.

## Curated Theme Registry
| Theme ID | Display Name | Track Type | File Path | Duration | Bitrate | Sample Rate | Character |
|---|---|---|---|---|---|---|---|
| `classroom_chill` | Classroom Chill | Lobby | `/audio/competition/lobby_loop.mp3` | ~36.96s | 128 kbps | 44,100 Hz | Cheerful, warm, classroom-friendly Rhodes keys & kalimba accents. |
| `classroom_chill` | Classroom Chill | Question | `/audio/competition/question_active_loop.mp3` | ~33.15s | 128 kbps | 44,100 Hz | Balanced modern gameshow pulse, soft marimba ostinato; leaves space for countdown SFX. |
| `light_gameshow` | Light Gameshow | Lobby | `/audio/competition/themes/light_gameshow/lobby.mp3` | ~30.59s | 128 kbps | 44,100 Hz | Brighter, energetic, playful, cheerful bell plucks and bouncy bass. |
| `light_gameshow` | Light Gameshow | Question | `/audio/competition/themes/light_gameshow/question.mp3` | ~32.03s | 128 kbps | 44,100 Hz | Driving gameshow rhythm, syncopated marimba groove, motivating energy. |
| `calm_focus` | Calm Focus | Lobby | `/audio/competition/themes/calm_focus/lobby.mp3` | ~36.57s | 128 kbps | 44,100 Hz | Soothing, minimal, warm ambient chords, slow peaceful tempo. |
| `calm_focus` | Calm Focus | Question | `/audio/competition/themes/calm_focus/question.mp3` | ~35.03s | 128 kbps | 44,100 Hz | Gentle acoustic pulse, low-distraction marimba pattern for academic concentration. |
| `bright_classroom` | Bright Classroom | Lobby | `/audio/competition/themes/bright_classroom/lobby.mp3` | ~34.91s | 128 kbps | 44,100 Hz | Sunny, uplifting, cheerful acoustic pluck arpeggio, glockenspiel sparkle, bouncy walking bass. |
| `bright_classroom` | Bright Classroom | Question | `/audio/competition/themes/bright_classroom/question.mp3` | ~33.10s | 128 kbps | 44,100 Hz | Upbeat motivating progression, offbeat acoustic accents; leaves frequency space for countdown SFX. |
| `scorm_inspired_calm` | SCORM-Inspired Calm | Lobby | `/audio/competition/themes/scorm_inspired_calm/lobby.mp3` | ~31.30s | 128 kbps | 44,100 Hz | Warm, gentle piano and marimba arpeggios, atmospheric pad; relaxed classroom feel. |
| `scorm_inspired_calm` | SCORM-Inspired Calm | Question | `/audio/competition/themes/scorm_inspired_calm/question.mp3` | ~30.00s | 128 kbps | 44,100 Hz | Gentle pizzicato pulse, soft bass line, calm and low distraction. |
| `scorm_inspired_bright` | SCORM-Inspired Bright | Lobby | `/audio/competition/themes/scorm_inspired_bright/lobby.mp3` | ~33.68s | 128 kbps | 44,100 Hz | Sunny glockenspiel, ukulele-style pluck, cheerful hand claps on beats 2 & 4; joyful classroom energy. |
| `scorm_inspired_bright` | SCORM-Inspired Bright | Question | `/audio/competition/themes/scorm_inspired_bright/question.mp3` | ~33.10s | 128 kbps | 44,100 Hz | Playful staccato marimba, bouncing walking bass, light claps; friendly trivia energy without stress. |
| `scorm_inspired_focus` | SCORM-Inspired Focus | Lobby | `/audio/competition/themes/scorm_inspired_focus/lobby.mp3` | ~36.23s | 128 kbps | 44,100 Hz | Clean electric piano, modern xylophone motifs, minimal shaker; focused and modern atmosphere. |
| `scorm_inspired_focus` | SCORM-Inspired Focus | Question | `/audio/competition/themes/scorm_inspired_focus/question.mp3` | ~35.56s | 128 kbps | 44,100 Hz | Steady electric piano quarter pulse, subtle xylophone accents; concentration-friendly for trivia. |

## SCORM-Inspired Music Pack Provenance
- All 3 SCORM-Inspired themes are 100% ORIGINAL_PROJECT_GENERATED procedural audio compositions.
- ZERO source SCORM audio reused; zero video audio extracted; zero third-party samples.
- ZERO melody, hook, motif, vocal, or lyric copied from any SCORM package.
- Broad stylistic inspiration only (instrumentation family: glockenspiel, ukulele, marimba, acoustic piano, claps; tempo 88-116 BPM).

## SCORM Track Audit Gate
- **Entry ID**: `scorm_track`
- **Display Name**: SCORM Track
- **Status**: `NOT_YET_APPROVED / NOT_YET_IMPORTED`
- **Availability**: `false`
- **Reason**: `WAITING_FOR_SCORM_AUDIO_AUDIT`
- **Safety Policy**: No asset paths, no remote URLs, zero network requests, and zero audio playback. SCORM package reuse requires a formal independent provenance and copyright audit before any asset import into the competition audio subsystem.

## Special Modes
- `none` (Không phát nhạc): Suppresses background music completely while keeping Web Audio SFX 100% operational.

## Engineering & Quality Standards
- **No Vocals**: 100% instrumental across all themes.
- **Loop Seam Matching**: Rendered with tail wrap-around and micro-crossfade to guarantee zero clicks or pops at loop points.
- **Loudness & Headroom**: Peak normalized with -1.5 dB headroom.
- **SFX Protection**: Question tracks carefully EQ'd to leave 880 Hz - 1760 Hz band clear for Host countdown and time-up SFX.
