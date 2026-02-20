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

  // Log the default harness and settings
  const defaultHarness = config.settings?.harness || "claude-code";
  console.log(`Default harness: ${defaultHarness}`);
  if (defaultHarness === "claude-code") {
    const ccModel = config.settings?.["claude-code"]?.model || config.harnesses?.["claude-code"]?.model || "sonnet";
    console.log(`Claude Code model: ${ccModel}`);
  } else if (defaultHarness === "pi-coding-agent") {
    const piConfig = config.settings?.["pi-coding-agent"]?.model || config.harnesses?.["pi-coding-agent"]?.model;
    if (piConfig) {
      console.log(`Pi model: ${piConfig.provider}/${piConfig.name}`);
    }
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
    triggerJob: (name) => orchestrator.getCronScheduler().triggerJob(name),
    checkHealth: () => orchestrator.getCronScheduler().checkHealth(),
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
    getChannelInfo: (channelId: string) => discord.getChannelInfo(channelId),
  });

  // Start channels
  await orchestrator.start();

  console.log("\nVito is ready. Dashboard at http://localhost:3030\n");

  // Heartbeat log every 30 minutes to detect silent cron failures
  setInterval(() => {
    console.log(`[Heartbeat] Vito alive @ ${new Date().toLocaleString()}`);
    // Check cron job health
    const cronHealth = orchestrator.getCronScheduler().checkHealth();
    const stoppedJobs = cronHealth.filter(j => j.isStopped);
    if (stoppedJobs.length > 0) {
      console.error(`[Heartbeat] ⚠️ STOPPED CRON JOBS DETECTED: ${stoppedJobs.map(j => j.name).join(", ")}`);
    }
    console.log(`[Heartbeat] Cron jobs: ${cronHealth.length} total, ${cronHealth.filter(j => j.isStarted).length} running, ${stoppedJobs.length} stopped`);
  }, 30 * 60 * 1000); // 30 minutes

  // DEBUG: Check cron health every 5 minutes for now
  setInterval(() => {
    const cronHealth = orchestrator.getCronScheduler().checkHealth();
    const stoppedJobs = cronHealth.filter(j => j.isStopped);
    if (stoppedJobs.length > 0) {
      console.error(`[CronHealth] ⚠️ STOPPED: ${stoppedJobs.map(j => j.name).join(", ")}`);
    } else {
      console.log(`[CronHealth] All ${cronHealth.length} jobs running OK`);
    }
  }, 5 * 60 * 1000); // 5 minutes

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
