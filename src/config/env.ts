import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

/**
 * Parses a comma-separated "HH:mm" list (e.g. "09:00,18:00") into unique,
 * validated time strings. Silently drops malformed entries with a console
 * warning rather than crashing startup over a typo in the schedule.
 */
function parseScheduleTimes(raw: string): string[] {
  const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const times = raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const valid: string[] = [];
  for (const t of times) {
    if (timePattern.test(t)) {
      valid.push(t);
    } else {
      console.warn(`[env] Ignoring invalid SCHEDULE_TIMES entry "${t}" (expected HH:mm)`);
    }
  }
  return [...new Set(valid)];
}

export const env = {
  gemini: {
    apiKey: required('GEMINI_API_KEY'),
    model: optional('GEMINI_MODEL', 'gemini-flash-latest'),
  },

  pexels: {
    apiKey: required('PEXELS_API_KEY'),
  },

  piper: {
    binaryPath: optional('PIPER_BINARY_PATH', 'piper'),
    voiceModelPath: required('PIPER_VOICE_MODEL_PATH'),
  },

  video: {
    ffmpegPath: optional('FFMPEG_PATH', 'ffmpeg'),
    width: parseInt(optional('VIDEO_WIDTH', '1080'), 10),
    height: parseInt(optional('VIDEO_HEIGHT', '1920'), 10),
    targetDurationSeconds: parseInt(
      optional('TARGET_DURATION_SECONDS', '30'),
      10,
    ),
  },

  // Background music, mixed under the voiceover with automatic ducking.
  // Sourced from Freesound (CC0-licensed tracks, no attribution required).
  // Optional: if no key is set, the pipeline logs a warning and skips music
  // rather than failing the run.
  music: {
    enabled: optional('MUSIC_ENABLED', 'true') === 'true',
    freesoundApiKey: process.env.FREESOUND_API_KEY,
    // Linear gain applied to the music track before ducking (0-1). Kept low
    // by default so it sits under the voiceover even before compression.
    volume: parseFloat(optional('MUSIC_VOLUME', '0.18')),
  },

  // Automated scheduled generation. Times are wall-clock Sri Lanka local
  // time (Asia/Colombo, UTC+5:30) regardless of the host machine's own
  // timezone -- this is fixed, not configurable, per product requirements.
  schedule: {
    timezone: 'Asia/Colombo',
    times: parseScheduleTimes(optional('SCHEDULE_TIMES', '')),
  },

  // Auto-cleanup / FIFO retention policy for generated videos.
  storage: {
    maxStoredVideos: parseInt(optional('MAX_STORED_VIDEOS', '100'), 10),
  },

  workdir: path.resolve(optional('WORKDIR', './workdir')),
  jobDbPath: path.resolve(optional('JOB_DB_PATH', './data/jobs.json')),

  server: {
    // Render injects PORT; UI_PORT is the local fallback
    port: parseInt(optional('PORT', optional('UI_PORT', '3000')), 10),
  },
};
