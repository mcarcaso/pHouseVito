import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "../api/client";

const OUTBOX_KEY = "vito-quick-command-outbox-v1";
const DATABASE = "vito-quick-command-audio";
const STORE = "recordings";

export interface QuickCommandOutboxEntry {
  id: string;
  uri: string;
  durationMs: number;
  session: string;
  createdAt: number;
  status: "queued" | "uploading" | "processing" | "failed";
  error?: string;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putAudio(id: string, blob: Blob): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(blob, id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function getAudio(id: string): Promise<Blob | null> {
  const db = await openDatabase();
  const value = await new Promise<Blob | undefined>((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value ?? null;
}

async function deleteAudio(id: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
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
  const response = await fetch(sourceUri);
  const blob = await response.blob();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  await putAudio(id, blob);
  const entry: QuickCommandOutboxEntry = {
    id,
    uri: `indexeddb://${id}`,
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
      const blob = await getAudio(entry.id);
      if (!blob) throw new Error("Saved recording is missing");
      await api("/api/quick-commands", {
        method: "POST",
        body: JSON.stringify({
          id: entry.id,
          audioBase64: await blobBase64(blob),
          mimeType: blob.type === "audio/webm" ? "audio/webm" : "audio/mp4",
          durationMs: entry.durationMs,
          session: entry.session || `quick-command:${entry.id}`,
        }),
      });
      await deleteAudio(entry.id);
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
  await deleteAudio(id);
  await save((await listQuickCommandOutbox()).filter((entry) => entry.id !== id));
}
