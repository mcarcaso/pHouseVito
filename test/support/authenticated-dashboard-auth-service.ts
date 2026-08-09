import type { Context } from "../../src/context/Context.js";
import type {
  DashboardAuthService,
  DashboardAuthStatus,
  DashboardLoginResult,
  DashboardSetupResult,
} from "../../src/services/auth/DashboardAuthService.js";

export class AuthenticatedDashboardAuthService implements DashboardAuthService {
  getStatus(_x: Context, _cookieHeader?: string): DashboardAuthStatus {
    return { authenticated: true, passwordSet: true };
  }

  isPasswordSet(_x: Context): boolean {
    return true;
  }

  isAuthenticated(_x: Context, _cookieHeader?: string): boolean {
    return true;
  }

  setup(_x: Context, _args: { host?: string }): DashboardSetupResult {
    return { status: "password_already_set" };
  }

  login(
    _x: Context,
    _args: { password: unknown; ip: string; host?: string },
  ): DashboardLoginResult {
    return { status: "invalid_password" };
  }

  logout(_x: Context, _args: { cookieHeader?: string; host?: string }): string {
    return "";
  }
}

export const authenticatedDashboardAuthService =
  new AuthenticatedDashboardAuthService();
