import * as fs from "fs/promises";
import * as path from "path";
import { env } from "../config/env";
import { deleteJob, listStoredVideoJobsOldestFirst } from "../store/jobStore";

/**
 * Deletes a job's on-disk working directory (clips, audio, and the final
 * video) along with its database record. Missing files are ignored --
 * deletion is best-effort cleanup, not a correctness-critical operation.
 * Used both by the FIFO auto-purge below and by manual delete from the UI.
 */
export async function deleteStoredVideo(jobId: string): Promise<void> {
  const jobWorkDir = path.join(env.workdir, jobId);
  try {
    await fs.rm(jobWorkDir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`[storage] failed to remove ${jobWorkDir}: ${(err as Error).message}`);
  }
  deleteJob(jobId);
}

/**
 * Enforces the FIFO retention policy: keeps at most
 * `env.storage.maxStoredVideos` successfully generated videos on disk. When
 * over the limit, deletes the oldest video(s) -- both the file and its
 * database record -- until back within the limit.
 *
 * Called after every successful generation (manual or scheduled), so
 * storage never grows unbounded.
 */
export async function enforceStorageLimit(): Promise<void> {
  const stored = listStoredVideoJobsOldestFirst();
  const excess = stored.length - env.storage.maxStoredVideos;
  if (excess <= 0) return;

  const toDelete = stored.slice(0, excess);
  for (const job of toDelete) {
    console.log(
      `[storage] over ${env.storage.maxStoredVideos}-video limit -- purging oldest job ${job.id} (${job.topic ?? "untitled"})`
    );
    await deleteStoredVideo(job.id);
  }
}
