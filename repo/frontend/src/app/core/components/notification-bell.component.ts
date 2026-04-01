import {
  Component,
  OnInit,
  HostListener,
  ElementRef,
  inject,
  signal,
  computed,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { RouterLink } from '@angular/router';
import { NotificationService } from '../services/notification.service';
import type { Notification } from '../models/notification.model';

@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [RouterLink, NgClass],
  template: `
    <div class="relative">
      <!-- Bell button -->
      <button
        type="button"
        class="relative flex items-center justify-center w-8 h-8 rounded-lg
               text-zinc-700 hover:text-zinc-800 hover:bg-white/5
               border border-transparent hover:border-zinc-200
               transition-all duration-150"
        [ngClass]="open() ? 'text-zinc-800 bg-white/5 border-zinc-200' : ''"
        (click)="toggle()"
        aria-label="Notifications">

        <!-- Bell icon -->
        <svg class="w-4 h-4" fill="none" stroke="currentColor"
             stroke-width="1.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round"
            d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
        </svg>

        <!-- Unread badge -->
        @if (unreadCount() > 0) {
          <span class="absolute -top-0.5 -right-0.5 flex items-center justify-center
                       min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold
                       bg-red-500 text-white leading-none animate-scale-in">
            {{ unreadCount() > 99 ? '99+' : unreadCount() }}
          </span>
        }
      </button>

      <!-- Dropdown -->
      @if (open()) {
        <div
          class="absolute right-0 top-full mt-2 w-80 glass rounded-2xl border border-zinc-200
                 shadow-[0_8px_32px_rgba(0,0,0,0.5)] z-50 overflow-hidden animate-scale-in"
          (click)="$event.stopPropagation()">

          <!-- Header -->
          <div class="flex items-center justify-between px-4 py-3 border-b border-zinc-200">
            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold text-zinc-800">Notifications</span>
              @if (unreadCount() > 0) {
                <span class="text-[10px] px-1.5 py-0.5 rounded-full
                             bg-red-500/15 border border-red-500/25 text-red-300 font-medium">
                  {{ unreadCount() }} unread
                </span>
              }
            </div>
            @if (unreadCount() > 0) {
              <button type="button"
                class="text-[10px] text-zinc-700 hover:text-zinc-700 transition-colors
                       font-medium"
                [disabled]="markingAll()"
                (click)="markAllRead()">
                @if (markingAll()) {
                  <svg class="w-3 h-3 animate-spin inline mr-1" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor"
                            stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                  </svg>
                }
                Mark all read
              </button>
            }
          </div>

          <!-- Notification list -->
          <div class="max-h-[340px] overflow-y-auto overscroll-contain">
            @if (notifSvc.loading()) {
              <div class="px-4 py-6 text-center">
                <svg class="w-4 h-4 animate-spin text-zinc-800 mx-auto" fill="none"
                     viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor"
                          stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                </svg>
              </div>
            } @else if (notifSvc.unread().length === 0) {
              <div class="px-4 py-8 text-center space-y-2">
                <svg class="w-8 h-8 text-zinc-700 mx-auto" fill="none" stroke="currentColor"
                     stroke-width="1.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round"
                    d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                </svg>
                <p class="text-xs text-zinc-800">You're all caught up!</p>
              </div>
            } @else {
              @for (n of notifSvc.unread(); track n.id) {
                <div class="group flex items-start gap-3 px-4 py-3
                            border-b border-zinc-200 last:border-b-0
                            hover:bg-zinc-50 transition-colors">
                  <!-- Icon -->
                  <div class="w-7 h-7 rounded-full bg-[#c4832a]/10 border border-[#c4832a]/20
                              flex items-center justify-center shrink-0 mt-0.5">
                    <svg class="w-3.5 h-3.5 text-[#c4832a]" fill="none" stroke="currentColor"
                         stroke-width="1.5" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round"
                        d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                    </svg>
                  </div>

                  <!-- Content -->
                  <div class="flex-1 min-w-0">
                    <p class="text-xs text-zinc-700 leading-relaxed">{{ n.message }}</p>
                    <div class="flex items-center justify-between mt-1.5">
                      <span class="text-[10px] text-zinc-700">{{ relativeTime(n.createdAt) }}</span>

                      <!-- Entity link -->
                      @if (n.entityType === 'ticket' && n.entityId) {
                        <a [routerLink]="['/tickets', n.entityId]"
                          class="text-[10px] text-sky-700 hover:text-sky-300 transition-colors
                                 font-medium"
                          (click)="open.set(false)">
                          View ticket →
                        </a>
                      }
                    </div>
                  </div>

                  <!-- Mark read button -->
                  <button type="button"
                    class="p-1 rounded-md text-zinc-700 hover:text-zinc-700
                           hover:bg-white/8 transition-colors opacity-0 group-hover:opacity-100
                           shrink-0"
                    [attr.aria-label]="'Dismiss'"
                    (click)="markRead(n)">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor"
                         stroke-width="2" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round"
                        d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              }
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class NotificationBellComponent implements OnInit {
  protected readonly notifSvc = inject(NotificationService);
  private readonly elRef      = inject(ElementRef);

  readonly open       = signal(false);
  readonly markingAll = signal(false);

  readonly unreadCount = computed(() => this.notifSvc.unread().length);

  ngOnInit(): void {
    void this.notifSvc.fetchUnread();
  }

  toggle(): void {
    const wasOpen = this.open();
    this.open.update((v) => !v);
    // Refresh on open
    if (!wasOpen) void this.notifSvc.fetchUnread();
  }

  async markRead(n: Notification): Promise<void> {
    await this.notifSvc.markRead(n.id);
  }

  async markAllRead(): Promise<void> {
    this.markingAll.set(true);
    try {
      await this.notifSvc.markAllRead();
    } finally {
      this.markingAll.set(false);
    }
  }

  relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60)  return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60)  return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24)  return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  }

  /** Close dropdown when clicking outside. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.elRef.nativeElement.contains(event.target)) {
      this.open.set(false);
    }
  }
}
