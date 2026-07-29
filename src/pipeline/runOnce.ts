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
