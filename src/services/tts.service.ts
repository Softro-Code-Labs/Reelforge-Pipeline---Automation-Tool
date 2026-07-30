import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { env } from "../config/env";
import { withRetry } from "../utils/retry";

/** Runs a CLI command to completion, rejecting with stderr on non-zero exit. */
function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stderr = "";
    proc.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr}`));
    });
  });
}

/**
 * Synthesizes narration via Microsoft Edge's neural voices, using the
 * unofficial free `edge-tts` CLI (https://github.com/rany2/edge-tts) --
 * genuinely natural-sounding, no API key, but NOT an official/supported
 * API: Microsoft can change the underlying endpoint or rate-limit it
 * without notice (this has happened before -- the project has needed
 * endpoint-compatibility fixes in the past). Any failure here is caught by
 * the caller and falls back to Piper, so an outage never fails a whole run.
 */
async function synthesizeWithEdgeTts(script: string, destDir: string): Promise<string> {
  fs.mkdirSync(destDir, { recursive: true });
  // Passed as a file (--file), not a raw CLI argument, so punctuation/quotes
  // in a Gemini-generated script can never break argument parsing.
  const scriptPath = path.join(destDir, "script.txt");
  fs.writeFileSync(scriptPath, script, "utf-8");
  const outputPath = path.join(destDir, "voiceover.mp3");

  await withRetry(
    () => run("edge-tts", ["--file", scriptPath, "--voice", env.tts.edgeVoice, "--write-media", outputPath]),
    { attempts: 2, baseDelayMs: 800 }
  );

  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    throw new Error("edge-tts reported success but wrote no audio");
  }
  return outputPath;
}

/**
 * Synthesizes narration via Piper (local, free, fully offline TTS). More
 * synthetic-sounding than edge-tts, but has no external dependency at all --
 * this is what keeps the pipeline working if edge-tts's unofficial endpoint
 * is ever rate-limited or changes upstream. Install Piper and point
 * PIPER_VOICE_MODEL_PATH at a voice .onnx + .onnx.json pair -- see README.
 */
async function synthesizeWithPiper(script: string, destDir: string): Promise<string> {
  fs.mkdirSync(destDir, { recursive: true });
  const outputPath = path.join(destDir, "voiceover.wav");

  await new Promise<void>((resolve, reject) => {
    const piper = spawn(env.piper.binaryPath, ["--model", env.piper.voiceModelPath, "--output_file", outputPath]);

    let stderr = "";
    piper.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    piper.on("error", reject);
    piper.on("close", (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve();
      } else {
        reject(new Error(`Piper exited with code ${code}: ${stderr}`));
      }
    });

    piper.stdin.write(script);
    piper.stdin.end();
  });

  return outputPath;
}

/**
 * Generates the voiceover for a script. Tries `env.tts.provider` first
 * (edge-tts by default) and transparently falls back to Piper on failure,
 * so an unofficial-API hiccup degrades quality for one video rather than
 * failing the run outright.
 *
 * @returns Absolute path to the generated audio file (.mp3 for edge-tts, .wav for Piper).
 */
export async function synthesizeVoiceover(script: string, destDir: string): Promise<string> {
  if (env.tts.provider === "edge") {
    try {
      return await synthesizeWithEdgeTts(script, destDir);
    } catch (err) {
      console.warn(`[tts] edge-tts failed, falling back to Piper: ${(err as Error).message}`);
    }
  }
  return synthesizeWithPiper(script, destDir);
}
