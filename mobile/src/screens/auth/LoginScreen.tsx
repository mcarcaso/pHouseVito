import * as Clipboard from "expo-clipboard";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  checkAuth,
  getRecentAgents,
  login,
  setAgentUrl,
  setupDashboard,
  VITO_URL,
} from "../../services/api/client";
import { useThemeStyles, useVitoTheme, type VitoTheme } from "../../hooks/useVitoTheme";

export function LoginScreen({
  mode,
  onSuccess,
  onPasswordAlreadySet,
}: {
  mode: "login" | "setup";
  onSuccess: () => void;
  onPasswordAlreadySet: () => void;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const [url, setUrl] = useState(VITO_URL);
  const [recent, setRecent] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getRecentAgents().then(setRecent);
  }, []);

  const connectToAgent = async () => {
    await setAgentUrl(url);
  };

  const submitLogin = async () => {
    if (!password || !url.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      await connectToAgent();
      await login(password);
      onSuccess();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Login failed");
    } finally {
      setPending(false);
    }
  };

  const generatePassword = async () => {
    if (!url.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      await connectToAgent();
      setGeneratedPassword(await setupDashboard());
    } catch (cause) {
      const status = await checkAuth().catch(() => null);
      if (status?.passwordSet) {
        onPasswordAlreadySet();
        return;
      }
      setError(cause instanceof Error ? cause.message : "Setup failed");
    } finally {
      setPending(false);
    }
  };

  const copyPassword = async () => {
    await Clipboard.setStringAsync(generatedPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 1_600);
  };

  const agentUrlField = (
    <>
      <Text style={styles.fieldLabel}>AGENT URL</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        textContentType="URL"
        autoComplete="url"
        returnKeyType="next"
        placeholder="https://your-agent.example.com"
        placeholderTextColor={theme.colors.textMuted}
        value={url}
        onChangeText={setUrl}
        style={styles.input}
      />
      {recent.length > 1 && (
        <View style={styles.recent}>
          {recent.map((agent) => (
            <Pressable key={agent} onPress={() => setUrl(agent)}>
              <Text numberOfLines={1} style={styles.recentItem}>
                {agent}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </>
  );

  return (
    <KeyboardAvoidingView
      style={styles.keyboardView}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.page}>
          <Image source={require("../../../assets/icon.png")} style={styles.mark} />
          {mode === "setup" ? (
            generatedPassword ? (
              <>
                <Text style={styles.eyebrow}>SETUP COMPLETE</Text>
                <Text style={styles.title}>Save your password.</Text>
                <Text style={styles.body}>
                  This password is shown once. Keep it somewhere safe before continuing.
                </Text>
                <Text selectable style={styles.generatedPassword}>
                  {generatedPassword}
                </Text>
                <Pressable onPress={() => void copyPassword()} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>
                    {copied ? "Copied" : "Copy Password"}
                  </Text>
                </Pressable>
                <Pressable onPress={onSuccess} style={styles.button}>
                  <Text style={styles.buttonText}>Continue to Vito</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.eyebrow}>FIRST-TIME SETUP</Text>
                <Text style={styles.title}>Secure your agent.</Text>
                <Text style={styles.body}>
                  Generate a strong password to protect Vito and every private agent API.
                </Text>
                {agentUrlField}
                {error && <Text style={styles.error}>{error}</Text>}
                <Pressable
                  disabled={!url.trim() || pending}
                  onPress={() => void generatePassword()}
                  style={({ pressed }) => [
                    styles.button,
                    (!url.trim() || pending) && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  {pending ? (
                    <ActivityIndicator color={theme.colors.accentText} />
                  ) : (
                    <Text style={styles.buttonText}>Generate Password</Text>
                  )}
                </Pressable>
              </>
            )
          ) : (
            <>
              <Text style={styles.eyebrow}>PRIVATE ACCESS</Text>
              <Text style={styles.title}>Welcome back,{"\n"}boss.</Text>
              <Text style={styles.body}>
                Connect to your agent using its URL and dashboard password.
              </Text>
              {agentUrlField}
              <Text style={styles.fieldLabel}>PASSWORD</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                textContentType="password"
                autoComplete="current-password"
                returnKeyType="go"
                placeholder="Dashboard password"
                placeholderTextColor={theme.colors.textMuted}
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={() => void submitLogin()}
                style={styles.input}
              />
              {error && <Text style={styles.error}>{error}</Text>}
              <Pressable
                disabled={!password || !url.trim() || pending}
                onPress={() => void submitLogin()}
                style={({ pressed }) => [
                  styles.button,
                  (!password || !url.trim() || pending) && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                {pending ? (
                  <ActivityIndicator color={theme.colors.accentText} />
                ) : (
                  <Text style={styles.buttonText}>Sign in</Text>
                )}
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    keyboardView: { flex: 1 },
    scrollContent: { flexGrow: 1, justifyContent: "center" },
    page: {
      width: "100%",
      maxWidth: 460,
      alignSelf: "center",
      padding: theme.space.xxl,
    },
    mark: {
      width: 48,
      height: 48,
      borderRadius: 15,
      marginBottom: theme.space.xxxl,
    },
    eyebrow: { color: theme.colors.accent, fontSize: 10, fontWeight: "800", letterSpacing: 2 },
    title: {
      color: theme.colors.text,
      fontSize: 42,
      lineHeight: 47,
      fontWeight: "800",
      letterSpacing: -1.6,
      marginTop: theme.space.md,
    },
    body: {
      color: theme.colors.textMuted,
      fontSize: 15,
      lineHeight: 22,
      marginTop: theme.space.lg,
      marginBottom: theme.space.xxxl,
    },
    fieldLabel: {
      color: theme.colors.textMuted,
      fontSize: 9,
      fontWeight: "800",
      letterSpacing: 1.2,
      marginBottom: theme.space.sm,
      marginTop: theme.space.md,
    },
    recent: { gap: theme.space.xs, marginTop: theme.space.sm },
    recentItem: { color: theme.colors.accent, fontSize: 11 },
    input: {
      minHeight: 54,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
      backgroundColor: theme.colors.surface,
      color: theme.colors.text,
      paddingHorizontal: theme.space.lg,
      fontSize: 16,
    },
    generatedPassword: {
      color: theme.colors.success,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
      borderRadius: 13,
      padding: theme.space.lg,
      fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
      fontSize: 14,
      lineHeight: 21,
    },
    error: { color: theme.colors.danger, fontSize: 13, marginTop: theme.space.md },
    button: {
      minHeight: 52,
      borderRadius: 13,
      backgroundColor: theme.colors.accent,
      alignItems: "center",
      justifyContent: "center",
      marginTop: theme.space.lg,
    },
    buttonText: { color: theme.colors.accentText, fontSize: 15, fontWeight: "800" },
    secondaryButton: {
      minHeight: 48,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
      alignItems: "center",
      justifyContent: "center",
      marginTop: theme.space.md,
    },
    secondaryButtonText: { color: theme.colors.textSecondary, fontSize: 14, fontWeight: "800" },
    disabled: { opacity: 0.45 },
    pressed: { opacity: 0.7 },
  });
