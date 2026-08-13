import { useState } from "react";
import EmbeddingsTab from "./memory/EmbeddingsTab";
import ProfileTab from "./memory/ProfileTab";

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

function Memory() {
  const [tab, setTab] = useState<"profile" | "embeddings">("profile");

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-neutral-800 sticky top-0 bg-black/95 backdrop-blur z-10">
        <h2 className="text-lg font-semibold text-white">Memory</h2>
        <div className="flex gap-1 bg-neutral-900 rounded-lg p-0.5">
          <button
            onClick={() => setTab("profile")}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
              tab === "profile"
                ? "bg-blue-950 text-blue-400"
                : "text-neutral-400 hover:text-white hover:bg-neutral-800"
            }`}
          >
            👤 Profile
          </button>
          <button
            onClick={() => setTab("embeddings")}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
              tab === "embeddings"
                ? "bg-blue-950 text-blue-400"
                : "text-neutral-400 hover:text-white hover:bg-neutral-800"
            }`}
          >
            🧠 Embeddings
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === "profile" ? <ProfileTab /> : <EmbeddingsTab />}
      </div>
    </div>
  );
}

export default Memory;
