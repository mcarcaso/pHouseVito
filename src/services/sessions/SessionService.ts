import type { Context } from "../../context/Context.js";
import type { SessionRow } from "../../stores/sessions/SessionStore.js";

export interface SessionService {
  resolve(x: Context, sessionKey: string): SessionRow;
}
