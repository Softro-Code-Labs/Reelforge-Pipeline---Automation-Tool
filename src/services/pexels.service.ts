import fetch from "node-fetch";
import * as fs from "fs";
import * as path from "path";
import { env } from "../config/env";

interface PexelsVideoFile {
  quality: string;
  width: number;
  height: number;
  link: string;
}

interface PexelsVideo {
  id: number;
  video_files: PexelsVideoFile[];
}

/**
 * Searches Pexels for a portrait-oriented clip matching the keyword and
 * downloads the best-fit file to `destDir`. Returns the local file path.
 */
export async function fetchStockClip(keyword: string, destDir: string): Promise<string> {
  const searchUrl = `https://api.pexels.com/videos/search?query=${encodeURIComponent(
    keyword
  )}&orientation=portrait&per_page=5`;

  const res = await fetch(searchUrl, {
    headers: { Authorization: env.pexels.apiKey },
  });

  if (!res.ok) {
    throw new Error(`Pexels search failed (${res.status}): ${await res.text()}`);
  }

  const data: any = await res.json();
  const videos: PexelsVideo[] = data.videos ?? [];
  if (videos.length === 0) {
    throw new Error(`No Pexels results for keyword "${keyword}"`);
  }

  // Prefer an HD file close to our target resolution, without going huge.
  const candidate = videos[0];
  const file =
    candidate.video_files.find((f) => f.quality === "hd" && f.height >= 1280) ??
    candidate.video_files.sort((a, b) => b.height - a.height)[0];

  if (!file) {
    throw new Error(`No usable video file for keyword "${keyword}"`);
  }

  const fileRes = await fetch(file.link);
  if (!fileRes.ok) {
    throw new Error(`Failed to download Pexels clip: ${fileRes.status}`);
  }

  fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, `clip_${candidate.id}.mp4`);
  const buffer = await fileRes.buffer();
  fs.writeFileSync(destPath, buffer);

  return destPath;
}

export async function fetchStockClips(keywords: string[], destDir: string): Promise<string[]> {
  const paths: string[] = [];
  for (const keyword of keywords) {
    try {
      paths.push(await fetchStockClip(keyword, destDir));
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
