import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import type { Product, ProductListResponse } from '../../../core/models/product.model';

const PAGE_SIZE = 20;

interface ProductForm {
  name: string;
  description: string;
  brand: string;
  price: string;
  stockQty: number | '';
  category: string;
}

type FormMode = 'create' | 'edit';

const EMPTY_FORM = (): ProductForm => ({
  name: '', description: '', brand: '', price: '', stockQty: '', category: '',
});

@Component({
  selector: 'app-admin-products',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-6 animate-fade-in">

      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-zinc-900">Products</h1>
          <p class="text-sm text-zinc-700 mt-0.5">Manage the product catalog &mdash; create, edit, or archive listings</p>
        </div>
        <button type="button" class="btn-primary py-2 px-4 text-sm flex items-center gap-2"
                (click)="openCreate()">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Product
        </button>
      </div>

      <!-- Filters -->
      <div class="flex flex-wrap gap-3">
        <input type="text" class="input-field w-52 py-2 text-sm" placeholder="Search by name or brand"
               [ngModel]="filterQuery()" (ngModelChange)="onFilterChange($event)" />
        <select class="input-field w-40 py-2 text-sm cursor-pointer"
                [ngModel]="filterActive()" (ngModelChange)="onActiveChange($event)">
          <option value="">All statuses</option>
          <option value="true">Active only</option>
          <option value="false">Archived only</option>
        </select>
      </div>

      <!-- Create / Edit panel -->
      @if (showForm()) {
        <div class="card p-6 border-[#c4832a]/20 bg-[#c4832a]/5 animate-scale-in space-y-4">
          <h2 class="text-base font-semibold text-zinc-900">
            {{ formMode() === 'create' ? 'New Product' : 'Edit Product' }}
          </h2>

          @if (formError()) {
            <div class="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10
                        border border-red-500/30 text-sm text-red-300">
              <svg class="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor"
                   stroke-width="1.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round"
                      d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
              {{ formError() }}
            </div>
          }

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div class="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
              <label class="text-xs text-zinc-700 font-medium">Product name *</label>
              <input type="text" class="input-field py-2 text-sm" placeholder="e.g. Premium Wireless Headphones"
                     [(ngModel)]="form.name" />
            </div>
            <div class="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
              <label class="text-xs text-zinc-700 font-medium">Description</label>
              <textarea class="input-field py-2 text-sm resize-none" rows="2"
                        placeholder="Optional product description"
                        [(ngModel)]="form.description"></textarea>
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-zinc-700 font-medium">Brand</label>
              <input type="text" class="input-field py-2 text-sm" placeholder="e.g. Sony"
                     [(ngModel)]="form.brand" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-zinc-700 font-medium">Price *</label>
              <input type="number" min="0" step="0.01" class="input-field py-2 text-sm"
                     placeholder="0.00" [(ngModel)]="form.price" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-zinc-700 font-medium">Stock qty *</label>
              <input type="number" min="0" step="1" class="input-field py-2 text-sm"
                     placeholder="0" [(ngModel)]="form.stockQty" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-zinc-700 font-medium">Category</label>
              <input type="text" class="input-field py-2 text-sm" placeholder="e.g. Electronics"
                     [(ngModel)]="form.category" />
            </div>
          </div>

          <div class="flex items-center gap-3 pt-2">
            <button type="button"
                    class="btn-primary py-2 px-5 text-sm flex items-center gap-2
                           disabled:opacity-50 disabled:cursor-not-allowed
                           disabled:transform-none disabled:shadow-none"
                    [disabled]="saving()"
                    (click)="submitForm()">
              @if (saving()) {
                <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10"
                          stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor"
                        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                </svg>
                Saving...
              } @else {
                {{ formMode() === 'create' ? 'Create' : 'Save changes' }}
              }
            </button>
            <button type="button" class="btn-secondary py-2 px-4 text-sm" (click)="closeForm()">
              Cancel
            </button>
          </div>
        </div>
      }

      <!-- Delete confirmation -->
      @if (deleteTarget()) {
        <div class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div class="card max-w-sm w-full p-6 space-y-4 animate-scale-in">
            <div class="flex items-start gap-3">
              <div class="w-9 h-9 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
                <svg class="w-4 h-4 text-red-400" fill="none" stroke="currentColor"
                     stroke-width="1.75" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round"
                        d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21
                           c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25
                           2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772
                           5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562
                           c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397
                           m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0
                           0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667
                           48.667 0 0 0-7.5 0" />
                </svg>
              </div>
              <div>
                <p class="text-sm font-semibold text-zinc-900">Archive product?</p>
                <p class="text-xs text-zinc-700 mt-1">
                  "{{ deleteTarget()!.name }}" will be hidden from the catalog.
                  This can be undone by re-activating it.
                </p>
              </div>
            </div>
            <div class="flex items-center gap-3 justify-end">
              <button type="button" class="btn-secondary py-2 px-4 text-sm"
                      (click)="deleteTarget.set(null)">
                Cancel
              </button>
              <button type="button"
                      class="py-2 px-4 text-sm font-semibold rounded-xl
                             bg-red-500/10 border border-red-500/20 text-red-300
                             hover:bg-red-500/20 transition-colors
                             disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      [disabled]="deleting()"
                      (click)="confirmDelete()">
                @if (deleting()) {
                  <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10"
                            stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor"
                          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                  </svg>
                  Archiving...
                } @else {
                  Archive
                }
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Loading skeletons -->
      @if (loading()) {
        <div class="space-y-2">
          @for (_ of skeletons; track $index) {
            <div class="card p-4 flex gap-4 items-center">
              <div class="shimmer h-4 w-40 rounded"></div>
              <div class="shimmer h-4 w-24 rounded"></div>
              <div class="shimmer h-4 w-16 rounded ml-auto"></div>
            </div>
          }
        </div>
      }

      <!-- Table -->
      @if (!loading() && products().length > 0) {
        <div class="card overflow-hidden p-0">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-zinc-200 bg-zinc-50">
                  <th class="text-left px-4 py-3 text-xs font-semibold text-zinc-700 uppercase tracking-wider">Name</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-zinc-700 uppercase tracking-wider">Brand</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-zinc-700 uppercase tracking-wider">Category</th>
                  <th class="text-right px-4 py-3 text-xs font-semibold text-zinc-700 uppercase tracking-wider">Price</th>
                  <th class="text-right px-4 py-3 text-xs font-semibold text-zinc-700 uppercase tracking-wider">Stock</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-zinc-700 uppercase tracking-wider">Status</th>
                  <th class="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-zinc-200">
                @for (p of products(); track p.id) {
                  <tr class="hover:bg-zinc-50 transition-colors">
                    <td class="px-4 py-3">
                      <span class="font-medium text-zinc-800">{{ p.name }}</span>
                    </td>
                    <td class="px-4 py-3 text-zinc-700 text-xs">{{ p.brand ?? '-' }}</td>
                    <td class="px-4 py-3 text-zinc-700 text-xs">{{ p.category ?? '-' }}</td>
                    <td class="px-4 py-3 text-right font-mono text-zinc-700">{{ '$' + p.price }}</td>
                    <td class="px-4 py-3 text-right">
                      <span [class]="p.stockQty === 0
                        ? 'text-red-400 font-semibold'
                        : p.stockQty <= 5
                          ? 'text-[#c4832a] font-semibold'
                          : 'text-zinc-700'">
                        {{ p.stockQty }}
                      </span>
                    </td>
                    <td class="px-4 py-3">
                      @if (p.isActive) {
                        <span class="badge badge-green">Active</span>
                      } @else {
                        <span class="badge badge-slate">Archived</span>
                      }
                    </td>
                    <td class="px-4 py-3">
                      <div class="flex items-center justify-end gap-2">
                        <button type="button"
                                class="text-xs text-zinc-700 hover:text-zinc-800 transition-colors
                                       px-2 py-1 rounded border border-transparent hover:border-zinc-200"
                                (click)="openEdit(p)">
                          Edit
                        </button>
                        @if (p.isActive) {
                          <button type="button"
                                  class="text-xs text-red-500 hover:text-red-300 transition-colors
                                         px-2 py-1 rounded border border-transparent hover:border-red-500/20"
                                  (click)="deleteTarget.set(p)">
                            Archive
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
                Showing {{ offset() + 1 }}&ndash;{{ min(offset() + products().length, total()) }}
                of {{ total() }}
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
      @if (!loading() && products().length === 0) {
        <div class="card p-10 text-center">
          <p class="text-zinc-700">No products found.
            <button type="button" class="text-[#c4832a] hover:underline ml-1" (click)="openCreate()">
              Add the first one.
            </button>
          </p>
        </div>
      }
    </div>
  `,
})
export class AdminProductsComponent implements OnInit {
  private readonly api   = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly loading     = signal(true);
  readonly products    = signal<Product[]>([]);
  readonly total       = signal(0);
  readonly offset      = signal(0);
  readonly showForm    = signal(false);
  readonly formMode    = signal<FormMode>('create');
  readonly saving      = signal(false);
  readonly formError   = signal<string | null>(null);
  readonly deleteTarget = signal<Product | null>(null);
  readonly deleting    = signal(false);
  readonly filterQuery = signal('');
  readonly filterActive = signal('');

  readonly PAGE_SIZE = PAGE_SIZE;
  readonly skeletons = Array(5);

  private editingId: string | null = null;
  form: ProductForm = EMPTY_FORM();

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  onFilterChange(v: string): void { this.filterQuery.set(v); this.offset.set(0); void this.load(); }
  onActiveChange(v: string): void { this.filterActive.set(v); this.offset.set(0); void this.load(); }

  prevPage(): void { this.offset.set(Math.max(0, this.offset() - PAGE_SIZE)); void this.load(); }
  nextPage(): void { this.offset.set(this.offset() + PAGE_SIZE); void this.load(); }
  min(a: number, b: number): number { return Math.min(a, b); }

  openCreate(): void {
    this.editingId = null;
    this.form = EMPTY_FORM();
    this.formError.set(null);
    this.formMode.set('create');
    this.showForm.set(true);
  }

  openEdit(p: Product): void {
    this.editingId = p.id;
    this.form = {
      name: p.name, description: p.description ?? '', brand: p.brand ?? '',
      price: p.price, stockQty: p.stockQty, category: p.category ?? '',
    };
    this.formError.set(null);
    this.formMode.set('edit');
    this.showForm.set(true);
  }

  closeForm(): void { this.showForm.set(false); this.formError.set(null); }

  async submitForm(): Promise<void> {
    const { name, price, stockQty } = this.form;
    if (!name.trim()) { this.formError.set('Product name is required.'); return; }
    if (!price || isNaN(Number(price)) || Number(price) < 0) {
      this.formError.set('A valid price is required.'); return;
    }
    if (stockQty === '' || isNaN(Number(stockQty)) || Number(stockQty) < 0) {
      this.formError.set('A valid stock quantity is required.'); return;
    }

    this.saving.set(true);
    this.formError.set(null);

    const body = {
      name: this.form.name.trim(),
      description: this.form.description.trim() || null,
      brand: this.form.brand.trim() || null,
      price: this.form.price,
      stockQty: Number(this.form.stockQty),
      category: this.form.category.trim() || null,
    };

    try {
      if (this.formMode() === 'create') {
        const p = await firstValueFrom(this.api.post<Product>('/admin/products', body));
        this.products.update(list => [p, ...list]);
        this.toast.success('Product created');
      } else {
        const p = await firstValueFrom(this.api.put<Product>(`/admin/products/${this.editingId}`, body));
        this.products.update(list => list.map(x => x.id === p.id ? p : x));
        this.toast.success('Product updated');
      }
      this.closeForm();
    } catch (err: unknown) {
      const e = err as HttpErrorResponse;
      const msg: string = (e.error as { error?: string })?.error ?? 'Something went wrong';
      this.formError.set(msg);
    } finally {
      this.saving.set(false);
    }
  }

  async confirmDelete(): Promise<void> {
    const t = this.deleteTarget();
    if (!t) return;
    this.deleting.set(true);
    try {
      await firstValueFrom(this.api.delete(`/admin/products/${t.id}`));
      this.products.update(list => list.map(p => p.id === t.id ? { ...p, isActive: false } : p));
      this.toast.success(`"${t.name}" archived`);
      this.deleteTarget.set(null);
    } catch {
      this.toast.error('Could not archive product');
    } finally {
      this.deleting.set(false);
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const params: Record<string, string | number | undefined> = {
        limit: PAGE_SIZE, offset: this.offset(),
      };
      if (this.filterQuery()) params['q'] = this.filterQuery();
      if (this.filterActive() !== '') params['isActive'] = this.filterActive();

      const res = await firstValueFrom(
        this.api.get<ProductListResponse>('/admin/products', params)
      );
      this.products.set(res.data);
      this.total.set(res.total);
    } catch {
      this.products.set([]);
      this.total.set(0);
    } finally {
      this.loading.set(false);
    }
  }
}
