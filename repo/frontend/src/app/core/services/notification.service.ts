import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from './api.service';
import type { Notification } from '../models/notification.model';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly api = inject(ApiService);

  /** Live list of unread notifications — updated after fetch and mark-as-read. */
  readonly unread = signal<Notification[]>([]);

  /** True while the initial fetch is running. */
  readonly loading = signal(false);

  /** Fetch unread notifications and update the signal. Silent on error. */
  async fetchUnread(): Promise<void> {
    this.loading.set(true);
    try {
      const items = await firstValueFrom(this.api.get<Notification[]>('/notifications'));
      this.unread.set(items);
    } catch {
      // Non-critical — bell simply shows no badge on failure
    } finally {
      this.loading.set(false);
    }
  }

  /** Mark one notification as read; removes it from the unread signal. */
  async markRead(id: string): Promise<void> {
    try {
      await firstValueFrom(this.api.put(`/notifications/${id}/read`, {}));
      this.unread.update((prev) => prev.filter((n) => n.id !== id));
    } catch (err: unknown) {
      const e = err as HttpErrorResponse;
      if (e.status !== 404) throw e;
    }
  }

  /** Mark every unread notification as read. */
  async markAllRead(): Promise<void> {
    const ids = this.unread().map((n) => n.id);
    await Promise.allSettled(ids.map((id) => this.markRead(id)));
  }
}
