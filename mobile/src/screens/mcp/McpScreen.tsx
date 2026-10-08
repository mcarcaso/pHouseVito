import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { api } from "../../services/api/client";
import { useThemeStyles, useVitoTheme, type VitoTheme } from "../../hooks/useVitoTheme";
import { mcpSaveSchema, type McpServer } from "../../../../src/shared/schemas/mcp";

type Entry = { name: string; server: McpServer; missingSecrets: string[] };
type Overview = { servers: Entry[]; applyPolicy: string };
type Tool = { name: string; description?: string };
const exposures = [
  {
    value: "deferred",
    title: "On demand",
    detail: "Discover tools with search; load only the ones needed.",
  },
  {
    value: "codemode-deferred",
    title: "Code mode",
    detail: "Discover and call tools inside a code script.",
  },
  {
    value: "direct",
    title: "Always visible",
    detail: "Declare every tool upfront. Uses more context.",
  },
  {
    value: "hidden",
    title: "Hidden",
    detail: "Tools are unavailable unless an advanced rule exposes them.",
  },
] as const;

export function McpScreen({ onUnauthorized }: { onUnauthorized: () => void }) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"http" | "stdio">("http");
  const [endpoint, setEndpoint] = useState("");
  const [args, setArgs] = useState("");
  const [cwd, setCwd] = useState("");
  const [references, setReferences] = useState("");
  const [exposure, setExposure] = useState<McpServer["exposure"]>("deferred");
  const [enabled, setEnabled] = useState(true);
  const [timeout, setTimeoutValue] = useState("30");
  const [advanced, setAdvanced] = useState(false);
  const [rules, setRules] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [checks, setChecks] = useState<
    Record<string, { tools?: Tool[]; error?: string; checking?: boolean }>
  >({});
  const [openTools, setOpenTools] = useState<string | null>(null);
  const handleError = (cause: unknown) => {
    const message = cause instanceof Error ? cause.message : "Something went wrong";
    if (message.toLowerCase().includes("unauthorized")) onUnauthorized();
    setError(message);
  };
  useEffect(() => {
    let active = true;
    void api<Overview>("/api/mcp")
      .then((data) => {
        if (active) setEntries(data.servers);
      })
      .catch((cause) => {
        if (active) handleError(cause);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onUnauthorized]);
  const startEdit = (entry?: Entry) => {
    const server = entry?.server;
    setEditing(entry?.name ?? "");
    setName(entry?.name ?? "");
    setTransport(server?.type ?? "http");
    setEndpoint(server ? (server.type === "http" ? server.url : server.command) : "");
    setArgs(server?.type === "stdio" ? server.args.join("\n") : "");
    setCwd(server?.type === "stdio" ? (server.cwd ?? "") : "");
    const refs = server ? (server.type === "http" ? server.headers : server.env) : undefined;
    setReferences(refs ? JSON.stringify(refs, null, 2) : "");
    setRules(server?.toolExposure ? JSON.stringify(server.toolExposure, null, 2) : "");
    setTimeoutValue(String(server?.timeout ?? 30));
    setExposure(server?.exposure ?? "deferred");
    setEnabled(server?.enabled ?? true);
    setAdvanced(false);
    setError("");
    setNotice("");
  };
  const saveEntry = async (entryName: string, server: McpServer) => {
    const data = await api<Overview>("/api/mcp", {
      method: "PUT",
      body: JSON.stringify({ name: entryName, server }),
    });
    setEntries(data.servers);
    setChecks((previous) => {
      const next = { ...previous };
      delete next[entryName];
      return next;
    });
    setNotice("Saved. Running conversations pick this up on their next turn.");
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      if (!editing && entries.some((e) => e.name === name))
        throw new Error("That name already exists. Edit the existing server instead.");
      const refs = references.trim() ? JSON.parse(references) : undefined;
      const toolExposure = rules.trim() ? JSON.parse(rules) : undefined;
      const input = mcpSaveSchema.parse({
        name,
        server: {
          type: transport,
          enabled,
          exposure,
          timeout: Number(timeout),
          ...(toolExposure ? { toolExposure } : {}),
          ...(transport === "http"
            ? { url: endpoint, ...(refs ? { headers: refs } : {}) }
            : {
                command: endpoint,
                args: args ? args.split("\n") : [],
                ...(cwd ? { cwd } : {}),
                ...(refs ? { env: refs } : {}),
              }),
        },
      });
      await saveEntry(input.name, input.server);
      setEditing(null);
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (entry: Entry) => {
    setBusy(true);
    setError("");
    try {
      await saveEntry(entry.name, { ...entry.server, enabled: !entry.server.enabled });
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (entryName: string) => {
    setBusy(true);
    setError("");
    try {
      const data = await api<Overview>(`/api/mcp/${encodeURIComponent(entryName)}`, {
        method: "DELETE",
      });
      setEntries(data.servers);
      setConfirmDelete(null);
      if (editing === entryName) setEditing(null);
      setNotice("Removed. Active tool calls finish; the server is removed on the next turn.");
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  };
  const test = async (entryName: string) => {
    setChecks((previous) => ({ ...previous, [entryName]: { checking: true } }));
    try {
      const result = await api<{ tools: Tool[] }>(
        `/api/mcp/${encodeURIComponent(entryName)}/test`,
        { method: "POST", body: "{}" },
      );
      setChecks((previous) => ({ ...previous, [entryName]: result }));
      setOpenTools(entryName);
    } catch (cause) {
      setChecks((previous) => ({
        ...previous,
        [entryName]: { error: cause instanceof Error ? cause.message : "Connection check failed" },
      }));
    }
  };
  const button = (label: string, action: () => void, primary = false, disabled = busy) => (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={action}
      style={[styles.button, primary && styles.primary, disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, primary && styles.primaryText]}>{label}</Text>
    </Pressable>
  );
  const input = (
    label: string,
    value: string,
    change: (text: string) => void,
    placeholder: string,
    multiline = false,
  ) => (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={change}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        multiline={multiline}
        editable={!busy && !(label === "Server name" && !!editing)}
        style={[styles.input, multiline && styles.multiline]}
      />
    </View>
  );
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.heading}>
        <View style={styles.headingCopy}>
          <Text style={styles.title}>MCP servers</Text>
          <Text style={styles.sub}>Connect external tools. Keep the conversation lean.</Text>
        </View>
        {editing === null && button("Add server", () => startEdit(), true)}
      </View>
      <View style={styles.info}>
        <Ionicons name="search-outline" size={20} color={theme.colors.accent} />
        <View style={styles.flex}>
          <Text style={styles.infoTitle}>Discovered, not dumped</Text>
          <Text style={styles.body}>
            On-demand discovery is the default. Server changes apply between turns without clearing
            conversation history. Previous tool results stay in that history.
          </Text>
        </View>
      </View>
      {!!notice && (
        <Text accessibilityRole="alert" style={styles.success}>
          {notice}
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {loading && <ActivityIndicator color={theme.colors.accent} />}
      {!loading && entries.length === 0 && editing === null && (
        <View style={styles.empty}>
          <Ionicons name="extension-puzzle-outline" size={36} color={theme.colors.textMuted} />
          <Text style={styles.emptyTitle}>No servers connected</Text>
          <Text style={styles.sub}>
            Add a Streamable HTTP endpoint or a local stdio command. Existing MCP skills keep
            working independently.
          </Text>
          {button("Add your first server", () => startEdit(), true)}
        </View>
      )}
      {editing !== null && (
        <View style={styles.editor}>
          <View style={styles.row}>
            <Text style={styles.sectionTitle}>{editing ? `Edit ${editing}` : "New server"}</Text>
            {button("Cancel", () => setEditing(null))}
          </View>
          <Text style={styles.body}>
            Only connect servers you trust. They can receive tool arguments and return content to
            the agent.
          </Text>
          {input(
            "Server name",
            name,
            (text) => {
              if (!editing) setName(text);
            },
            "e.g. documentation",
          )}
          <View style={styles.actions}>
            {button(
              "HTTP endpoint",
              () => {
                if (transport !== "http") {
                  setTransport("http");
                  setEndpoint("");
                  setReferences("");
                }
              },
              transport === "http",
            )}
            {button(
              "Local command",
              () => {
                if (transport !== "stdio") {
                  setTransport("stdio");
                  setEndpoint("");
                  setReferences("");
                }
              },
              transport === "stdio",
            )}
          </View>
          {input(
            transport === "http" ? "Server URL" : "Executable",
            endpoint,
            setEndpoint,
            transport === "http" ? "https://example.com/mcp" : "npx",
          )}
          {transport === "stdio" && (
            <>
              <Text style={styles.warning}>
                Local commands run on Vito's machine with its operating-system permissions. They are
                not sandboxed.
              </Text>
              {input("Arguments — one per line", args, setArgs, "-y\n@vendor/mcp-server", true)}
              {input(
                "Working directory (optional)",
                cwd,
                setCwd,
                "Defaults to Vito's working directory",
              )}
            </>
          )}
          <Text style={styles.label}>Tool visibility</Text>
          <View style={styles.choices}>
            {exposures.map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: exposure === option.value }}
                disabled={busy}
                onPress={() => setExposure(option.value)}
                style={[styles.choice, exposure === option.value && styles.selected]}
              >
                <View style={styles.row}>
                  <Text style={styles.choiceTitle}>{option.title}</Text>
                  {exposure === option.value && (
                    <Ionicons name="checkmark-circle" size={18} color={theme.colors.accent} />
                  )}
                </View>
                <Text style={styles.small}>{option.detail}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.field}>
            {input(
              transport === "http"
                ? "Header secret references (optional JSON)"
                : "Environment secret references (optional JSON)",
              references,
              setReferences,
              transport === "http"
                ? '{"Authorization": "Bearer ${MY_TOKEN}"}'
                : '{"API_KEY": "${MY_TOKEN}"}',
              true,
            )}
            <Text style={styles.small}>
              Store actual values in Secrets. Only references are accepted here. OAuth sign-in is
              not available in this first version.
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Enabled</Text>
            <Switch
              accessibilityLabel="Server enabled"
              value={enabled}
              onValueChange={setEnabled}
              disabled={busy}
              trackColor={{ true: theme.colors.accent }}
            />
          </View>
          <Pressable accessibilityRole="button" onPress={() => setAdvanced(!advanced)}>
            <Text style={styles.link}>
              {advanced ? "Hide advanced settings" : "Advanced settings"}
            </Text>
          </Pressable>
          {advanced && (
            <>
              {input("Request timeout (seconds)", timeout, setTimeoutValue, "30")}
              {input(
                "Per-tool visibility rules (optional JSON)",
                rules,
                setRules,
                '{"delete_*": "hidden", "search": "deferred"}',
                true,
              )}
              <Text style={styles.small}>
                Exact names or * patterns. Hidden is not a security sandbox: existing skills or
                shell commands remain independent.
              </Text>
            </>
          )}
          <View style={styles.actions}>
            {button(busy ? "Saving…" : "Save server", () => void save(), true)}
            {button("Cancel", () => setEditing(null))}
          </View>
        </View>
      )}
      {entries.map((entry) => {
        const check = checks[entry.name];
        return (
          <View key={entry.name} style={styles.card}>
            <View style={styles.row}>
              <View style={styles.flex}>
                <Text style={styles.serverName}>{entry.name}</Text>
                <Text numberOfLines={2} style={styles.endpoint}>
                  {entry.server.type === "http"
                    ? entry.server.url
                    : [entry.server.command, ...entry.server.args].join(" ")}
                </Text>
              </View>
              <Switch
                accessibilityLabel={`Enable ${entry.name}`}
                value={entry.server.enabled}
                disabled={busy}
                onValueChange={() => void toggle(entry)}
                trackColor={{ true: theme.colors.accent }}
              />
            </View>
            <View style={styles.meta}>
              <Text style={styles.metaText}>
                {entry.server.type === "http" ? "Streamable HTTP" : "Local stdio"} ·{" "}
                {exposures.find((e) => e.value === entry.server.exposure)?.title} ·{" "}
                {entry.server.enabled ? "Enabled" : "Disabled"}
              </Text>
            </View>
            {!!entry.missingSecrets.length && (
              <Text style={styles.warning}>
                Missing secrets: {entry.missingSecrets.join(", ")}. Add them in Secrets before
                connecting.
              </Text>
            )}
            <View style={styles.actions}>
              {button("Edit", () => startEdit(entry))}
              {button(
                check?.checking ? "Checking…" : "Check connection",
                () => void test(entry.name),
                false,
                busy || !!check?.checking,
              )}
              {button("Remove", () => setConfirmDelete(entry.name))}
            </View>
            {confirmDelete === entry.name && (
              <View style={styles.confirm}>
                <Text style={styles.body}>
                  Remove {entry.name}? Stored credentials will not be deleted.
                </Text>
                <View style={styles.actions}>
                  {button("Keep server", () => setConfirmDelete(null))}
                  {button("Confirm removal", () => void remove(entry.name))}
                </View>
              </View>
            )}
            {check?.error && <Text style={styles.error}>{check.error}</Text>}
            {check?.tools && (
              <View style={styles.toolSection}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setOpenTools(openTools === entry.name ? null : entry.name)}
                >
                  <Text style={styles.success}>
                    Connection verified · {check.tools.length} tools{" "}
                    {openTools === entry.name ? "▾" : "▸"}
                  </Text>
                </Pressable>
                <Text style={styles.small}>
                  Separate discovery check. It does not call tools or confirm a chat session's
                  connection.
                </Text>
                {openTools === entry.name &&
                  check.tools.map((tool) => (
                    <View key={tool.name} style={styles.tool}>
                      <Text style={styles.toolName}>{tool.name}</Text>
                      {!!tool.description && (
                        <Text numberOfLines={3} style={styles.small}>
                          {tool.description}
                        </Text>
                      )}
                    </View>
                  ))}
              </View>
            )}
          </View>
        );
      })}
      <Text style={styles.footer}>
        Checks only initialize the server and list its tools. Saving does not send a chat message or
        restart Vito. Existing conversations reconnect on their next turn.
      </Text>
    </ScrollView>
  );
}

function createStyles(theme: VitoTheme) {
  const c = theme.colors;
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.canvas },
    content: {
      padding: theme.space.xxl,
      gap: theme.space.lg,
      width: "100%",
      maxWidth: 1000,
      alignSelf: "center",
      paddingBottom: theme.space.massive,
    },
    heading: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: theme.space.lg,
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: theme.space.xs,
    },
    headingCopy: { flexGrow: 1, flexBasis: 220, gap: theme.space.xs },
    title: { color: c.text, fontSize: 26, fontWeight: "700" },
    sub: { color: c.textSecondary, fontSize: 14, lineHeight: 21 },
    info: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: theme.space.md,
      padding: theme.space.lg,
      borderRadius: 12,
      backgroundColor: c.accentSurface,
    },
    infoTitle: { color: c.text, fontSize: 14, fontWeight: "600", marginBottom: theme.space.xs },
    flex: { flex: 1, minWidth: 0 },
    body: { color: c.textSecondary, fontSize: 14, lineHeight: 21 },
    empty: {
      paddingVertical: theme.space.huge,
      paddingHorizontal: theme.space.xl,
      alignItems: "center",
      gap: theme.space.lg,
      borderWidth: 1,
      borderColor: c.separator,
      borderRadius: 12,
      backgroundColor: c.surface,
    },
    emptyTitle: { color: c.text, fontSize: 18, fontWeight: "600" },
    card: {
      padding: theme.space.xl,
      gap: theme.space.md,
      borderRadius: 12,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.separator,
    },
    row: {
      flexDirection: "row",
      gap: theme.space.md,
      alignItems: "center",
      justifyContent: "space-between",
    },
    serverName: { color: c.text, fontSize: 17, fontWeight: "600" },
    endpoint: { color: c.textSecondary, fontSize: 13, marginTop: theme.space.xs, lineHeight: 19 },
    meta: { flexDirection: "row" },
    metaText: { color: c.textMuted, fontSize: 12 },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
    button: {
      minHeight: 44,
      paddingHorizontal: theme.space.lg,
      paddingVertical: theme.space.md,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.separatorStrong,
      justifyContent: "center",
      alignItems: "center",
    },
    primary: { backgroundColor: c.accent, borderColor: c.accent },
    buttonText: { color: c.text, fontSize: 14, fontWeight: "600" },
    primaryText: { color: c.accentText },
    disabled: { opacity: 0.5 },
    editor: {
      padding: theme.space.xl,
      gap: theme.space.xl,
      borderRadius: 12,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.separatorStrong,
    },
    sectionTitle: { color: c.text, fontSize: 19, fontWeight: "600", flex: 1 },
    field: { gap: theme.space.sm },
    label: { color: c.text, fontSize: 13, fontWeight: "600" },
    input: {
      color: c.text,
      borderWidth: 1,
      borderColor: c.separatorStrong,
      backgroundColor: c.canvas,
      borderRadius: 8,
      padding: theme.space.md,
      fontSize: 14,
      minHeight: 46,
    },
    multiline: { minHeight: 90, textAlignVertical: "top", lineHeight: 21 },
    choices: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.md },
    choice: {
      flexGrow: 1,
      flexBasis: 180,
      padding: theme.space.md,
      gap: theme.space.sm,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.separatorStrong,
    },
    selected: { borderColor: c.accent, backgroundColor: c.accentSurface },
    choiceTitle: { color: c.text, fontSize: 14, fontWeight: "600" },
    small: { color: c.textSecondary, fontSize: 12, lineHeight: 18 },
    warning: { color: c.warning, fontSize: 13, lineHeight: 20 },
    error: { color: c.danger, fontSize: 13, lineHeight: 20 },
    success: { color: c.success, fontSize: 13, lineHeight: 20 },
    link: { color: c.accent, fontSize: 14, fontWeight: "600", paddingVertical: theme.space.sm },
    confirm: {
      gap: theme.space.md,
      borderTopWidth: 1,
      borderTopColor: c.separator,
      paddingTop: theme.space.md,
    },
    toolSection: {
      gap: theme.space.sm,
      borderTopWidth: 1,
      borderTopColor: c.separator,
      paddingTop: theme.space.md,
    },
    tool: { paddingTop: theme.space.sm, gap: theme.space.xs },
    toolName: { color: c.text, fontSize: 13, fontWeight: "600" },
    footer: { color: c.textMuted, fontSize: 12, lineHeight: 19 },
  });
}
