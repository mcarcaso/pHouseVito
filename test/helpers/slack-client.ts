import type { SlackWebClient } from "../../src/services/channels/slack/SlackOutputHandler.js";

export function mockSlackClient() {
  const posts: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const deletes: Array<Record<string, unknown>> = [];
  const ephemerals: Array<Record<string, unknown>> = [];
  const uploads: Array<Record<string, unknown>> = [];
  const reactions: string[] = [];
  const client = {
    auth: { test: async () => ({ ok: true, team_id: "T123", user_id: "UBOT" }) },
    chat: {
      postMessage: async (args: Record<string, unknown>) => {
        posts.push(args);
        return { ok: true, ts: `1710000100.${posts.length.toString().padStart(6, "0")}` };
      },
      update: async (args: Record<string, unknown>) => {
        updates.push(args);
        return { ok: true };
      },
      delete: async (args: Record<string, unknown>) => {
        deletes.push(args);
        return { ok: true };
      },
      postEphemeral: async (args: Record<string, unknown>) => {
        ephemerals.push(args);
        return { ok: true };
      },
    },
    conversations: {
      info: async () => ({ ok: true, channel: { name: "general" } }),
      history: async () => ({ ok: true, messages: [] }),
    },
    users: { info: async () => ({ ok: true, user: { name: "Mike" } }) },
    filesUploadV2: async (args: Record<string, unknown>) => {
      uploads.push(args);
      return { ok: true };
    },
    reactions: {
      add: async () => {
        reactions.push("add");
        return { ok: true };
      },
      remove: async () => {
        reactions.push("remove");
        return { ok: true };
      },
    },
  } as unknown as SlackWebClient;
  return { client, posts, updates, deletes, ephemerals, uploads, reactions };
}
