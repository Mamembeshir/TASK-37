import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import type { Ticket } from '../models/ticket.model';

export interface CreateTicketBody {
  orderId: string;
  type: 'return' | 'refund' | 'price_adjustment';
  receiptReference?: string;
}

export interface ResolveBody {
  outcome: 'approved' | 'rejected' | 'adjusted';
  note?: string;
  adjustmentAmount?: number;
}

@Injectable({ providedIn: 'root' })
export class TicketService {
  private readonly api = inject(ApiService);

  // ── Customer endpoints ─────────────────────────────────────────────────────

  list(limit = 20, offset = 0): Observable<{ data: Ticket[]; total: number; limit: number; offset: number }> {
    return this.api.get('/tickets', { limit, offset });
  }

  get(id: string): Observable<Ticket> {
    return this.api.get<Ticket>(`/tickets/${id}`);
  }

  create(body: CreateTicketBody): Observable<Ticket> {
    return this.api.post<Ticket>('/tickets', body);
  }

  // ── Associate / staff queue ────────────────────────────────────────────────

  /** GET /associate/tickets — active ticket queue, optional dept filter. */
  listQueue(params: {
    limit?: number;
    offset?: number;
    department?: string;
  } = {}): Observable<{ data: Ticket[]; total: number; limit: number; offset: number }> {
    const { limit = 20, offset = 0, department } = params;
    return this.api.get('/associate/tickets', {
      limit,
      offset,
      ...(department ? { department } : {}),
    });
  }

  // ── Ticket lifecycle actions ───────────────────────────────────────────────

  checkin(ticketId: string, note?: string): Observable<Ticket> {
    return this.api.post<Ticket>(`/tickets/${ticketId}/checkin`, { note });
  }

  triage(ticketId: string, body: { department?: string; note?: string }): Observable<Ticket> {
    return this.api.post<Ticket>(`/tickets/${ticketId}/triage`, body);
  }

  interrupt(ticketId: string, note?: string): Observable<Ticket> {
    return this.api.post<Ticket>(`/tickets/${ticketId}/interrupt`, { note });
  }

  resolve(ticketId: string, body: ResolveBody): Observable<Ticket> {
    return this.api.post<Ticket>(`/tickets/${ticketId}/resolve`, body);
  }
}
