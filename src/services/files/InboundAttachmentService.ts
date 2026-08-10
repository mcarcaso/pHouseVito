import type { Context } from "../../context/Context.js";
import type { InboundEvent } from "../../contracts/inbound-event.js";

export interface InboundAttachmentService {
  prepare(x: Context, event: InboundEvent): Promise<void>;
}
