import { Ionicons } from "@expo/vector-icons";
import {
  HeaderToolbarButton as HeaderButton,
  HeaderToolbarButtonGroup,
} from "../../components/navigation/HeaderToolbarButton";
import { useNavigation } from "@react-navigation/native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api, VITO_URL } from "../../services/api/client";
import { useThemeStyles, useVitoTheme, type VitoTheme } from "../../hooks/useVitoTheme";

type DriveDirectory = { name: string; hasMeta: boolean; meta: { isPublic?: boolean } | null };
type DriveFile = { name: string; size: number; isPublic: boolean; createdAt?: string };
type DriveListing = { path: string; isPublic: boolean; dirs: DriveDirectory[]; files: DriveFile[] };

export function DriveScreen({
  path = "",
  onOpenDirectory,
  onUnauthorized,
}: {
  path?: string;
  onOpenDirectory: (path: string) => void;
  onUnauthorized: () => void;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const navigation = useNavigation();
  const [listing, setListing] = useState<DriveListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [folderModal, setFolderModal] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [actionItem, setActionItem] = useState<{
    name: string;
    isDirectory: boolean;
    isPublic: boolean;
    confirmDelete?: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setListing(await api<DriveListing>(`/api/drive/ls?path=${encodeURIComponent(path)}`));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not load Drive";
      if (message.toLowerCase().includes("unauthorized")) onUnauthorized();
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [onUnauthorized, path]);

  useEffect(() => void load(), [load]);

  const mutate = async (endpoint: string, options: { method: string; body?: string }) => {
    try {
      await api(endpoint, options);
      await load();
    } catch (cause) {
      Alert.alert("Drive", cause instanceof Error ? cause.message : "Action failed");
    }
  };

  const upload = useCallback(async () => {
    const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (picked.canceled) return;
    const asset = picked.assets[0];
    let base64: string;
    if (asset.file) {
      base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(new Error("Could not read file"));
        reader.readAsDataURL(asset.file as Blob);
      });
    } else {
      base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
    }
    await mutate("/api/drive/upload", {
      method: "POST",
      body: JSON.stringify({
        data: `data:${asset.mimeType ?? "application/octet-stream"};base64,${base64}`,
        filename: asset.name,
        folder: path || undefined,
      }),
    });
  }, [path, load]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: path.split("/").filter(Boolean).at(-1) ?? "Drive",
      headerRight: ({ tintColor }: { tintColor?: string }) => (
        <HeaderToolbarButtonGroup>
          <HeaderButton
            accessibilityLabel="New folder"
            onPress={() => setFolderModal(true)}
            tintColor={tintColor}
          >
            <Ionicons
              name="folder-open-outline"
              size={21}
              color={tintColor ?? theme.colors.accent}
            />
          </HeaderButton>
          <HeaderButton
            accessibilityLabel="Upload file"
            onPress={() => void upload()}
            tintColor={tintColor}
          >
            <Ionicons name="add" size={24} color={tintColor ?? theme.colors.accent} />
          </HeaderButton>
        </HeaderToolbarButtonGroup>
      ),
    });
  }, [navigation, path, theme.colors.accent, upload]);

  const createFolder = async () => {
    const name = folderName.trim();
    if (!name) return;
    const folderPath = [path, name].filter(Boolean).join("/");
    await mutate(`/api/drive/meta?path=${encodeURIComponent(folderPath)}`, {
      method: "PUT",
      body: JSON.stringify({ isPublic: false }),
    });
    setFolderName("");
    setFolderModal(false);
  };

  const toggleDirectoryPublic = () =>
    listing &&
    void mutate(`/api/drive/meta?path=${encodeURIComponent(path)}`, {
      method: "PUT",
      body: JSON.stringify({ isPublic: !listing.isPublic }),
    });

  const itemActions = (name: string, isDirectory: boolean, isPublic: boolean) =>
    setActionItem({ name, isDirectory, isPublic });

  const actionPath = actionItem ? [path, actionItem.name].filter(Boolean).join("/") : "";
  const toggleItemVisibility = async () => {
    if (!actionItem) return;
    await mutate(
      `/api/drive/${actionItem.isDirectory ? "meta" : "file-meta"}?path=${encodeURIComponent(actionPath)}`,
      { method: "PUT", body: JSON.stringify({ isPublic: !actionItem.isPublic }) },
    );
    setActionItem(null);
  };
  const deleteItem = async () => {
    if (!actionItem) return;
    await mutate(`/api/drive?path=${encodeURIComponent(actionPath)}`, { method: "DELETE" });
    setActionItem(null);
  };

  return (
    <View style={styles.root}>
      <View style={styles.locationBar}>
        <View style={styles.locationCopy}>
          <Text style={styles.path} numberOfLines={1}>
            drive{path ? ` / ${path.split("/").join(" / ")}` : ""}
          </Text>
          <Text style={[styles.visibility, listing?.isPublic && styles.publicText]}>
            {listing?.isPublic ? "Public" : "Private"}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Change directory visibility"
          onPress={toggleDirectoryPublic}
          style={styles.visibilityButton}
        >
          <Ionicons
            name={listing?.isPublic ? "globe-outline" : "lock-closed-outline"}
            size={18}
            color={listing?.isPublic ? theme.colors.success : theme.colors.textMuted}
          />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={styles.loading} color={theme.colors.accent} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {listing?.dirs.map((directory) => {
            const childPath = [path, directory.name].filter(Boolean).join("/");
            const isPublic = directory.meta?.isPublic === true;
            return (
              <Pressable
                key={directory.name}
                onPress={() => onOpenDirectory(childPath)}
                onLongPress={() => itemActions(directory.name, true, isPublic)}
                style={styles.row}
              >
                <View style={styles.icon}>
                  <Ionicons name="folder" size={22} color={theme.colors.accent} />
                </View>
                <View style={styles.rowCopy}>
                  <Text style={styles.name}>{directory.name}</Text>
                  <Text style={styles.meta}>{isPublic ? "Public folder" : "Folder"}</Text>
                </View>
                <Pressable
                  accessibilityLabel={`Actions for ${directory.name}`}
                  onPress={(event) => {
                    event.stopPropagation();
                    itemActions(directory.name, true, isPublic);
                  }}
                  style={styles.rowAction}
                >
                  <Ionicons name="ellipsis-horizontal" size={20} color={theme.colors.textMuted} />
                </Pressable>
              </Pressable>
            );
          })}
          {listing?.files.map((file) => {
            const filePath = [path, file.name].filter(Boolean).join("/");
            return (
              <Pressable
                key={file.name}
                onPress={() =>
                  void Linking.openURL(
                    `${VITO_URL}/d/${filePath.split("/").map(encodeURIComponent).join("/")}`,
                  )
                }
                onLongPress={() => itemActions(file.name, false, file.isPublic)}
                style={styles.row}
              >
                <View style={styles.icon}>
                  <Ionicons
                    name={fileIcon(file.name)}
                    size={21}
                    color={theme.colors.textSecondary}
                  />
                </View>
                <View style={styles.rowCopy}>
                  <Text style={styles.name} numberOfLines={1}>
                    {file.name}
                  </Text>
                  <Text style={styles.meta}>
                    {formatBytes(file.size)}
                    {file.createdAt ? ` · ${new Date(file.createdAt).toLocaleDateString()}` : ""}
                  </Text>
                </View>
                {file.isPublic && (
                  <Ionicons name="globe-outline" size={16} color={theme.colors.success} />
                )}
                <Pressable
                  accessibilityLabel={`Actions for ${file.name}`}
                  onPress={(event) => {
                    event.stopPropagation();
                    itemActions(file.name, false, file.isPublic);
                  }}
                  style={styles.rowAction}
                >
                  <Ionicons name="ellipsis-horizontal" size={20} color={theme.colors.textMuted} />
                </Pressable>
                <Ionicons name="open-outline" size={17} color={theme.colors.textMuted} />
              </Pressable>
            );
          })}
          {!listing?.dirs.length && !listing?.files.length && (
            <View style={styles.empty}>
              <Ionicons name="folder-open-outline" size={34} color={theme.colors.textMuted} />
              <Text style={styles.emptyText}>This folder is empty</Text>
            </View>
          )}
          <Text style={styles.hint}>Use the action button for visibility and delete controls.</Text>
        </ScrollView>
      )}

      <Modal
        visible={folderModal}
        transparent
        animationType="fade"
        onRequestClose={() => setFolderModal(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setFolderModal(false)}>
          <Pressable style={styles.modalCard} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.modalTitle}>New folder</Text>
            <TextInput
              autoFocus
              value={folderName}
              onChangeText={setFolderName}
              onSubmitEditing={() => void createFolder()}
              placeholder="Folder name"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.input}
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setFolderModal(false)}>
                <Text style={styles.cancel}>Cancel</Text>
              </Pressable>
              <Pressable disabled={!folderName.trim()} onPress={() => void createFolder()}>
                <Text style={styles.create}>Create</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={actionItem !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setActionItem(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setActionItem(null)}>
          <Pressable style={styles.modalCard} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.modalTitle}>{actionItem?.name}</Text>
            {actionItem?.confirmDelete ? (
              <>
                <Text style={styles.modalMessage}>This cannot be undone.</Text>
                <View style={styles.actionList}>
                  <Pressable
                    onPress={() =>
                      setActionItem((item) => (item ? { ...item, confirmDelete: false } : null))
                    }
                    style={styles.actionButton}
                  >
                    <Text style={styles.cancel}>Cancel</Text>
                  </Pressable>
                  <Pressable onPress={() => void deleteItem()} style={styles.actionButton}>
                    <Text style={styles.deleteText}>Delete</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <View style={styles.actionList}>
                <Pressable onPress={() => void toggleItemVisibility()} style={styles.actionButton}>
                  <Ionicons
                    name={actionItem?.isPublic ? "lock-closed-outline" : "globe-outline"}
                    size={20}
                    color={theme.colors.accent}
                  />
                  <Text style={styles.actionText}>
                    {actionItem?.isPublic ? "Make private" : "Make public"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    setActionItem((item) => (item ? { ...item, confirmDelete: true } : null))
                  }
                  style={styles.actionButton}
                >
                  <Ionicons name="trash-outline" size={20} color={theme.colors.danger} />
                  <Text style={styles.deleteText}>Delete</Text>
                </Pressable>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function fileIcon(name: string): React.ComponentProps<typeof Ionicons>["name"] {
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(name)) return "image-outline";
  if (/\.(mp3|wav|m4a|ogg)$/i.test(name)) return "musical-note-outline";
  if (/\.(mp4|mov|webm)$/i.test(name)) return "videocam-outline";
  if (/\.(zip|tar|gz)$/i.test(name)) return "archive-outline";
  return "document-text-outline";
}
const formatBytes = (size: number) =>
  size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${(size / 1024).toFixed(1)} KB`
      : `${(size / 1024 / 1024).toFixed(1)} MB`;

const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.canvas },
    locationBar: {
      minHeight: 46,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: theme.space.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.separator,
    },
    locationCopy: { flex: 1, minWidth: 0 },
    path: { color: theme.colors.text, fontSize: 13, fontWeight: "700" },
    visibility: { color: theme.colors.textMuted, fontSize: 10, marginTop: theme.space.xxs },
    publicText: { color: theme.colors.success },
    visibilityButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
    loading: { marginTop: theme.space.xxxl },
    error: { color: theme.colors.danger, padding: theme.space.xl },
    list: { paddingBottom: theme.space.xxxl },
    row: {
      minHeight: 64,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      paddingHorizontal: theme.space.lg,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.separator,
    },
    icon: { width: 30, alignItems: "center" },
    rowAction: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
    rowCopy: { flex: 1, minWidth: 0 },
    name: { color: theme.colors.text, fontSize: 14, fontWeight: "700" },
    meta: { color: theme.colors.textMuted, fontSize: 11, marginTop: theme.space.xs },
    empty: { alignItems: "center", gap: theme.space.md, paddingVertical: theme.space.giant },
    emptyText: { color: theme.colors.textMuted, fontSize: 13 },
    hint: {
      color: theme.colors.textMuted,
      fontSize: 10,
      textAlign: "center",
      padding: theme.space.xl,
    },
    modalBackdrop: {
      flex: 1,
      justifyContent: "center",
      padding: theme.space.xl,
      backgroundColor: "rgba(0,0,0,0.45)",
    },
    modalCard: {
      borderRadius: theme.radius.lg,
      padding: theme.space.xl,
      backgroundColor: theme.colors.surfaceRaised,
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
    },
    modalTitle: {
      color: theme.colors.text,
      fontSize: 17,
      fontWeight: "800",
      marginBottom: theme.space.lg,
    },
    modalMessage: { color: theme.colors.textSecondary, fontSize: 13, marginBottom: theme.space.md },
    actionList: { gap: theme.space.sm },
    actionButton: {
      minHeight: 46,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      paddingHorizontal: theme.space.sm,
    },
    actionText: { color: theme.colors.text, fontSize: 14, fontWeight: "700" },
    deleteText: { color: theme.colors.danger, fontSize: 14, fontWeight: "700" },
    input: {
      minHeight: 46,
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.space.md,
      color: theme.colors.text,
      backgroundColor: theme.colors.surface,
    },
    modalActions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: theme.space.xl,
      marginTop: theme.space.xl,
    },
    cancel: { color: theme.colors.textSecondary, fontWeight: "700" },
    create: { color: theme.colors.accent, fontWeight: "800" },
  });
