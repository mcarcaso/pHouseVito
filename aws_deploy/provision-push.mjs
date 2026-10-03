import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parse } from "dotenv";

// API used by https://d163752fjydz82.cloudfront.net/ and Vito's push service.
const GATEWAY_URL = "https://kdxjux37p8.execute-api.us-east-1.amazonaws.com";

export async function provisionPush(envPath, outputPath, name, fetcher = fetch) {
  let env;
  try {
    env = parse(readFileSync(envPath));
  } catch (cause) {
    if (cause.code !== "ENOENT") throw new Error("Could not read deployment .env");
    env = {};
  }
  const apiKey = env.PHOUSE_VITO_PUSH_API_KEY?.trim();
  if (!apiKey) {
    writeFileSync(outputPath, "{}\n", { mode: 0o600 });
    return false;
  }

  let response;
  try {
    response = await fetcher(`${GATEWAY_URL}/v1/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ displayName: name }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("Push account creation failed: gateway unreachable or timed out");
  }
  if (!response.ok) throw new Error(`Push account creation failed (${response.status})`);
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Push account creation returned invalid JSON");
  }
  if (!/^vpk_live_[a-zA-Z0-9_-]{32,}$/.test(result?.pushKey ?? "")) {
    throw new Error("Push account creation returned an invalid pushKey");
  }
  writeFileSync(
    outputPath,
    JSON.stringify({ PHOUSE_VITO_PUSH_API_KEY: apiKey, PHOUSE_VITO_PUSH_KEY: result.pushKey }) +
      "\n",
    { mode: 0o600 },
  );
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const created = await provisionPush(...process.argv.slice(2));
    console.log(
      created ? "Push account created" : "Push setup skipped: no API key in deployment .env",
    );
  } catch (cause) {
    console.error(cause.message);
    process.exitCode = 1;
  }
}
