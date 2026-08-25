import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../services/api/client";

const AgentIdentityContext = createContext("Agent");

export function AgentIdentityProvider({ children }: { children: ReactNode }) {
  const [agentName, setAgentName] = useState("Agent");
  useEffect(() => {
    void api<{ bot?: { name?: string } }>("/api/config")
      .then((config) => setAgentName(config.bot?.name?.trim() || "Agent"))
      .catch(() => setAgentName("Agent"));
  }, []);
  return (
    <AgentIdentityContext.Provider value={agentName}>{children}</AgentIdentityContext.Provider>
  );
}

export function useAgentName(): string {
  return useContext(AgentIdentityContext);
}
