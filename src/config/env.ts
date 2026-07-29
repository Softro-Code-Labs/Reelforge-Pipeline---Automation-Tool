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

  workdir: path.resolve(optional('WORKDIR', './workdir')),
  jobDbPath: path.resolve(optional('JOB_DB_PATH', './data/jobs.json')),

  server: {
    // Render injects PORT; UI_PORT is the local fallback
    port: parseInt(optional('PORT', optional('UI_PORT', '3000')), 10),
  },
};
