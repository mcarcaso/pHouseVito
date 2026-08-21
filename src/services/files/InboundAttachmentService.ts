import type { Context } from "../../context/Context.js";
import type { InboundEvent } from "../../lib/types/inbound-event.js";

export interface InboundAttachmentService {
  prepare(x: Context, event: InboundEvent): Promise<void>;
}
