import { resolve } from "node:path";
import { importVitoNext } from "../../migration/VitoNextImporter.js";

const help = `Usage: vito import-vito-next --manifest FILE --destination DIR [options]

Offline one-time import from a quiesced Vito Next snapshot into a fresh pHouseVito
user directory. The source is never modified and no network or model calls occur.

Options:
  --manifest FILE       Absolute JSON manifest containing explicit source paths
  --destination DIR     Absolute fresh destination directory
  --template FILE       Target Vito config template (default: user.example/vito.config.json)
  --dry-run             Build and fully verify temporary output without publishing it
  --json                Print the machine-readable report
  --help                Show this help
`;

export async function runImportVitoNextCommand(
  args: string[],
  projectRoot: string,
): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(help);
    return 0;
  }
  const option = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const manifest = option("--manifest");
  const destination = option("--destination");
  if (!manifest || !destination) {
    process.stderr.write("--manifest and --destination are required\n");
    return 2;
  }
  try {
    const report = importVitoNext({
      manifestPath: resolve(manifest),
      destination,
      templateConfigPath: resolve(
        option("--template") ?? resolve(projectRoot, "user.example", "vito.config.json"),
      ),
      dryRun: args.includes("--dry-run"),
    });
    if (args.includes("--json")) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      process.stdout.write(
        `${report.state === "already-imported" ? "Already imported" : report.state === "dry-run" ? "Dry run verified" : "Imported"} Vito Next snapshot\n`,
      );
      process.stdout.write(`Source: ${report.sourceDigest}\n`);
      for (const [name, count] of Object.entries(report.counts))
        process.stdout.write(`${name}: ${count}\n`);
      for (const warning of report.warnings) process.stdout.write(`Warning: ${warning}\n`);
    }
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
