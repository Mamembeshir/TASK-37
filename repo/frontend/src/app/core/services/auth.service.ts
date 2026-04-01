import { Injectable, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import type { User, LoginResponse, Role } from '../models/user.model';
import { STAFF_ROLES } from '../models/user.model';

const TOKEN_KEY = 'roh_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  // ── Reactive state ──────────────────────────────────────────────
  readonly currentUser = signal<User | null>(null);
  readonly isLoggedIn = computed(() => this.currentUser() !== null);
  readonly role = computed<Role | null>(() => this.currentUser()?.role ?? null);
  readonly isStaff = computed(() => {
    const r = this.role();
    return r !== null && STAFF_ROLES.includes(r);
  });

  // ── Token persistence ───────────────────────────────────────────
  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  private saveToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
  }

  private clearToken(): void {
    localStorage.removeItem(TOKEN_KEY);
  }

  // ── Auth operations ─────────────────────────────────────────────

  /**
   * Authenticate with username + password.
   * On success: saves token, updates currentUser signal, returns the user.
   * Throws the raw HTTP error on failure (caller handles 401/423 display).
   */
  async login(username: string, password: string): Promise<User> {
    const res = await firstValueFrom(
      this.api.post<LoginResponse>('/auth/login', { username, password }),
    );
    this.saveToken(res.token);
    this.currentUser.set(res.user as User);
    return res.user as User;
  }

  /**
   * Invalidate the server session and clear local state.
   * Always redirects to /login, even if the server call fails.
   */
  async logout(): Promise<void> {
    try {
      if (this.token) {
        await firstValueFrom(this.api.post<{ ok: boolean }>('/auth/logout', {}));
      }
    } catch {
      // Ignore errors — clear state regardless
    } finally {
      this.clearToken();
      this.currentUser.set(null);
      await this.router.navigate(['/login']);
    }
  }

  /**
   * Load the current user from the backend using the stored token.
   * Called by APP_INITIALIZER on startup. If the token is invalid/expired,
   * clears local state silently (user will be prompted to log in when they
   * hit a protected route).
   */
  async loadCurrentUser(): Promise<void> {
    if (!this.token) return;
    try {
      const user = await firstValueFrom(this.api.get<User>('/auth/me'));
      this.currentUser.set(user);
    } catch {
      this.clearToken();
      this.currentUser.set(null);
    }
  }

  /**
   * Check if the current user has at least one of the given roles.
   * Useful for template-level conditional rendering.
   */
  hasRole(...roles: Role[]): boolean {
    const r = this.role();
    return r !== null && roles.includes(r);
  }
}
