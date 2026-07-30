import fetch from "node-fetch";
import * as fs from "fs";
import * as path from "path";
import { pipeline } from "stream/promises";
import { env } from "../config/env";
import { withRetry } from "../utils/retry";

// Hard ceiling on source clip height. Without this, the fallback below can
// pick a 4K file, which is dramatically more expensive to decode/scale and
// was a direct contributor to both the multi-minute ffmpeg runs and the
// Render OOM (more decoded frame memory per clip, times N clips open at once).
const MAX_SOURCE_HEIGHT = 1920;

// How many results to pull per keyword. Wider than the minimum needed so we
// have room to skip clips that are too short or already used elsewhere in
// this same job (avoids two keywords silently returning the same footage).
const RESULTS_PER_KEYWORD = 12;

interface PexelsVideoFile {
  quality: string;
  width: number;
  height: number;
  link: string;
}

interface PexelsVideo {
  id: number;
  duration: number;
  video_files: PexelsVideoFile[];
}

/** Picks the best-fit source file for a candidate video: HD, capped at {@link MAX_SOURCE_HEIGHT}. */
function pickBestFile(candidate: PexelsVideo): PexelsVideoFile | undefined {
  return (
    candidate.video_files.find(
      (f) => f.quality === "hd" && f.height >= 1280 && f.height <= MAX_SOURCE_HEIGHT
    ) ??
    candidate.video_files
      .filter((f) => f.height <= MAX_SOURCE_HEIGHT)
      .sort((a, b) => b.height - a.height)[0] ??
    candidate.video_files.sort((a, b) => a.height - b.height)[0]
  );
}

/**
 * Searches Pexels for portrait clips matching `keyword`, returning results
 * ordered as Pexels ranks them. Retries transient network/rate-limit errors.
 */
async function searchClips(keyword: string): Promise<PexelsVideo[]> {
  const searchUrl = `https://api.pexels.com/videos/search?query=${encodeURIComponent(
    keyword
  )}&orientation=portrait&per_page=${RESULTS_PER_KEYWORD}`;

  return withRetry(
    async () => {
      const res = await fetch(searchUrl, {
        headers: { Authorization: env.pexels.apiKey },
      });
      if (!res.ok) {
        throw new Error(`Pexels search failed (${res.status}): ${await res.text()}`);
      }
      const data: any = await res.json();
      return (data.videos ?? []) as PexelsVideo[];
    },
    { attempts: 3, baseDelayMs: 500 }
  );
}

/** Streams a Pexels video file to disk and returns the local path. */
async function downloadClip(video: PexelsVideo, file: PexelsVideoFile, destDir: string): Promise<string> {
  const fileRes = await fetch(file.link);
  if (!fileRes.ok || !fileRes.body) {
    throw new Error(`Failed to download Pexels clip: ${fileRes.status}`);
  }

  fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, `clip_${video.id}.mp4`);
  // Stream straight to disk instead of buffering the whole file in memory.
  await pipeline(fileRes.body, fs.createWriteStream(destPath));
  return destPath;
}

/**
 * Fetches one stock clip matching `keyword`, preferring a result that:
 *  - is at least `minDurationSeconds` long (so it doesn't need heavy looping
 *    later to fill its slot in the final video), and
 *  - hasn't already been used elsewhere in this job (`usedIds`), for variety.
 * Falls back to the first usable result if nothing meets both preferences.
 */
export async function fetchStockClip(
  keyword: string,
  destDir: string,
  usedIds: Set<number> = new Set(),
  minDurationSeconds = 0
): Promise<string> {
  const videos = await searchClips(keyword);
  if (videos.length === 0) {
    throw new Error(`No Pexels results for keyword "${keyword}"`);
  }

  const withFiles = videos
    .map((v) => ({ video: v, file: pickBestFile(v) }))
    .filter((c): c is { video: PexelsVideo; file: PexelsVideoFile } => !!c.file);

  if (withFiles.length === 0) {
    throw new Error(`No usable video file for keyword "${keyword}"`);
  }

  const candidate =
    // Best case: long enough and not a repeat.
    withFiles.find((c) => !usedIds.has(c.video.id) && c.video.duration >= minDurationSeconds) ??
    // Next best: not a repeat, even if short (video.service loops short clips to fill their slot).
    withFiles.find((c) => !usedIds.has(c.video.id)) ??
    // Last resort: reuse is fine, better than failing the job.
    withFiles[0];

  usedIds.add(candidate.video.id);
  return downloadClip(candidate.video, candidate.file, destDir);
}

/**
 * Fetches one clip per keyword. Individual keyword failures are logged and
 * skipped rather than aborting the whole job -- a partial set of clips is
 * still enough to assemble a video.
 */
export async function fetchStockClips(
  keywords: string[],
  destDir: string,
  targetDurationSeconds?: number
): Promise<string[]> {
  const paths: string[] = [];
  const usedIds = new Set<number>();
  // Rough per-clip floor so we prefer clips that won't need looping; the
  // exact per-clip duration is only known later once voiceover length is
  // measured, so this is a best-effort target, not a hard requirement.
  const minDurationSeconds = targetDurationSeconds
    ? targetDurationSeconds / Math.max(keywords.length, 1)
    : 0;

  for (const keyword of keywords) {
    try {
      paths.push(await fetchStockClip(keyword, destDir, usedIds, minDurationSeconds));
    } catch (err) {
      // Skip a failed keyword rather than aborting the whole job.
      console.warn(`[pexels] skipping keyword "${keyword}": ${(err as Error).message}`);
    }
  }
  if (paths.length === 0) {
    throw new Error("Could not fetch any stock clips for the given keywords");
  }
  return paths;
}
