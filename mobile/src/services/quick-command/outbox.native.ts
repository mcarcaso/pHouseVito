import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { api } from "../api/client";

const OUTBOX_KEY = "vito-quick-command-outbox-v1";
const DIRECTORY = `${FileSystem.documentDirectory}quick-commands/`;

export interface QuickCommandOutboxEntry {
  id: string;
  uri: string;
  durationMs: number;
  session: string;
  createdAt: number;
  status: "queued" | "uploading" | "processing" | "failed";
  error?: string;
}

export async function listQuickCommandOutbox(): Promise<QuickCommandOutboxEntry[]> {
  const stored = await AsyncStorage.getItem(OUTBOX_KEY);
  if (!stored) return [];
  try {
    const value = JSON.parse(stored) as QuickCommandOutboxEntry[];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

async function save(entries: QuickCommandOutboxEntry[]) {
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(entries));
}

export async function enqueueQuickCommand(
  sourceUri: string,
  durationMs: number,
  destinationSession?: string,
): Promise<QuickCommandOutboxEntry> {
  await FileSystem.makeDirectoryAsync(DIRECTORY, { intermediates: true });
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const extension = sourceUri.match(/\.[a-z0-9]+(?:\?|$)/i)?.[0]?.replace("?", "") ?? ".m4a";
  const uri = `${DIRECTORY}${id}${extension}`;
  await FileSystem.copyAsync({ from: sourceUri, to: uri });
  const entry: QuickCommandOutboxEntry = {
    id,
    uri,
    durationMs,
    session: destinationSession || `quick-command:${id}`,
    createdAt: Date.now(),
    status: "queued",
  };
  await save([...(await listQuickCommandOutbox()), entry]);
  return entry;
}

let activeSync: Promise<QuickCommandOutboxEntry[]> | null = null;

async function performQuickCommandSync(): Promise<QuickCommandOutboxEntry[]> {
  let entries = await listQuickCommandOutbox();
  for (const entry of entries.filter(
    (item) => item.status === "queued" || item.status === "uploading" || item.status === "failed",
  )) {
    entries = entries.map((item) =>
      item.id === entry.id ? { ...item, status: "uploading", error: undefined } : item,
    );
    await save(entries);
    try {
      const audioBase64 = await FileSystem.readAsStringAsync(entry.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const extension = entry.uri.split(".").pop()?.toLowerCase();
      const mimeType =
        extension === "webm" ? "audio/webm" : extension === "wav" ? "audio/wav" : "audio/m4a";
      await api(`/api/quick-commands`, {
        method: "POST",
        body: JSON.stringify({
          id: entry.id,
          audioBase64,
          mimeType,
          durationMs: entry.durationMs,
          session: entry.session || `quick-command:${entry.id}`,
        }),
      });
      await FileSystem.deleteAsync(entry.uri, { idempotent: true });
      entries = entries.filter((item) => item.id !== entry.id);
    } catch (cause) {
      entries = entries.map((item) =>
        item.id === entry.id
          ? {
              ...item,
              status: "failed",
              error: cause instanceof Error ? cause.message : "Upload failed",
            }
          : item,
      );
    }
    await save(entries);
  }
  return entries;
}

export function syncQuickCommandOutbox(): Promise<QuickCommandOutboxEntry[]> {
  if (activeSync) return activeSync;
  activeSync = performQuickCommandSync().finally(() => {
    activeSync = null;
  });
  return activeSync;
}

export async function removeQuickCommand(id: string): Promise<void> {
  const entries = await listQuickCommandOutbox();
  const target = entries.find((entry) => entry.id === id);
  if (target) await FileSystem.deleteAsync(target.uri, { idempotent: true });
  await save(entries.filter((entry) => entry.id !== id));
}
