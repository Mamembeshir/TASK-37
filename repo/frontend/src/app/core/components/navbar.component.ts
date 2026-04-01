import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { ROLE_LABELS } from '../models/user.model';
import type { Role } from '../models/user.model';
import { NotificationBellComponent } from './notification-bell.component';

/** Role → Tailwind colour classes for the badge */
const ROLE_BADGE: Record<Role, string> = {
  customer:   'bg-zinc-700/60 text-zinc-700 border-zinc-600/40',
  associate:  'bg-[#c4832a]/10 text-[#c4832a] border-[#c4832a]/20',
  supervisor: 'bg-violet-500/10 text-violet-300 border-violet-500/20',
  manager:    'bg-[#c4832a]/10 text-[#c4832a] border-[#c4832a]/20',
  admin:      'bg-rose-500/10 text-rose-300 border-rose-500/20',
};

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, NotificationBellComponent],
  template: `
    <header class="sticky top-0 z-50 border-b border-zinc-200 bg-[#faf8f3]">
      <div class="mx-auto max-w-7xl px-4 sm:px-6 h-14 flex items-center gap-4">

        <!-- Brand -->
        <a routerLink="/" class="flex items-center gap-2 shrink-0 group">
          <div class="w-7 h-7 rounded-lg bg-[#c4832a]/10 border border-[#c4832a]/20 flex items-center justify-center
                      group-hover:bg-[#c4832a]/10 transition-colors">
            <svg class="w-4 h-4 text-[#c4832a]" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M13.5 21v-7.5A.75.75 0 0 1 14.25 12h3a.75.75 0 0 1 .75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349M3.75 21V9.349m0 0a3.001 3.001 0 0 0 3.75-.615A2.993 2.993 0 0 0 9.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 0 0 2.25 1.016c.896 0 1.7-.393 2.25-1.015a3.001 3.001 0 0 0 3.75.614m-16.5 0a3.004 3.004 0 0 1-.621-4.72l1.189-1.19A1.5 1.5 0 0 1 5.378 3h13.243a1.5 1.5 0 0 1 1.06.44l1.19 1.189a3 3 0 0 1-.621 4.72M6.75 18h3.75a.75.75 0 0 0 .75-.75V13.5a.75.75 0 0 0-.75-.75H6.75a.75.75 0 0 0-.75.75v3.75c0 .414.336.75.75.75Z" />
            </svg>
          </div>
          <span class="text-sm font-semibold text-zinc-800 tracking-tight hidden sm:block">ROH</span>
        </a>

        <!-- Nav links — shown based on role -->
        <nav class="flex items-center gap-1 flex-1 overflow-x-auto scrollbar-none">
          <a routerLink="/catalog" routerLinkActive="text-[#c4832a] bg-[#c4832a]/10"
             class="nav-link">Catalog</a>

          <a routerLink="/cart" routerLinkActive="text-[#c4832a] bg-[#c4832a]/10"
             class="nav-link">Cart</a>

          <a routerLink="/orders" routerLinkActive="text-[#c4832a] bg-[#c4832a]/10"
             class="nav-link">Orders</a>

          <a routerLink="/tickets" routerLinkActive="text-[#c4832a] bg-[#c4832a]/10"
             class="nav-link">Support</a>

          @if (auth.isStaff()) {
            <a routerLink="/associate" routerLinkActive="text-[#c4832a] bg-[#c4832a]/10"
               class="nav-link">Associate</a>
          }

          @if (auth.hasRole('admin', 'manager')) {
            <a routerLink="/admin" routerLinkActive="text-[#c4832a] bg-[#c4832a]/10"
               class="nav-link">Admin</a>
          }

          @if (auth.hasRole('admin')) {
            <a routerLink="/admin/campaigns" routerLinkActive="text-[#c4832a] bg-[#c4832a]/10"
               class="nav-link">Campaigns</a>
          }
        </nav>

        <!-- Notification bell -->
        <app-notification-bell />

        <!-- Right: user info + logout -->
        @if (auth.currentUser(); as user) {
          <div class="flex items-center gap-2 shrink-0">

            <!-- Role badge -->
            <span class="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border
                         {{ roleBadgeClass(user.role) }}">
              {{ roleLabel(user.role) }}
            </span>

            <!-- Username -->
            <span class="text-sm text-zinc-700 font-medium hidden md:block max-w-[120px] truncate"
                  [title]="user.username">
              {{ user.username }}
            </span>

            <!-- Logout -->
            <button
              type="button"
              (click)="logout()"
              [disabled]="loggingOut"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                     text-zinc-700 hover:text-zinc-900 hover:bg-zinc-100
                     border border-transparent hover:border-zinc-200
                     transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              @if (loggingOut) {
                <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                </svg>
              } @else {
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round"
                    d="M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 16.5 21h-6a2.25 2.25 0 0 1-2.25-2.25V15M12 9l3 3m0 0-3 3m3-3H2.25" />
                </svg>
              }
              <span class="hidden sm:inline">Sign out</span>
            </button>
          </div>
        }
      </div>
    </header>
  `,
  styles: [`
    .nav-link {
      padding: 0.375rem 0.75rem;
      border-radius: 0.5rem;
      font-size: 0.75rem;
      font-weight: 500;
      color: #6b7280;
      transition: color 150ms, background-color 150ms;
      white-space: nowrap;
      text-decoration: none;
      display: inline-block;
    }
    .nav-link:hover {
      color: #111827;
      background-color: rgba(0,0,0,0.05);
    }
  `],
})
export class NavbarComponent {
  protected readonly auth = inject(AuthService);
  protected loggingOut = false;

  protected roleBadgeClass(role: Role): string {
    return ROLE_BADGE[role] ?? ROLE_BADGE.customer;
  }

  protected roleLabel(role: Role): string {
    return ROLE_LABELS[role] ?? role;
  }

  async logout(): Promise<void> {
    this.loggingOut = true;
    try {
      await this.auth.logout();
    } finally {
      this.loggingOut = false;
    }
  }
}
