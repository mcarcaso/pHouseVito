import { useEffect, useState } from "react";
import {
  useProviderLoginStatus,
  useProviderLogout,
  useProviders,
  useStartProviderLogin,
  useSubmitProviderPrompt,
} from "../../hooks/useProviders";
import { errorMessage } from "../../lib/api-client";

export default function ProviderAccess() {
  const providersQuery = useProviders();
  const startLogin = useStartProviderLogin();
  const submitPrompt = useSubmitProviderPrompt();
  const logout = useProviderLogout();
  const [loggingIn, setLoggingIn] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [deviceLogin, setDeviceLogin] = useState<{
    providerId: string;
    userCode: string;
    verificationUri: string;
    expiresInSeconds?: number;
  } | null>(null);
  const [promptLogin, setPromptLogin] = useState<{ providerId: string; message?: string } | null>(
    null,
  );
  const [promptValue, setPromptValue] = useState("");
  const loginStatus = useProviderLoginStatus(loggingIn);
  const overview = providersQuery.data;

  useEffect(() => {
    const status = loginStatus.data;
    if (!status || !loggingIn) return;
    if (status.status === "success") {
      setLoggingIn(null);
      setDeviceLogin(null);
      setPromptLogin(null);
      void providersQuery.refetch();
    } else if (status.status === "prompt") {
      setPromptLogin({ providerId: loggingIn, message: status.promptMessage });
    } else if (status.status === "error") {
      setLoginError(status.error || "Login failed");
      setLoggingIn(null);
      setDeviceLogin(null);
      setPromptLogin(null);
    }
  }, [loginStatus.data, loggingIn, providersQuery]);

  const beginLogin = async (providerId: string) => {
    setLoggingIn(providerId);
    setLoginError(null);
    setDeviceLogin(null);
    setPromptLogin(null);
    setPromptValue("");
    try {
      const result = await startLogin.mutateAsync(providerId);
      if (result.status === "already_authenticated") {
        setLoggingIn(null);
        await providersQuery.refetch();
      } else if (result.status === "login_started") {
        window.open(result.url, "_blank");
      } else {
        setDeviceLogin({ providerId, ...result });
        window.open(result.verificationUri, "_blank");
      }
    } catch (error: unknown) {
      setLoginError(errorMessage(error, "Login request failed"));
      setLoggingIn(null);
    }
  };

  const sendPrompt = async (providerId: string) => {
    try {
      await submitPrompt.mutateAsync({ providerId, value: promptValue });
      setPromptLogin(null);
      setPromptValue("");
    } catch (error: unknown) {
      setLoginError(errorMessage(error, "Failed to submit login response"));
    }
  };

  return (
    <section className="bg-[#151515] border border-neutral-800 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h4 className="text-sm font-semibold text-white">Provider Access</h4>
          <p className="text-xs text-neutral-600 mt-1">
            API keys are managed in Secrets. Subscription authentication can be managed here.
          </p>
        </div>
        <a href="/secrets" className="text-xs text-blue-400 hover:text-blue-300">
          Manage keys
        </a>
      </div>

      {providersQuery.isPending ? (
        <div className="text-xs text-neutral-500">Loading providers...</div>
      ) : providersQuery.isError ? (
        <div className="text-xs text-red-400">
          {errorMessage(providersQuery.error, "Failed to load providers")}
        </div>
      ) : (
        <div className="space-y-2">
          {overview?.oauthProviders.map((provider) => {
            const status = overview.authStatus[provider.id];
            const authenticated = status?.hasAuth === true;
            return (
              <div
                key={provider.id}
                className="flex items-center justify-between gap-3 py-2 border-b border-neutral-800/50 last:border-b-0"
              >
                <div>
                  <div className="text-sm text-neutral-300">{provider.name}</div>
                  <div
                    className={`text-xs ${authenticated ? "text-green-400" : "text-neutral-600"}`}
                  >
                    {authenticated
                      ? status.authType === "oauth"
                        ? "Subscription connected"
                        : "API key configured"
                      : "Not connected"}
                  </div>
                </div>
                {status?.authType === "oauth" ? (
                  <button
                    onClick={() => void logout.mutateAsync(provider.id)}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Log out
                  </button>
                ) : (
                  <button
                    onClick={() => void beginLogin(provider.id)}
                    disabled={loggingIn === provider.id}
                    className="text-xs text-blue-400 hover:text-blue-300 disabled:text-neutral-600"
                  >
                    {loggingIn === provider.id ? "Waiting..." : "Log in"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {deviceLogin && (
        <div className="mt-3 rounded-md border border-blue-900/60 bg-blue-950/30 p-3 text-xs text-neutral-200 space-y-2">
          <div>
            Enter this code at{" "}
            <a
              href={deviceLogin.verificationUri}
              target="_blank"
              rel="noreferrer"
              className="text-blue-300 underline"
            >
              {deviceLogin.verificationUri}
            </a>
            :
          </div>
          <div className="font-mono text-lg tracking-widest text-white">{deviceLogin.userCode}</div>
          {deviceLogin.expiresInSeconds && (
            <div className="text-neutral-400">
              Expires in about {Math.round(deviceLogin.expiresInSeconds / 60)} minutes.
            </div>
          )}
        </div>
      )}

      {promptLogin && (
        <div className="mt-3 rounded-md border border-amber-900/60 bg-amber-950/20 p-3 text-xs text-neutral-200 space-y-2">
          <div>
            {promptLogin.message ||
              "Copy the full localhost redirect URL from the browser and paste it here."}
          </div>
          <input
            value={promptValue}
            onChange={(event) => setPromptValue(event.target.value)}
            placeholder="http://localhost:..."
            className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1.5 text-neutral-200 focus:outline-none focus:border-amber-600"
          />
          <button
            onClick={() => void sendPrompt(promptLogin.providerId)}
            disabled={!promptValue.trim()}
            className="px-3 py-1 text-xs bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-md"
          >
            Submit redirect URL
          </button>
        </div>
      )}

      {loginError && <div className="text-xs text-red-400 mt-3">{loginError}</div>}
    </section>
  );
}
