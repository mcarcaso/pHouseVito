import { useState, FormEvent } from "react";
import { useLogin, useSetup } from "../hooks/useAuth";
import { errorMessage } from "../lib/api-client";

interface LoginProps {
  mode: "login" | "setup";
  onSuccess: () => void;
}

export default function Login({ mode, onSuccess }: LoginProps) {
  const [password, setPassword] = useState("");
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const login = useLogin();
  const setup = useSetup();
  const loading = login.isPending || setup.isPending;

  const handleSetup = async () => {
    setError("");
    try {
      const data = await setup.mutateAsync();
      if (!data.password) throw new Error("Setup did not return a password");
      setGeneratedPassword(data.password);
    } catch (error: unknown) {
      setError(errorMessage(error, "Connection failed"));
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(generatedPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!password) return;
    try {
      await login.mutateAsync(password);
      onSuccess();
    } catch (error: unknown) {
      setError(errorMessage(error, "Connection failed"));
    }
  };

  // Setup mode: generate password + show it
  if (mode === "setup") {
    return (
      <div className="fixed inset-0 z-9999 flex items-center justify-center bg-[#0a0a0a]">
        <div className="w-full max-w-sm mx-4 bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-2xl">
          <div className="text-center mb-6">
            <span className="text-4xl block mb-2">🔒</span>
            <h1 className="text-xl font-bold text-white">Protect Your Dashboard</h1>
            <p className="text-sm text-neutral-400 mt-1">
              Generate a password to secure all API routes
            </p>
          </div>

          {!generatedPassword ? (
            <div className="space-y-3">
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <button
                onClick={handleSetup}
                disabled={loading}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg text-sm transition-colors"
              >
                {loading ? "Generating..." : "Generate Password"}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-xs text-neutral-500 mb-1.5">
                  Your password (save this somewhere safe):
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-green-400 text-sm font-mono select-all break-all">
                    {generatedPassword}
                  </code>
                  <button
                    onClick={handleCopy}
                    className="px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-300 hover:text-white text-sm transition-colors shrink-0"
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>
              <button
                onClick={onSuccess}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg text-sm transition-colors"
              >
                Continue to Dashboard
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Login mode
  return (
    <div className="fixed inset-0 z-9999 flex items-center justify-center bg-[#0a0a0a]">
      <form
        onSubmit={handleLogin}
        className="w-full max-w-sm mx-4 bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-2xl"
      >
        <div className="text-center mb-6">
          <span className="text-4xl block mb-2">🔒</span>
          <h1 className="text-xl font-bold text-white">Dashboard Login</h1>
        </div>

        <div className="space-y-3">
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2.5 bg-neutral-800 border border-neutral-700 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500 text-sm"
            autoFocus
          />

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg text-sm transition-colors"
          >
            {loading ? "Please wait..." : "Log In"}
          </button>
        </div>
      </form>
    </div>
  );
}
