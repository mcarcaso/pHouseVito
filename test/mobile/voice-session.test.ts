import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import * as voiceTaskStateModule from "../../mobile/src/services/voice/voice-task-state.ts";

const { hasDeliverableVoiceTaskResult } =
  voiceTaskStateModule.default as typeof import("../../mobile/src/services/voice/voice-task-state.ts");

describe("mobile voice session", () => {
  it("does not suppress a future completion after a running status check", () => {
    assert.equal(hasDeliverableVoiceTaskResult("queued"), false);
    assert.equal(hasDeliverableVoiceTaskResult("running"), false);
    assert.equal(hasDeliverableVoiceTaskResult("completed"), true);
    assert.equal(hasDeliverableVoiceTaskResult("failed"), true);
    assert.equal(hasDeliverableVoiceTaskResult("cancelled"), false);
  });

  it("continues chat by voice without a separate voice tab", async () => {
    const context = await readFile("mobile/src/contexts/voice-session.tsx", "utf8");
    const chat = await readFile("mobile/src/screens/chat/ChatScreen.tsx", "utf8");
    const tabBar = await readFile("mobile/src/components/navigation/MobileTabBar.tsx", "utf8");

    assert.match(chat, /navigate\("VoiceConversation"/);
    assert.match(context, /This is a continuation of the following conversation/);
    assert.match(context, /getVoiceConversationContext/);
    assert.match(context, /persistenceChainRef/);
    assert.doesNotMatch(tabBar, /"Voice"/);
  });

  it("owns the live runtime above navigation instead of inside the voice screen", async () => {
    const app = await readFile("mobile/src/application/App.tsx", "utf8");
    const screen = await readFile("mobile/src/screens/voice/VoiceScreen.tsx", "utf8");
    const context = await readFile("mobile/src/contexts/voice-session.tsx", "utf8");

    assert.match(app, /<AuthenticatedVoiceProviders[\s\S]*<NavigationContainer/);
    assert.match(app, /function AuthenticatedVoiceProviders[\s\S]*<VoiceSessionProvider/);
    assert.doesNotMatch(screen, /LiveVoiceSession|startVoiceAudio|waitForTask/);
    assert.match(context, /connectionRef/);
    assert.match(context, /waitForTask/);
    assert.match(context, /useEffect\(\(\) => \(\) => closeConnection\(false\)/);
  });
});
