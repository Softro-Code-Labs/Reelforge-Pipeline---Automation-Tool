/**
 * CLI entrypoint for `npm run run:once` -- runs a single pipeline job to
 * completion outside the web server, useful for testing the pipeline
 * end-to-end without the UI.
 */
import { runPipelineOnce } from "./runPipeline";

runPipelineOnce()
  .then(() => {
    console.log("Pipeline run finished. Check ./data/jobs.json for the result.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Pipeline run crashed:", err);
    process.exit(1);
  });
