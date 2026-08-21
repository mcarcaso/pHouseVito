import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { requestJson } from "../lib/api-client";

const resultSchema = z
  .object({
    success: z.boolean(),
    message: z.string().optional(),
    error: z.string().optional(),
    count: z.number().optional(),
    updated: z.number().optional(),
    failed: z.number().optional(),
  })
  .passthrough();
type ChannelName = "discord" | "telegram";

function useChannelAction(action: "register-commands" | "auto-alias") {
  return useMutation({
    mutationFn: (channel: ChannelName) =>
      requestJson(`/api/${channel}/${action}`, resultSchema, { method: "POST" }),
  });
}

export function useRegisterChannelCommands() {
  return useChannelAction("register-commands");
}

export function useAutoAliasChannel() {
  return useChannelAction("auto-alias");
}
