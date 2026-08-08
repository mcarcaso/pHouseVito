import crypto from "node:crypto";
import type { Context } from "../../context/Context.js";
import { xSecretService } from "../../lib/x.js";
import type {
  DashboardAuthService,
  DashboardAuthStatus,
  DashboardLoginResult,
  DashboardSetupResult,
} from "./DashboardAuthService.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;

function parseCookie(cookieHeader: string | undefined, name: string): string {
  if (!cookieHeader) return "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function buildSessionCookie(sessionId: string, maxAge: number, host?: string): string {
  const hostname = (host ?? "").split(":")[0];
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1";
  const secure = isLocal ? "" : " Secure;";
  return `session=${sessionId}; HttpOnly; Path=/; SameSite=Lax;${secure} Max-Age=${maxAge}`;
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  const expected = Buffer.from(hash, "hex");
  if (expected.length !== 64) return false;
  return crypto.timingSafeEqual(expected, Buffer.from(derived, "hex"));
}

export class InMemoryDashboardAuthService implements DashboardAuthService {
  private readonly sessions = new Map<string, { expires: number }>();
  private readonly loginAttempts = new Map<string, { count: number; resetAt: number }>();

  isPasswordSet(x: Context): boolean {
    return Boolean(xSecretService(x).get(x, "DASHBOARD_PASSWORD_HASH"));
  }

  isAuthenticated(_x: Context, cookieHeader?: string): boolean {
    const sessionId = parseCookie(cookieHeader, "session");
    const session = this.sessions.get(sessionId);
    return Boolean(session && session.expires > Date.now());
  }

  getStatus(x: Context, cookieHeader?: string): DashboardAuthStatus {
    const passwordSet = this.isPasswordSet(x);
    return {
      authenticated: passwordSet && this.isAuthenticated(x, cookieHeader),
      passwordSet,
    };
  }

  setup(x: Context, args: { host?: string }): DashboardSetupResult {
    if (this.isPasswordSet(x)) return { status: "password_already_set" };
    const password = crypto.randomUUID();
    xSecretService(x).set(x, {
      key: "DASHBOARD_PASSWORD_HASH",
      value: hashPassword(password),
    });
    const sessionId = this.createSession();
    return {
      status: "success",
      password,
      cookie: buildSessionCookie(sessionId, SESSION_TTL_MS / 1000, args.host),
    };
  }

  login(
    x: Context,
    args: { password: unknown; ip: string; host?: string }
  ): DashboardLoginResult {
    if (!this.checkLoginRateLimit(args.ip)) return { status: "rate_limited" };
    const hash = xSecretService(x).get(x, "DASHBOARD_PASSWORD_HASH");
    if (!hash) return { status: "password_not_set" };
    if (typeof args.password !== "string" || !args.password || !verifyPassword(args.password, hash)) {
      return { status: "invalid_password" };
    }
    this.loginAttempts.delete(args.ip);
    const sessionId = this.createSession();
    return {
      status: "success",
      cookie: buildSessionCookie(sessionId, SESSION_TTL_MS / 1000, args.host),
    };
  }

  logout(_x: Context, args: { cookieHeader?: string; host?: string }): string {
    const sessionId = parseCookie(args.cookieHeader, "session");
    if (sessionId) this.sessions.delete(sessionId);
    return buildSessionCookie("", 0, args.host);
  }

  private createSession(): string {
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, { expires: Date.now() + SESSION_TTL_MS });
    return sessionId;
  }

  private checkLoginRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = this.loginAttempts.get(ip);
    if (!entry || now > entry.resetAt) {
      this.loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
      return true;
    }
    if (entry.count >= LOGIN_MAX_ATTEMPTS) return false;
    entry.count++;
    return true;
  }
}
