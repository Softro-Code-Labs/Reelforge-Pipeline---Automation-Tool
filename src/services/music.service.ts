import fetch from "node-fetch";
import * as fs from "fs";
import * as path from "path";
import { pipeline } from "stream/promises";
import { env } from "../config/env";
import { withRetry } from "../utils/retry";

/** A single Freesound search result, trimmed to the fields we actually use. */
interface FreesoundSound {
  id: number;
  name: string;
  duration: number;
  license: string;
  previews: {
    "preview-hq-mp3"?: string;
    "preview-lq-mp3"?: string;
  };
}

interface FreesoundSearchResponse {
  results: FreesoundSound[];
}

/**
 * Searches Freesound for an instrumental track matching `mood`, restricted
 * to CC0-licensed sounds (public domain -- safe to use commercially with no
 * attribution requirement) roughly as long as the target video, so it plays
 * through without needing more than a seam-free loop.
 */
async function searchTracks(mood: string, targetDurationSeconds: number): Promise<FreesoundSound[]> {
  const minDuration = Math.max(10, Math.floor(targetDurationSeconds * 0.5));
  const maxDuration = Math.ceil(targetDurationSeconds * 4 + 60);

  const params = new URLSearchParams({
    query: `${mood} instrumental`,
    token: env.music.freesoundApiKey ?? "",
    filter: `duration:[${minDuration} TO ${maxDuration}] license:"Creative Commons 0"`,
    fields: "id,name,duration,license,previews",
    sort: "rating_desc",
    page_size: "15",
  });

  const res = await fetch(`https://freesound.org/apiv2/search/text/?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Freesound search failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as FreesoundSearchResponse;
  return data.results ?? [];
}

/**
 * Fetches a royalty-free, context-appropriate background music track for
 * the given mood and saves it to `destDir`. Returns `null` (rather than
 * throwing) when music can't be sourced -- a missing API key, no results,
 * or a network error -- so the pipeline can fall back to voice-only audio
 * instead of failing the whole video over an optional enhancement.
 */
export async function fetchBackgroundMusic(
  mood: string,
  targetDurationSeconds: number,
  destDir: string
): Promise<string | null> {
  if (!env.music.enabled) {
    return null;
  }
  if (!env.music.freesoundApiKey) {
    console.warn("[music] FREESOUND_API_KEY not set -- skipping background music");
    return null;
  }

  try {
    const results = await withRetry(() => searchTracks(mood, targetDurationSeconds), {
      attempts: 3,
      baseDelayMs: 500,
    });

    const candidates = results.filter((r) => r.previews?.["preview-hq-mp3"]);
    if (candidates.length === 0) {
      console.warn(`[music] no CC0 tracks found for mood "${mood}" -- continuing without music`);
      return null;
    }

    // Pick randomly among the top matches (already sorted by rating) rather
    // than always the single top result, so repeated runs don't all reuse
    // the same track.
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    const previewUrl = chosen.previews["preview-hq-mp3"]!;

    const res = await fetch(previewUrl);
    if (!res.ok || !res.body) {
      throw new Error(`Failed to download Freesound preview: ${res.status}`);
    }

    fs.mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, `music_${chosen.id}.mp3`);
    await pipeline(res.body, fs.createWriteStream(destPath));

    return destPath;
  } catch (err) {
    // Background music is an enhancement, not a hard requirement -- log and
    // continue rather than failing the whole video generation job.
    console.warn(`[music] could not fetch background music: ${(err as Error).message}`);
    return null;
  }
}
