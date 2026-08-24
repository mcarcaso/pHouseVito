export type OperationArea =
  | "memory"
  | "profile"
  | "skills"
  | "jobs"
  | "apps"
  | "drive"
  | "traces"
  | "pi"
  | "settings"
  | "theme"
  | "secrets"
  | "system"
  | "server"
  | "providers";

export const operationAreas: Array<{ id: OperationArea; label: string; icon: string }> = [
  { id: "memory", label: "Memory", icon: "🧠" },
  { id: "profile", label: "Profile", icon: "◯" },
  { id: "skills", label: "Skills", icon: "🛠️" },
  { id: "jobs", label: "Jobs", icon: "⏰" },
  { id: "apps", label: "Apps", icon: "🚀" },
  { id: "drive", label: "Drive", icon: "📁" },
  { id: "traces", label: "Traces", icon: "🔍" },
  { id: "pi", label: "Pi sessions", icon: "🧵" },
  { id: "settings", label: "Settings", icon: "⚙️" },
  { id: "theme", label: "Theme", icon: "🎨" },
  { id: "secrets", label: "Secrets", icon: "🔑" },
  { id: "system", label: "System", icon: "📄" },
  { id: "server", label: "Server", icon: "🖥️" },
  { id: "providers", label: "Providers", icon: "🤖" },
];
