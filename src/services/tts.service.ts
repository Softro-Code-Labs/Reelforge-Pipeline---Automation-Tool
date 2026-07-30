import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { env } from "../config/env";

/**
 * Runs the script through Piper (local, free, offline TTS) and writes a WAV
 * to destDir. Install Piper and point PIPER_VOICE_MODEL_PATH at a voice
 * .onnx + .onnx.json pair -- see README.
 *
 * @returns Absolute path to the generated `voiceover.wav`.
 */
export async function synthesizeVoiceover(script: string, destDir: string): Promise<string> {
  fs.mkdirSync(destDir, { recursive: true });
  const outputPath = path.join(destDir, "voiceover.wav");

  await new Promise<void>((resolve, reject) => {
    const piper = spawn(env.piper.binaryPath, [
      "--model",
      env.piper.voiceModelPath,
      "--output_file",
      outputPath,
    ]);

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
