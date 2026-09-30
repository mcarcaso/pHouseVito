import assert from "node:assert/strict";
import { it } from "node:test";
import { WhatsAppAgentChannelService } from "../../src/services/channels/whatsapp/WhatsAppAgentChannelService.js";

it("lets fetch set the multipart boundary while keeping JSON content type", async () => {
  const originalFetch = globalThis.fetch;
  const observed: Array<{ url: string; headers: Headers }> = [];
  globalThis.fetch = async (input, init) => {
    observed.push({ url: String(input), headers: new Request(input, init).headers });
    return new Response(null, { status: 204 });
  };

  try {
    const service = new WhatsAppAgentChannelService();
    const request = (
      service as unknown as { request: (path: string, options: RequestInit) => Promise<Response> }
    ).request.bind(service);
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    await request("/media", { method: "POST", body: form });
    await request("/messages", { method: "POST", body: JSON.stringify({ type: "text" }) });

    assert.equal(observed.length, 2);
    assert.equal(observed[0].url, "https://api.whatsapp.com/agent/v1/media");
    assert.match(observed[0].headers.get("content-type") ?? "", /^multipart\/form-data; boundary=/);
    assert.equal(observed[1].headers.get("content-type"), "application/json");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
