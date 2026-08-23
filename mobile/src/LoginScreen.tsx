import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { login } from "./api";

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(password);
      onSuccess();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

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
          <View style={styles.mark}>
            <Text style={styles.markText}>V</Text>
          </View>
          <Text style={styles.eyebrow}>PRIVATE ACCESS</Text>
          <Text style={styles.title}>Welcome back,{"\n"}boss.</Text>
          <Text style={styles.body}>Use your existing Vito dashboard password.</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            returnKeyType="go"
            placeholder="Dashboard password"
            placeholderTextColor="#596159"
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={() => void submit()}
            style={styles.input}
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable
            disabled={!password || busy}
            onPress={() => void submit()}
            style={({ pressed }) => [
              styles.button,
              (!password || busy) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#11150d" />
            ) : (
              <Text style={styles.buttonText}>Sign in</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardView: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: "center" },
  page: {
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
    padding: 26,
  },
  mark: {
    width: 48,
    height: 48,
    borderRadius: 15,
    backgroundColor: "#b7f34a",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 30,
  },
  markText: { color: "#11150d", fontSize: 24, fontWeight: "900" },
  eyebrow: { color: "#a9e83a", fontSize: 10, fontWeight: "800", letterSpacing: 2 },
  title: {
    color: "#f1f3f0",
    fontSize: 42,
    lineHeight: 47,
    fontWeight: "800",
    letterSpacing: -1.6,
    marginTop: 13,
  },
  body: { color: "#848c84", fontSize: 15, marginTop: 16, marginBottom: 30 },
  input: {
    minHeight: 54,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "#303630",
    backgroundColor: "#121512",
    color: "#eef1ed",
    paddingHorizontal: 16,
    fontSize: 16,
  },
  error: { color: "#ef827b", fontSize: 13, marginTop: 12 },
  button: {
    minHeight: 52,
    borderRadius: 13,
    backgroundColor: "#b7f34a",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 15,
  },
  buttonText: { color: "#11150d", fontSize: 15, fontWeight: "800" },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
});
