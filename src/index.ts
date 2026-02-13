import { resolve } from "path";
import { createDatabase } from "./db/schema.js";
import { Queries } from "./db/queries.js";
import { loadConfig, loadSoul } from "./config.js";
import { Orchestrator } from "./orchestrator.js";
import { CLIChannel } from "./channels/cli.js";

const ROOT = process.cwd();

async function main() {
  console.log("Starting Vito...\n");

  // Load config and soul
  const config = loadConfig();
  const soul = loadSoul();

  console.log(`Model: ${config.model.provider}/${config.model.name}`);
  if (soul) {
    console.log("SOUL.md loaded");
  }

  // Initialize database
  const dbPath = resolve(ROOT, "data", "vito.db");
  const db = createDatabase(dbPath);
  const queries = new Queries(db);
  console.log(`Database: ${dbPath}`);

  // Create orchestrator
  const skillsDir = resolve(ROOT, "skills");
  const orchestrator = new Orchestrator(queries, config, soul, skillsDir);

  // Register CLI channel
  const cli = new CLIChannel();
  orchestrator.registerChannel(cli);

  // Start channels (sets up listeners but doesn't prompt yet)
  await orchestrator.start();

  console.log("\nVito is ready. Type /quit to exit.\n");

  // Now start the CLI prompt loop (after all startup messages are done)
  cli.startPrompting();

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await orchestrator.stop();
    db.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
