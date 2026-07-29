import * as fs from "fs";
import * as path from "path";

function formatSrtTime(totalSeconds: number): string {
  const ms = Math.floor((totalSeconds % 1) * 1000);
  const totalSecInt = Math.floor(totalSeconds);
  const h = Math.floor(totalSecInt / 3600);
  const m = Math.floor((totalSecInt % 3600) / 60);
  const s = totalSecInt % 60;
  const pad = (n: number, len = 2) => n.toString().padStart(len, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

// Splits the script into short caption chunks and spreads them evenly across
// the audio duration -- an estimate, not word-level alignment.
export function buildSrt(script: string, audioDurationSeconds: number, destDir: string): string {
  const words = script.trim().split(/\s+/);
  const wordsPerChunk = 6;
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    chunks.push(words.slice(i, i + wordsPerChunk).join(" "));
  }

  const perChunkSeconds = audioDurationSeconds / chunks.length;
  let srt = "";
  chunks.forEach((chunk, i) => {
    const start = i * perChunkSeconds;
    const end = (i + 1) * perChunkSeconds;
    srt += `${i + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${chunk}\n\n`;
  });

  fs.mkdirSync(destDir, { recursive: true });
  const srtPath = path.join(destDir, "captions.srt");
  fs.writeFileSync(srtPath, srt, "utf-8");
  return srtPath;
}
