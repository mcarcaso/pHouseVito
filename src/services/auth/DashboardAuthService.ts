import type { Context } from "../../context/Context.js";

export interface DashboardAuthStatus {
  authenticated: boolean;
  passwordSet: boolean;
}

export type DashboardLoginResult =
  | { status: "success"; cookie: string; token: string }
  | { status: "rate_limited" }
  | { status: "password_not_set" }
  | { status: "invalid_password" };

export type DashboardSetupResult =
  | { status: "success"; password: string; cookie: string; token: string }
  | { status: "password_already_set" };

export interface DashboardAuthService {
  getStatus(x: Context, cookieHeader?: string, authorizationHeader?: string): DashboardAuthStatus;
  isPasswordSet(x: Context): boolean;
  isAuthenticated(x: Context, cookieHeader?: string, authorizationHeader?: string): boolean;
  setup(x: Context, args: { host?: string }): DashboardSetupResult;
  login(x: Context, args: { password: unknown; ip: string; host?: string }): DashboardLoginResult;
  logout(
    x: Context,
    args: { cookieHeader?: string; authorizationHeader?: string; host?: string },
  ): string;
}
