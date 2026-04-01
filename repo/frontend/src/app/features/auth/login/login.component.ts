import { Component, inject, signal } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import type { HttpErrorResponse } from '@angular/common/http';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="flex items-center justify-center min-h-screen bg-[#faf8f3] px-4">
      <div class="w-full max-w-sm animate-fade-in">

        <!-- Brand header -->
        <div class="text-center mb-8">
          <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#c4832a]/10 border border-[#c4832a]/20 mb-4">
            <svg class="w-8 h-8 text-[#c4832a]" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M13.5 21v-7.5A.75.75 0 0 1 14.25 12h3a.75.75 0 0 1 .75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349M3.75 21V9.349m0 0a3.001 3.001 0 0 0 3.75-.615A2.993 2.993 0 0 0 9.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 0 0 2.25 1.016c.896 0 1.7-.393 2.25-1.015a3.001 3.001 0 0 0 3.75.614m-16.5 0a3.004 3.004 0 0 1-.621-4.72l1.189-1.19A1.5 1.5 0 0 1 5.378 3h13.243a1.5 1.5 0 0 1 1.06.44l1.19 1.189a3 3 0 0 1-.621 4.72M6.75 18h3.75a.75.75 0 0 0 .75-.75V13.5a.75.75 0 0 0-.75-.75H6.75a.75.75 0 0 0-.75.75v3.75c0 .414.336.75.75.75Z" />
            </svg>
          </div>
          <h1 class="text-2xl font-bold text-zinc-900 tracking-tight">Retail Operations Hub</h1>
          <p class="text-zinc-700 text-sm mt-1">Sign in to continue</p>
        </div>

        <!-- Lockout alert -->
        @if (lockoutMessage()) {
          <div class="mb-4 rounded-xl border border-[#c4832a]/20 bg-[#c4832a]/10 px-4 py-3 flex gap-3 items-start">
            <svg class="w-5 h-5 text-[#c4832a] mt-0.5 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
            <div>
              <p class="text-[#c4832a] text-sm font-medium">Account Locked</p>
              <p class="text-[#c4832a]/80 text-xs mt-0.5">{{ lockoutMessage() }}</p>
            </div>
          </div>
        }

        <!-- Login form -->
        <form class="glass rounded-2xl p-6 space-y-4" (ngSubmit)="submit()" #loginForm="ngForm">

          <div>
            <label class="block text-xs font-medium text-zinc-700 mb-1.5" for="username">Username</label>
            <input
              id="username"
              name="username"
              type="text"
              class="input-field"
              placeholder="Enter your username"
              autocomplete="username"
              [(ngModel)]="username"
              required
              [disabled]="loading()"
            />
          </div>

          <div>
            <label class="block text-xs font-medium text-zinc-700 mb-1.5" for="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              class="input-field"
              placeholder="Enter your password"
              autocomplete="current-password"
              [(ngModel)]="password"
              required
              [disabled]="loading()"
            />
          </div>

          <button
            type="submit"
            class="btn-primary w-full mt-2"
            [disabled]="loading() || !loginForm.valid"
          >
            @if (loading()) {
              <span class="inline-flex items-center gap-2">
                <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                </svg>
                Signing in…
              </span>
            } @else {
              Sign in
            }
          </button>
        </form>

        <p class="text-center text-zinc-800 text-xs mt-6">Offline &middot; Local network only</p>
      </div>
    </div>
  `,
})
export class LoginComponent {
  private readonly auth  = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route  = inject(ActivatedRoute);
  private readonly toast  = inject(ToastService);

  username = '';
  password = '';

  readonly loading        = signal(false);
  readonly lockoutMessage = signal<string | null>(null);

  async submit(): Promise<void> {
    if (this.loading()) return;

    this.lockoutMessage.set(null);
    this.loading.set(true);

    try {
      await this.auth.login(this.username, this.password);
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/';
      await this.router.navigateByUrl(returnUrl);
    } catch (err: unknown) {
      const e = err as HttpErrorResponse;
      if (e.status === 423) {
        this.lockoutMessage.set(
          'Your account has been temporarily locked after too many failed attempts. Please try again in 15 minutes or contact a manager.',
        );
      } else if (e.status === 401) {
        this.toast.error('Invalid username or password.');
      } else {
        this.toast.error('Unable to connect. Please check your network connection.');
      }
    } finally {
      this.loading.set(false);
    }
  }
}
