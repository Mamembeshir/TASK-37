import { Component, Input, Output, EventEmitter, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { OrderService } from '../../core/services/order.service';
import { ToastService } from '../../core/services/toast.service';
import type { OrderDetail, OrderItem, PickupGroup } from '../../core/models/order.model';

const DEPT_OPTIONS = [
  'front_desk',
  'fulfillment',
  'warehouse',
  'accounting',
  'returns',
];

@Component({
  selector: 'app-pickup-group-editor',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-zinc-700">Pickup Groups</h3>
        <button type="button"
          class="text-xs text-[#c4832a] hover:text-[#c4832a] transition-colors
                 flex items-center gap-1"
          (click)="showNewGroupForm = !showNewGroupForm">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New group
        </button>
      </div>

      <!-- Create group form -->
      @if (showNewGroupForm) {
        <div class="flex items-center gap-2 animate-scale-in">
          <select class="input-field flex-1 py-2 text-sm cursor-pointer" [(ngModel)]="newDept">
            @for (d of deptOptions; track d) {
              <option [value]="d">{{ d }}</option>
            }
          </select>
          <input type="text" class="input-field flex-1 py-2 text-sm" placeholder="or type department…"
                 [(ngModel)]="customDept" />
          <button type="button"
            class="btn-primary py-2 px-3 text-sm flex items-center gap-1.5
                   disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
            [disabled]="creating()"
            (click)="createGroup()">
            @if (creating()) {
              <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
              </svg>
            } @else {
              Create
            }
          </button>
        </div>
      }

      <!-- Existing groups -->
      @if (order.pickupGroups.length === 0 && unassignedItems().length === 0) {
        <p class="text-xs text-zinc-800">No pickup groups yet.</p>
      }

      @for (group of order.pickupGroups; track group.id) {
        <div class="rounded-xl border border-zinc-200 bg-zinc-50 p-3 space-y-2">
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold text-zinc-700 uppercase tracking-wider">{{ group.department }}</span>
            <span class="badge badge-slate text-[9px]">{{ group.status }}</span>
            <span class="text-xs text-zinc-800 ml-auto">{{ group.items.length }} item{{ group.items.length === 1 ? '' : 's' }}</span>
          </div>
          <ul class="space-y-1">
            @for (gi of group.items; track gi.orderItemId) {
              @let name = itemName(gi.orderItemId);
              <li class="text-xs text-zinc-700 flex items-center gap-1.5">
                <svg class="w-3 h-3 text-amber-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" />
                </svg>
                {{ name }}
              </li>
            }
          </ul>
        </div>
      }

      <!-- Unassigned items -->
      @if (unassignedItems().length > 0) {
        <div class="rounded-xl border border-amber-500/15 bg-[#c4832a]/5 p-3 space-y-2">
          <p class="text-xs font-semibold text-[#c4832a] uppercase tracking-wider">
            Unassigned ({{ unassignedItems().length }})
          </p>
          @for (item of unassignedItems(); track item.id) {
            <div class="flex items-center gap-2">
              <span class="text-xs text-zinc-700 flex-1 truncate">
                {{ item.productName }} ×{{ item.qty }}
              </span>
              @if (order.pickupGroups.length > 0) {
                <select class="input-field py-1 text-xs w-36 cursor-pointer"
                        [ngModel]="''"
                        (ngModelChange)="assignItem(item.id, $event)">
                  <option value="" disabled>Assign to…</option>
                  @for (g of order.pickupGroups; track g.id) {
                    <option [value]="g.id">{{ g.department }}</option>
                  }
                </select>
              } @else {
                <span class="text-xs text-zinc-800">Create a group first</span>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class PickupGroupEditorComponent {
  @Input({ required: true }) order!: OrderDetail;
  @Output() changed = new EventEmitter<void>();

  private readonly orderSvc = inject(OrderService);
  private readonly toast    = inject(ToastService);

  readonly creating = signal(false);
  readonly assigning = signal<string | null>(null);

  showNewGroupForm = false;
  newDept = DEPT_OPTIONS[0];
  customDept = '';
  readonly deptOptions = DEPT_OPTIONS;

  unassignedItems() {
    const assignedIds = new Set(
      this.order.pickupGroups.flatMap((g) => g.items.map((i) => i.orderItemId)),
    );
    return this.order.items.filter((i) => !assignedIds.has(i.id) && !i.cancelledAt);
  }

  itemName(orderItemId: string): string {
    const item = this.order.items.find((i) => i.id === orderItemId);
    return item ? `${item.productName} ×${item.qty}` : orderItemId.slice(0, 8);
  }

  async createGroup(): Promise<void> {
    const dept = (this.customDept.trim() || this.newDept).trim();
    if (!dept) return;
    this.creating.set(true);
    try {
      await firstValueFrom(this.orderSvc.createPickupGroup(this.order.id, dept));
      this.toast.success(`Group "${dept}" created`);
      this.showNewGroupForm = false;
      this.customDept = '';
      this.changed.emit();
    } catch {
      this.toast.error('Could not create pickup group');
    } finally {
      this.creating.set(false);
    }
  }

  async assignItem(orderItemId: string, pickupGroupId: string): Promise<void> {
    if (!pickupGroupId || this.assigning() === orderItemId) return;
    this.assigning.set(orderItemId);
    try {
      await firstValueFrom(this.orderSvc.assignItemToGroup(orderItemId, pickupGroupId));
      const group = this.order.pickupGroups.find((g) => g.id === pickupGroupId);
      this.toast.success(`Item assigned to ${group?.department ?? 'group'}`);
      this.changed.emit();
    } catch {
      this.toast.error('Could not assign item');
    } finally {
      this.assigning.set(null);
    }
  }
}
