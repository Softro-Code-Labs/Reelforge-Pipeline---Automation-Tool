import { schedule as scheduleCron } from "node-cron";
import { env } from "./config/env";
import { startPipelineRun } from "./pipeline/runPipeline";
import { nowForLog } from "./utils/time";

/**
 * Converts an "HH:mm" wall-clock time into a daily cron expression
 * ("mm HH * * *"). Assumes `time` has already been validated by
 * {@link env.schedule.times}'s parser.
 */
function toCronExpression(time: string): string {
  const [hour, minute] = time.split(":");
  return `${parseInt(minute, 10)} ${parseInt(hour, 10)} * * *`;
}

/**
 * Starts one cron job per configured `SCHEDULE_TIMES` entry, each firing
 * daily at that wall-clock time in Sri Lanka (Asia/Colombo). Every firing
 * starts a normal pipeline run tagged trigger "scheduled" -- the same code
 * path as a manual "Generate Now" click, so scheduled videos post to the
 * same dashboard/database with no separate publishing step.
 *
 * A missing or empty `SCHEDULE_TIMES` env var is treated as "automated
 * scheduling disabled" -- manual generation still works normally.
 */
export function startScheduler(): void {
  const { times, timezone } = env.schedule;

  if (times.length === 0) {
    console.log("[scheduler] SCHEDULE_TIMES not set -- automated generation disabled (manual generation still works)");
    return;
  }

  for (const time of times) {
    scheduleCron(
      toCronExpression(time),
      () => {
        console.log(`${nowForLog()} [scheduler] Starting scheduled generation (${time} ${timezone})`);
        startPipelineRun("scheduled");
      },
      { timezone, name: `reelforge-${time}` }
    );
  }

  console.log(`[scheduler] Scheduled generation active at ${times.join(", ")} (${timezone}) daily`);
}
