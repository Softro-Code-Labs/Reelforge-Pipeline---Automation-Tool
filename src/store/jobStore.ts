import * as fs from "fs";
import * as path from "path";
import { env } from "../config/env";
import { nowForLog } from "../utils/time";

export type JobStatus = "pending" | "running" | "success" | "failed";

/** How a job was initiated -- shown in the history view alongside its metadata. */
export type JobTrigger = "manual" | "scheduled";

export interface JobRecord {
  id: string;
  status: JobStatus;
  /** UTC ISO timestamp; formatted to Sri Lanka time at the API/UI layer for display. */
  createdAt: string;
  /** UTC ISO timestamp; formatted to Sri Lanka time at the API/UI layer for display. */
  updatedAt: string;
  /** Whether this run was started manually from the UI or by the cron scheduler. */
  trigger: JobTrigger;
  topic?: string;
  videoPath?: string;
  title?: string;
  caption?: string;
  narrationScript?: string;
  hashtags?: string[];
  error?: string;
  log: string[];
}

/** Reads the full job table from disk. Returns `{}` if the DB file doesn't exist yet. */
function readAll(): Record<string, JobRecord> {
  if (!fs.existsSync(env.jobDbPath)) return {};
  return JSON.parse(fs.readFileSync(env.jobDbPath, "utf-8"));
}

/** Writes the full job table to disk, creating the parent directory if needed. */
function writeAll(data: Record<string, JobRecord>): void {
  fs.mkdirSync(path.dirname(env.jobDbPath), { recursive: true });
  fs.writeFileSync(env.jobDbPath, JSON.stringify(data, null, 2));
}

/** Creates a new job record with status "pending" and an empty log. */
export function createJob(id: string, trigger: JobTrigger = "manual"): JobRecord {
  const jobs = readAll();
  const job: JobRecord = {
    id,
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    trigger,
    log: [],
  };
  jobs[id] = job;
  writeAll(jobs);
  return job;
}

/** Merges `patch` into an existing job record and bumps `updatedAt`. No-op if the job is missing. */
export function updateJob(id: string, patch: Partial<JobRecord>): void {
  const jobs = readAll();
  const existing = jobs[id];
  if (!existing) return;
  jobs[id] = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  writeAll(jobs);
}

/** Appends a Sri Lanka-time-stamped line to a job's log, and echoes it to the console. */
export function appendLog(id: string, line: string): void {
  const jobs = readAll();
  const existing = jobs[id];
  if (!existing) return;
  existing.log.push(`${nowForLog()} ${line}`);
  existing.updatedAt = new Date().toISOString();
  writeAll(jobs);
  console.log(`[job ${id}] ${line}`);
}

/** Returns every job, newest first. */
export function listJobs(): JobRecord[] {
  return Object.values(readAll()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Returns every job with a successfully generated video, oldest first (FIFO order). */
export function listStoredVideoJobsOldestFirst(): JobRecord[] {
  return Object.values(readAll())
    .filter((j) => j.status === "success" && j.videoPath)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getJob(id: string): JobRecord | undefined {
  return readAll()[id];
}

/** Removes a job record from the store. Caller is responsible for deleting its on-disk assets. */
export function deleteJob(id: string): void {
  const jobs = readAll();
  if (!jobs[id]) return;
  delete jobs[id];
  writeAll(jobs);
}
