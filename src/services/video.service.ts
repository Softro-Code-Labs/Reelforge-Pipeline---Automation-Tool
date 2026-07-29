import { spawn } from "child_process";
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

// Concatenates clips (cropped to portrait), overlays the voiceover, and
// burns in captions. Outputs a single 9:16 MP4 sized for TikTok.
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

  // Build ffmpeg inputs: N video clips + 1 audio track.
  const inputArgs: string[] = [];
  clipPaths.forEach((clip) => {
    inputArgs.push("-i", clip);
  });
  inputArgs.push("-i", audioPath);

  // Per-clip: scale+crop to target aspect ratio, trim to an even share of
  // the audio length, reset timestamps so concat lines up cleanly.
  const perClipFilters = clipPaths
    .map(
      (_, i) =>
        `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
        `crop=${width}:${height},trim=duration=${perClipDuration.toFixed(2)},setpts=PTS-STARTPTS[v${i}]`
    )
    .join(";");

  const concatInputs = clipPaths.map((_, i) => `[v${i}]`).join("");
  const concatFilter = `${concatInputs}concat=n=${clipPaths.length}:v=1:a=0[vconcat]`;

  // Escape path for ffmpeg's subtitles filter (colons need escaping on most platforms).
  const escapedSrtPath = srtPath.replace(/:/g, "\\:");
  const captionFilter =
    `[vconcat]subtitles='${escapedSrtPath}':force_style=` +
    `'FontName=Arial,FontSize=16,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,BorderStyle=1,Outline=2,Alignment=2,MarginV=120'[vout]`;

  const filterComplex = [perClipFilters, concatFilter, captionFilter].join(";");
  const audioIndex = clipPaths.length; // last input is the voiceover track

  const args = [
    "-y",
    ...inputArgs,
    "-filter_complex",
    filterComplex,
    "-map",
    "[vout]",
    "-map",
    `${audioIndex}:a`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-c:a",
    "aac",
    "-shortest",
    outputPath,
  ];

  await run(env.video.ffmpegPath, args);
  return outputPath;
}
