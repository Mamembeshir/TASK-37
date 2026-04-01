import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import type {
  OrderDetail,
  OrderSummary,
  CreateOrderResponse,
  PickupGroup,
} from '../models/order.model';

export interface TenderBody {
  method: 'cash' | 'card';
  amount: string;
  reference?: string | null;
}

export interface TenderResponse {
  id: string;
  orderId: string;
  method: 'cash' | 'card';
  amount: string;
  reference: string | null;
  createdAt: string;
}

export interface ConfirmResponse {
  id: string;
  status: 'confirmed';
  orderTotalCents: number;
  tenderTotalCents: number;
}

@Injectable({ providedIn: 'root' })
export class OrderService {
  private readonly api = inject(ApiService);

  getOrder(id: string): Observable<OrderDetail> {
    return this.api.get<OrderDetail>(`/orders/${id}`);
  }

  listOrders(limit = 20, offset = 0): Observable<{ data: OrderSummary[]; total: number; limit: number; offset: number }> {
    return this.api.get('/orders', { limit, offset });
  }

  createOrder(): Observable<CreateOrderResponse> {
    return this.api.post<CreateOrderResponse>('/orders', {});
  }

  addTender(orderId: string, tender: TenderBody): Observable<TenderResponse> {
    return this.api.post<TenderResponse>(`/orders/${orderId}/tender`, tender);
  }

  confirmOrder(orderId: string): Observable<ConfirmResponse> {
    return this.api.post<ConfirmResponse>(`/orders/${orderId}/confirm`, {});
  }

  createPickupGroup(orderId: string, department: string): Observable<PickupGroup> {
    return this.api.post<PickupGroup>('/cart/pickup-groups', { orderId, department });
  }

  assignItemToGroup(orderItemId: string, pickupGroupId: string): Observable<unknown> {
    return this.api.put(`/cart/items/${orderItemId}/group`, { pickupGroupId });
  }

  verifyPickupCode(orderId: string, code: string): Observable<{ verified: boolean }> {
    return this.api.post<{ verified: boolean }>(`/orders/${orderId}/pickup/verify`, { code });
  }

  managerOverride(orderId: string, managerUsername: string, managerPassword: string): Observable<{ overridden: true }> {
    return this.api.post<{ overridden: true }>(`/orders/${orderId}/pickup/manager-override`, {
      managerUsername,
      managerPassword,
    });
  }
}
