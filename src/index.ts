import { resolve } from "path";
import { watch } from "fs";
import { createDatabase } from "./db/schema.js";
import { RootContext } from "./context/RootContext.js";
import { ensureUserDir, USER_DIR } from "./config.js";
import { xAskApiService, xCronService, xEmbeddingDb, xOrchestratorService, xSecretService, xVitoService } from "./lib/x.js";
import { DashboardChannelService } from "./services/channels/dashboard/DashboardChannelService.js";
import { DiscordChannelService } from "./services/channels/discord/DiscordChannelService.js";
import { TelegramChannelService } from "./services/channels/telegram/TelegramChannelService.js";
import { DEFAULT_TIMEZONE } from "./system-instructions.js";

async function main() {
  // Ensure user/ directory exists (copy from user.example/ on first run)
  ensureUserDir();

  console.log("Starting server...\n");

  // Initialize stable dependencies, then load secrets into the process environment.
  const dbPath = resolve(USER_DIR, "vito.db");
  const db = createDatabase(dbPath);
  const skillsDir = resolve(USER_DIR, "skills");
  const x = RootContext({ db, userDir: USER_DIR, skillsDir });
  xSecretService(x).load(x);
  const vitoService = xVitoService(x);
  const config = vitoService.getConfig(x);
  const soul = vitoService.getSoul(x);
  console.log(`Database: ${dbPath}`);

  // Set the process timezone from config (default: America/Toronto).
  // This propagates to every child process we spawn — shell tools, Pi's bash,
  // skills that call `date`, etc. — so they all return local time regardless
  // of the host OS clock (important for UTC servers like EC2).
  const tz = config.settings?.timezone || DEFAULT_TIMEZONE;
  process.env.TZ = tz;
  console.log(`Timezone: ${tz}`);

  // Log the configured Pi model.
  const piConfig = config.settings?.["pi-coding-agent"]?.model || config.harnesses?.["pi-coding-agent"]?.model;
  if (piConfig) {
    console.log(`Pi model: ${piConfig.provider}/${piConfig.name}`);
  }
  if (soul) {
    console.log("SOUL.md loaded");
  }

  // Create orchestrator
  const orchestrator = xOrchestratorService(x);

  // Register Dashboard channel (starts web server).
  const dashboard = new DashboardChannelService();
  xAskApiService(x).configure(x, (opts) => orchestrator.ask(x, opts));
  orchestrator.registerChannel(x, dashboard);

  // Register externally managed channel services. Their platform-specific
  // management capabilities are discovered through ChannelRegistryService.
  orchestrator.registerChannel(x, new TelegramChannelService());
  orchestrator.registerChannel(x, new DiscordChannelService());

  // Start channels
  await orchestrator.start(x);

  console.log("\nVito is ready. Dashboard at http://localhost:3030\n");

  // Heartbeat log every 30 minutes
  setInterval(() => {
    console.log(`[Heartbeat] Server alive @ ${new Date().toLocaleString()}`);
    const cronHealth = xCronService(x).checkHealth(x);
    console.log(`[Heartbeat] Cron jobs: ${cronHealth.length} active`);
  }, 30 * 60 * 1000); // 30 minutes

  // Watch config file for changes (hot-reload cron jobs)
  let reloadTimeout: NodeJS.Timeout | null = null;
  
  watch(USER_DIR, (eventType, filename) => {
    if (filename === "vito.config.json" && (eventType === "change" || eventType === "rename")) {
      // Debounce rapid changes
      if (reloadTimeout) clearTimeout(reloadTimeout);
      
      reloadTimeout = setTimeout(() => {
        try {
          console.log("\n[Config] Detected changes, reloading...");
          const newConfig = vitoService.getConfig(x);
          
          // Reload each component separately so one failure doesn't block others
          try {
            orchestrator.reloadConfig(x, newConfig);
          } catch (err) {
            console.error("[Config] Failed to reload orchestrator config:", err);
          }
          
          try {
            orchestrator.reloadCronJobs(x, newConfig.cron.jobs, newConfig.settings?.timezone);
          } catch (err) {
            console.error("[Config] Failed to reload cron jobs:", err);
          }
          
          console.log("[Config] Reload complete\n");
        } catch (err) {
          console.error("[Config] Failed to load config file:", err);
        }
      }, 3000); // Wait 3s to collapse rapid config writes into one reload
    }
  });
  
  console.log("[Config] Watching for changes...\n");

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await orchestrator.stop(x);
    xEmbeddingDb(x).close();
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
