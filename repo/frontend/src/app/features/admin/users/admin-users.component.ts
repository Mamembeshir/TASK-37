import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import type { Role } from '../../../core/models/user.model';
import { ROLE_LABELS } from '../../../core/models/user.model';

const PAGE_SIZE = 30;

export interface AdminUser {
  id: string;
  username: string;
  role: Role;
  phone: string | null;
  isLocked: boolean;
  failedAttempts: number;
  lockedUntil: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

interface AdminUserListResponse {
  data: AdminUser[];
  total: number;
  limit: number;
  offset: number;
}

const ROLE_BADGE: Record<Role, string> = {
  customer:   'bg-zinc-500/10 border-zinc-500/20 text-zinc-700',
  associate:  'bg-sky-50 border-sky-200 text-sky-300',
  supervisor: 'bg-violet-500/10 border-violet-500/20 text-violet-300',
  manager:    'bg-[#c4832a]/10 border-[#c4832a]/20 text-[#c4832a]',
  admin:      'bg-red-500/10 border-red-500/20 text-red-300',
};

const ALL_ROLES: Role[] = ['customer', 'associate', 'supervisor', 'manager', 'admin'];

@Component({
  selector: 'app-admin-users',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-6 animate-fade-in">

      <!-- Header -->
      <div>
        <h1 class="text-2xl font-bold text-zinc-900">User Management</h1>
        <p class="text-sm text-zinc-700 mt-0.5">
          View accounts, assign roles, and clear security lockouts
        </p>
      </div>

      <!-- Filters -->
      <div class="flex flex-wrap gap-3">
        <input type="text" class="input-field w-52 py-2 text-sm" placeholder="Search username…"
               [ngModel]="filterQuery()" (ngModelChange)="onQueryChange($event)" />
        <select class="input-field w-40 py-2 text-sm cursor-pointer"
                [ngModel]="filterRole()" (ngModelChange)="onRoleChange($event)">
          <option value="">All roles</option>
          @for (r of allRoles; track r) {
            <option [value]="r">{{ roleLabel(r) }}</option>
          }
        </select>
        <div class="flex rounded-xl overflow-hidden border border-zinc-200">
          <button type="button"
                  [class]="filterLocked() === ''
                    ? 'px-3 py-2 text-xs font-semibold bg-white/10 text-zinc-800 border-r border-zinc-200 transition-colors'
                    : 'px-3 py-2 text-xs text-zinc-700 hover:text-zinc-700 border-r border-zinc-200 transition-colors bg-transparent'"
                  (click)="onLockedChange('')">All</button>
          <button type="button"
                  [class]="filterLocked() === 'true'
                    ? 'px-3 py-2 text-xs font-semibold bg-red-500/20 text-red-300 transition-colors'
                    : 'px-3 py-2 text-xs text-zinc-700 hover:text-zinc-700 transition-colors bg-transparent'"
                  (click)="onLockedChange('true')">Locked only</button>
        </div>
      </div>

      <!-- Role-change modal -->
      @if (roleTarget()) {
        <div class="fixed inset-0 bg-black/60 z-50 flex items-center
                    justify-center p-4 animate-fade-in">
          <div class="card max-w-sm w-full p-6 space-y-4 animate-scale-in">
            <h2 class="text-base font-semibold text-zinc-900">Change role</h2>
            <p class="text-sm text-zinc-700">
              Reassign <span class="text-zinc-800 font-medium">{{ roleTarget()!.username }}</span>
              from
              <span class="font-semibold text-zinc-700">{{ roleLabel(roleTarget()!.role) }}</span>
              to:
            </p>

            <div class="grid grid-cols-1 gap-2">
              @for (r of allRoles; track r) {
                <button type="button"
                        [class]="newRole() === r
                          ? 'flex items-center gap-3 px-4 py-2.5 rounded-xl border bg-white/8 text-zinc-900 border-zinc-300 transition-colors'
                          : 'flex items-center gap-3 px-4 py-2.5 rounded-xl border border-zinc-200 text-zinc-700 hover:text-zinc-800 hover:border-zinc-300 transition-colors'"
                        (click)="newRole.set(r)">
                  <span class="text-[10px] px-2 py-0.5 rounded border font-semibold uppercase
                               tracking-wider {{ roleBadge(r) }}">
                    {{ roleLabel(r) }}
                  </span>
                  @if (r === roleTarget()!.role) {
                    <span class="text-xs text-zinc-800 ml-auto italic">current</span>
                  }
                  @if (newRole() === r && r !== roleTarget()!.role) {
                    <svg class="w-4 h-4 text-[#c4832a] ml-auto" fill="none"
                         stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  }
                </button>
              }
            </div>

            @if (modalError()) {
              <div class="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10
                          border border-red-500/30 text-sm text-red-300">
                <svg class="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor"
                     stroke-width="1.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round"
                        d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                </svg>
                {{ modalError() }}
              </div>
            }

            <div class="flex items-center gap-3 justify-end">
              <button type="button" class="btn-secondary py-2 px-4 text-sm"
                      [disabled]="acting()" (click)="closeRoleModal()">
                Cancel
              </button>
              <button type="button"
                      class="btn-primary py-2 px-5 text-sm flex items-center gap-2
                             disabled:opacity-50 disabled:cursor-not-allowed
                             disabled:transform-none disabled:shadow-none"
                      [disabled]="acting() || newRole() === roleTarget()!.role"
                      (click)="confirmRoleChange()">
                @if (acting()) {
                  <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10"
                            stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor"
                          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                  </svg>
                }
                Assign role
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Loading -->
      @if (loading()) {
        <div class="space-y-2">
          @for (_ of skeletons; track $index) {
            <div class="card p-4 flex gap-4 items-center">
              <div class="shimmer h-8 w-8 rounded-full"></div>
              <div class="shimmer h-4 w-40 rounded ml-2"></div>
              <div class="shimmer h-5 w-20 rounded ml-auto"></div>
            </div>
          }
        </div>
      }

      <!-- Table -->
      @if (!loading() && users().length > 0) {
        <div class="card overflow-hidden p-0">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-zinc-200 bg-zinc-50">
                  <th class="text-left px-4 py-3 text-xs font-semibold text-zinc-700 uppercase tracking-wider">User</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-zinc-700 uppercase tracking-wider">Role</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-zinc-700 uppercase tracking-wider">Status</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-zinc-700 uppercase tracking-wider hidden sm:table-cell">Last login</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-zinc-700 uppercase tracking-wider hidden lg:table-cell">Joined</th>
                  <th class="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-zinc-200">
                @for (u of users(); track u.id) {
                  <tr class="hover:bg-zinc-50 transition-colors">
                    <td class="px-4 py-3">
                      <div class="flex items-center gap-3">
                        <!-- Avatar initials -->
                        <div class="w-8 h-8 rounded-full bg-zinc-700 flex items-center
                                    justify-center text-xs font-bold text-zinc-700 shrink-0">
                          {{ u.username.slice(0, 2).toUpperCase() }}
                        </div>
                        <div>
                          <p class="font-medium text-zinc-800 text-sm">{{ u.username }}</p>
                          @if (u.phone) {
                            <p class="text-xs text-zinc-800">{{ maskPhone(u.phone) }}</p>
                          }
                        </div>
                      </div>
                    </td>
                    <td class="px-4 py-3">
                      <span class="text-[11px] px-2 py-0.5 rounded border font-semibold uppercase
                                   tracking-wider {{ roleBadge(u.role) }}">
                        {{ roleLabel(u.role) }}
                      </span>
                    </td>
                    <td class="px-4 py-3">
                      @if (u.isLocked) {
                        <div class="flex items-center gap-1.5">
                          <span class="flex h-2 w-2 rounded-full bg-red-500 shrink-0"></span>
                          <span class="text-xs text-red-400 font-medium">Locked</span>
                          @if (u.failedAttempts > 0) {
                            <span class="text-xs text-zinc-800">({{ u.failedAttempts }} fails)</span>
                          }
                        </div>
                      } @else if (u.failedAttempts > 0) {
                        <div class="flex items-center gap-1.5">
                          <span class="flex h-2 w-2 rounded-full bg-[#c4832a] shrink-0"></span>
                          <span class="text-xs text-[#c4832a]">{{ u.failedAttempts }} failed attempt{{ u.failedAttempts === 1 ? '' : 's' }}</span>
                        </div>
                      } @else {
                        <div class="flex items-center gap-1.5">
                          <span class="flex h-2 w-2 rounded-full bg-[#c4832a] shrink-0"></span>
                          <span class="text-xs text-zinc-700">Active</span>
                        </div>
                      }
                    </td>
                    <td class="px-4 py-3 text-xs text-zinc-700 hidden sm:table-cell">
                      {{ u.lastLoginAt ? formatDate(u.lastLoginAt) : '—' }}
                    </td>
                    <td class="px-4 py-3 text-xs text-zinc-800 hidden lg:table-cell">
                      {{ formatDate(u.createdAt) }}
                    </td>
                    <td class="px-4 py-3">
                      <div class="flex items-center justify-end gap-2">
                        <button type="button"
                                class="text-xs text-zinc-700 hover:text-zinc-800 transition-colors
                                       px-2 py-1 rounded border border-transparent hover:border-zinc-200"
                                (click)="openRoleModal(u)">
                          Change role
                        </button>
                        @if (u.isLocked) {
                          <button type="button"
                                  class="text-xs text-amber-500 hover:text-[#c4832a] transition-colors
                                         px-2 py-1 rounded border border-transparent
                                         hover:border-[#c4832a]/20
                                         disabled:opacity-40 disabled:cursor-not-allowed"
                                  [disabled]="unlockingId() === u.id"
                                  (click)="resetLockout(u)">
                            {{ unlockingId() === u.id ? 'Unlocking…' : 'Reset lockout' }}
                          </button>
                        }
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <!-- Pagination -->
          @if (total() > PAGE_SIZE) {
            <div class="px-4 py-3 border-t border-zinc-200 flex items-center justify-between">
              <p class="text-xs text-zinc-700">
                Showing {{ offset() + 1 }}–{{ offset() + users().length }} of {{ total() }}
              </p>
              <div class="flex items-center gap-2">
                <button type="button" class="btn-secondary py-1.5 px-3 text-xs"
                        [disabled]="offset() === 0" (click)="prevPage()">
                  Previous
                </button>
                <button type="button" class="btn-secondary py-1.5 px-3 text-xs"
                        [disabled]="offset() + PAGE_SIZE >= total()" (click)="nextPage()">
                  Next
                </button>
              </div>
            </div>
          }
        </div>
      }

      <!-- Empty -->
      @if (!loading() && users().length === 0) {
        <div class="card p-10 text-center">
          <p class="text-zinc-700">No users match the current filters.</p>
        </div>
      }
    </div>
  `,
})
export class AdminUsersComponent implements OnInit {
  private readonly api   = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly loading      = signal(true);
  readonly users        = signal<AdminUser[]>([]);
  readonly total        = signal(0);
  readonly offset       = signal(0);
  readonly filterQuery  = signal('');
  readonly filterRole   = signal('');
  readonly filterLocked = signal('');
  readonly roleTarget   = signal<AdminUser | null>(null);
  readonly newRole      = signal<Role>('customer');
  readonly modalError   = signal<string | null>(null);
  readonly acting       = signal(false);
  readonly unlockingId  = signal<string | null>(null);

  readonly PAGE_SIZE = PAGE_SIZE;
  readonly allRoles  = ALL_ROLES;
  readonly skeletons = Array(6);

  async ngOnInit(): Promise<void> { await this.load(); }

  roleLabel(r: Role): string   { return ROLE_LABELS[r]; }
  roleBadge(r: Role): string   { return ROLE_BADGE[r]; }
  formatDate(d: string): string {
    return new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' });
  }
  maskPhone(p: string): string {
    // Show only last 4 digits
    return p.length > 4 ? `••• ${p.slice(-4)}` : '••••';
  }

  onQueryChange(v: string): void  { this.filterQuery.set(v);  this.offset.set(0); void this.load(); }
  onRoleChange(v: string): void   { this.filterRole.set(v);   this.offset.set(0); void this.load(); }
  onLockedChange(v: string): void { this.filterLocked.set(v); this.offset.set(0); void this.load(); }
  prevPage(): void { this.offset.set(Math.max(0, this.offset() - PAGE_SIZE)); void this.load(); }
  nextPage(): void { this.offset.set(this.offset() + PAGE_SIZE); void this.load(); }

  openRoleModal(u: AdminUser): void {
    this.roleTarget.set(u);
    this.newRole.set(u.role);
    this.modalError.set(null);
  }

  closeRoleModal(): void { this.roleTarget.set(null); this.modalError.set(null); }

  async confirmRoleChange(): Promise<void> {
    const u = this.roleTarget();
    if (!u || this.newRole() === u.role) return;
    this.acting.set(true);
    this.modalError.set(null);
    try {
      const updated = await firstValueFrom(
        this.api.patch<AdminUser>(`/admin/users/${u.id}/role`, { role: this.newRole() })
      );
      this.users.update(list => list.map(x => x.id === updated.id ? updated : x));
      this.toast.success(`${u.username} is now ${this.roleLabel(this.newRole())}`);
      this.closeRoleModal();
    } catch (err: unknown) {
      const e = err as HttpErrorResponse;
      const msg: string = (e.error as { error?: string })?.error ?? 'Role change failed';
      this.modalError.set(msg);
    } finally {
      this.acting.set(false);
    }
  }

  async resetLockout(u: AdminUser): Promise<void> {
    this.unlockingId.set(u.id);
    try {
      const updated = await firstValueFrom(
        this.api.post<AdminUser>(`/admin/users/${u.id}/reset-lockout`, {})
      );
      this.users.update(list => list.map(x => x.id === updated.id ? updated : x));
      this.toast.success(`Lockout cleared for ${u.username}`);
    } catch {
      this.toast.error('Could not reset lockout');
    } finally {
      this.unlockingId.set(null);
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const params: Record<string, string | number | undefined> = {
        limit: PAGE_SIZE, offset: this.offset(),
      };
      if (this.filterQuery())  params['q']        = this.filterQuery();
      if (this.filterRole())   params['role']      = this.filterRole();
      if (this.filterLocked()) params['isLocked']  = this.filterLocked();

      const res = await firstValueFrom(
        this.api.get<AdminUserListResponse>('/admin/users', params)
      );
      this.users.set(res.data);
      this.total.set(res.total);
    } catch {
      this.users.set([]);
      this.total.set(0);
    } finally {
      this.loading.set(false);
    }
  }
}
