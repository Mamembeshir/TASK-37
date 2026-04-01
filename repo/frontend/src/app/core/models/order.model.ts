// ── Cart ──────────────────────────────────────────────────────────────────────

export interface CartItem {
  id: string;
  productId: string;
  productName: string;
  price: string;     // numeric(10,2) string
  qty: number;
  reservedAt: string;
}

export interface CartDetail {
  id: string;
  customerId: string;
  status: string;
  expiresAt: string;
  secondsRemaining: number;
  items: CartItem[];
  createdAt: string;
  updatedAt: string;
}

// ── Order ─────────────────────────────────────────────────────────────────────

export interface OrderSummary {
  id: string;
  customerId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  qty: number;
  unitPrice: string;
  cancelledAt: string | null;
  cancellationReason: string | null;
  pickupGroupId: string | null;
}

export interface TenderSplit {
  id: string;
  method: 'cash' | 'card';
  amount: string;
  reference: string | null;
  createdAt: string;
}

export interface PickupGroupItem {
  orderItemId: string;
  assignedAt: string;
}

export interface PickupGroup {
  id: string;
  department: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  items: PickupGroupItem[];
}

export interface OrderDetail {
  id: string;
  customerId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
  pickupGroups: PickupGroup[];
  tenderSplits: TenderSplit[];
}

export interface CreateOrderResponse {
  id: string;
  customerId: string;
  status: string;
  pickupCode: string;   // exactly 6 digits, shown ONCE
  items: OrderItem[];
  createdAt: string;
  updatedAt: string;
}

// ── Order status helpers ──────────────────────────────────────────────────────

export const ORDER_STATUS_LABEL: Record<string, string> = {
  pending:          'Pending Payment',
  confirmed:        'Payment Confirmed',
  ready_for_pickup: 'Ready for Pickup',
  picked_up:        'Picked Up',
  pickup_locked:    'Pickup Locked',
  cancelled:        'Cancelled',
};

export const ORDER_STATUS_BADGE: Record<string, string> = {
  pending:          'bg-[#c4832a]/10 border-[#c4832a]/20 text-[#c4832a]',
  confirmed:        'bg-sky-50 border-sky-200 text-sky-700',
  ready_for_pickup: 'bg-[#c4832a]/10 border-[#c4832a]/20 text-[#c4832a]',
  picked_up:        'bg-zinc-100 border-zinc-300 text-zinc-700',
  pickup_locked:    'bg-red-500/10 border-red-500/20 text-red-700',
  cancelled:        'bg-red-50 border-red-300 text-red-500',
};
