import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { env } from "../config/env";
import { buildSrt } from "./captions";

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c) => (stdout += c.toString()));
    proc.stderr.on("data", (c) => (stderr += c.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exited ${code}: ${stderr}`));
    });
  });
}

async function getAudioDurationSeconds(audioPath: string): Promise<number> {
  const out = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    audioPath,
  ]);
  const seconds = parseFloat(out.trim());
  if (!seconds || Number.isNaN(seconds)) {
    throw new Error(`Could not read duration of ${audioPath}`);
  }
  return seconds;
}

// Scales+crops+trims a single source clip to the target aspect ratio and
// duration. Doing this one clip at a time (rather than in one big
// filter_complex with every clip open at once) keeps peak memory bounded to
// roughly a single decoder's worth of frames instead of N of them summed
// together -- this is what was causing the Render OOM.
async function preprocessClip(
  clipPath: string,
  duration: number,
  width: number,
  height: number,
  outPath: string
): Promise<void> {
  await run(env.video.ffmpegPath, [
    "-y",
    "-i",
    clipPath,
    "-t",
    duration.toFixed(2),
    "-vf",
    `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    outPath,
  ]);
}

// Concatenates clips (cropped to portrait), overlays the voiceover, and
// burns in captions. Outputs a single 9:16 MP4 sized for TikTok.
//
// Runs in three passes to keep memory and CPU bounded:
//   1. Preprocess each clip individually (scale/crop/trim) -- one decoder
//      open at a time instead of all of them at once.
//   2. Concatenate the (now uniform, already-small) processed clips with
//      the concat demuxer + "-c copy" -- a stream copy, no re-decoding.
//   3. Single pass over the concatenated video to mux in audio and burn in
//      subtitles.
export async function assembleVideo(params: {
  clipPaths: string[];
  audioPath: string;
  narrationScript: string;
  workDir: string;
}): Promise<string> {
  const { clipPaths, audioPath, narrationScript, workDir } = params;
  const { width, height } = env.video;

  const audioDuration = await getAudioDurationSeconds(audioPath);
  const perClipDuration = audioDuration / clipPaths.length;

  const srtPath = buildSrt(narrationScript, audioDuration, workDir);
  const outputPath = path.join(workDir, "final.mp4");

  // Pass 1: preprocess clips one at a time.
  const processedDir = path.join(workDir, "processed");
  fs.mkdirSync(processedDir, { recursive: true });
  const processedPaths: string[] = [];
  for (let i = 0; i < clipPaths.length; i++) {
    const outPath = path.join(processedDir, `clip_${i}.mp4`);
    await preprocessClip(clipPaths[i], perClipDuration, width, height, outPath);
    processedPaths.push(outPath);
  }

  // Pass 2: cheap concat via the concat demuxer (stream copy, no decode).
  const listPath = path.join(processedDir, "list.txt");
  const listContents = processedPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  fs.writeFileSync(listPath, listContents);

  const concatPath = path.join(workDir, "concat.mp4");
  await run(env.video.ffmpegPath, [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    concatPath,
  ]);

  // Pass 3: mux audio + burn in captions in a single decode pass.
  // Note: DejaVu Sans (not Arial, which doesn't exist on Linux) -- see
  // Dockerfile, which installs fonts-dejavu-core and prebuilds the
  // fontconfig cache so this doesn't trigger slow font-matching at runtime.
  const escapedSrtPath = srtPath.replace(/:/g, "\\:");
  const captionFilter =
    `subtitles='${escapedSrtPath}':force_style=` +
    `'FontName=DejaVu Sans,FontSize=16,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,BorderStyle=1,Outline=2,Alignment=2,MarginV=120'`;

  await run(env.video.ffmpegPath, [
    "-y",
    "-i",
    concatPath,
    "-i",
    audioPath,
    "-vf",
    captionFilter,
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-c:a",
    "aac",
    "-shortest",
    outputPath,
  ]);

  return outputPath;
}
