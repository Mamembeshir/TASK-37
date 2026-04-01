export type TicketType   = 'return' | 'refund' | 'price_adjustment';
export type TicketStatus = 'open' | 'in_progress' | 'pending_inspection' | 'resolved' | 'cancelled';
export type TicketOutcome = 'approved' | 'rejected' | 'adjusted';

export interface TicketEvent {
  id: string;
  ticketId: string;
  actorId: string | null;
  eventType: string;
  note: string | null;
  fromDept: string | null;
  toDept: string | null;
  nodeDurationMs: number | null;
  createdAt: string;
}

export interface Ticket {
  id: string;
  orderId: string;
  customerId: string;
  type: TicketType;
  status: TicketStatus;
  department: string;
  assignedTo: string | null;
  receiptReference: string | null;
  windowDays: number;
  outcome: TicketOutcome | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  events?: TicketEvent[];
}

// ── Display helpers ────────────────────────────────────────────────────────────

export const TICKET_TYPE_LABEL: Record<TicketType, string> = {
  return:           'Return',
  refund:           'Refund',
  price_adjustment: 'Price Adjustment',
};

export const TICKET_STATUS_LABEL: Record<string, string> = {
  open:               'Open',
  in_progress:        'In Progress',
  pending_inspection: 'Pending Inspection',
  resolved:           'Resolved',
  cancelled:          'Cancelled',
};

export const TICKET_STATUS_BADGE: Record<string, string> = {
  open:               'bg-[#c4832a]/10 border-[#c4832a]/20 text-[#c4832a]',
  in_progress:        'bg-sky-50 border-sky-200 text-sky-700',
  pending_inspection: 'bg-violet-500/10 border-violet-500/20 text-violet-700',
  resolved:           'bg-[#c4832a]/10 border-[#c4832a]/20 text-[#c4832a]',
  cancelled:          'bg-zinc-100 border-zinc-300 text-zinc-700',
};

export const TICKET_OUTCOME_BADGE: Record<string, string> = {
  approved: 'bg-[#c4832a]/10 border-[#c4832a]/20 text-[#c4832a]',
  rejected: 'bg-red-500/10 border-red-500/20 text-red-700',
  adjusted: 'bg-[#c4832a]/10 border-[#c4832a]/20 text-[#c4832a]',
};

export const DEPT_LABEL: Record<string, string> = {
  front_desk:  'Front Desk',
  fulfillment: 'Fulfillment',
  accounting:  'Accounting',
  returns:     'Returns',
  warehouse:   'Warehouse',
};

export const EVENT_TYPE_LABEL: Record<string, string> = {
  checked_in: 'Checked In',
  triaged:    'Triaged',
  reassigned: 'Reassigned',
  interrupted:'Interrupted',
  resolved:   'Resolved',
  created:    'Created',
};

export const EVENT_TYPE_ICON: Record<string, string> = {
  checked_in: 'M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  triaged:    'M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z',
  reassigned: 'M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5',
  interrupted:'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z',
  resolved:   'M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z',
  created:    'M12 4.5v15m7.5-7.5h-15',
};

export const EVENT_TYPE_COLOR: Record<string, string> = {
  checked_in: 'text-sky-700 bg-sky-50 border-sky-200',
  triaged:    'text-violet-700 bg-violet-500/10 border-violet-500/20',
  reassigned: 'text-[#c4832a] bg-[#c4832a]/10 border-[#c4832a]/20',
  interrupted:'text-red-700 bg-red-500/10 border-red-500/20',
  resolved:   'text-[#c4832a] bg-[#c4832a]/10 border-[#c4832a]/20',
  created:    'text-zinc-700 bg-zinc-100 border-zinc-300',
};

// ── Duration formatter ─────────────────────────────────────────────────────────

export function formatDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60)  return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60)  return rs > 0 ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}
