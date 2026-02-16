import { resolve } from "path";
import { existsSync, writeFileSync, readFileSync, watch } from "fs";
import { createDatabase } from "./db/schema.js";
import { Queries } from "./db/queries.js";
import { ensureUserDir, loadConfig, loadSoul, USER_DIR } from "./config.js";
import { Orchestrator } from "./orchestrator.js";
import { DashboardChannel } from "./channels/dashboard.js";
import { TelegramChannel } from "./channels/telegram.js";
import { DiscordChannel } from "./channels/discord.js";
import { loadSecrets } from "./secrets.js";

const ROOT = process.cwd();

async function main() {
  // Ensure user/ directory exists (copy from user.example/ on first run)
  ensureUserDir();

  // Load secrets.json as source of truth (inject into process.env)
  loadSecrets();

  console.log("Starting Vito...\n");

  // Load config and soul
  const config = loadConfig();
  const soul = loadSoul();

  // Log the active model
  const activeModel = config.harnesses?.["pi-coding-agent"]?.model || config.model;
  if (activeModel) {
    console.log(`Model: ${activeModel.provider}/${activeModel.name}`);
  }
  if (soul) {
    console.log("SOUL.md loaded");
  }

  // Initialize database
  const dbPath = resolve(USER_DIR, "vito.db");
  const db = createDatabase(dbPath);
  const queries = new Queries(db);
  console.log(`Database: ${dbPath}`);

  // Create orchestrator
  const skillsDir = resolve(USER_DIR, "skills");
  const orchestrator = new Orchestrator(queries, config, soul, skillsDir);

  // Register Dashboard channel (starts web server)
  const dashboard = new DashboardChannel(db, queries, config);
  dashboard.setSkillsGetter(() => orchestrator.getSkills());
  dashboard.setCronManager({
    scheduleJob: (job) => orchestrator.getCronScheduler().scheduleJob(job),
    removeJob: (name) => orchestrator.getCronScheduler().removeJob(name),
    getActiveJobs: () => orchestrator.getCronScheduler().getActiveJobs(),
  });
  orchestrator.registerChannel(dashboard);

  // Register Telegram channel
  const telegram = new TelegramChannel(config);
  orchestrator.registerChannel(telegram);

  // Register Discord channel
  const discord = new DiscordChannel(config);
  orchestrator.registerChannel(discord);
  dashboard.setDiscordChannel({
    registerSlashCommands: () => discord.registerSlashCommands(),
  });

  // Start channels
  await orchestrator.start();

  console.log("\nVito is ready. Dashboard at http://localhost:3030\n");

  // Watch config file for changes (hot-reload cron jobs)
  const configPath = resolve(USER_DIR, "vito.config.json");
  let reloadTimeout: NodeJS.Timeout | null = null;
  
  watch(configPath, (eventType) => {
    if (eventType === "change") {
      // Debounce rapid changes
      if (reloadTimeout) clearTimeout(reloadTimeout);
      
      reloadTimeout = setTimeout(() => {
        try {
          console.log("\n[Config] Detected changes, reloading...");
          const newConfig = loadConfig();
          orchestrator.reloadConfig(newConfig);
          orchestrator.reloadCronJobs(newConfig.cron.jobs);
          dashboard.reloadConfig(newConfig);
          console.log("[Config] Reloaded successfully\n");
        } catch (err) {
          console.error("[Config] Failed to reload:", err);
        }
      }, 500); // Wait 500ms for file write to complete
    }
  });
  
  console.log("[Config] Watching for changes...\n");

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await orchestrator.stop();
    db.close();
    process.exit(0);
  });

  // Keep process alive (dashboard server handles connections)
  process.stdin.resume();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
