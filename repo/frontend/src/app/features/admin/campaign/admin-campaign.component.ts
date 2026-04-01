import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import type {
  CampaignItem,
  CampaignListResponse,
  CampaignBody,
  Strategy,
} from '../../../core/models/campaign.model';
import { STRATEGY_OPTIONS } from '../../../core/models/campaign.model';

type FormMode = 'create' | 'edit';

interface CampaignForm extends CampaignBody {
  id?: string;
}

const EMPTY_FORM = (): CampaignForm => ({
  storeId:   '',
  variant:   '',
  strategy:  'newest' as Strategy,
  startDate: '',
  endDate:   '',
});

@Component({
  selector: 'app-admin-campaign',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-6 animate-fade-in">

      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-zinc-900">A/B Campaigns</h1>
          <p class="text-sm text-zinc-700 mt-0.5">Manage recommendation test variants per store</p>
        </div>
        <button type="button" class="btn-primary py-2 px-4 text-sm flex items-center gap-2"
                (click)="openCreate()">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Campaign
        </button>
      </div>

      <!-- Filters -->
      <div class="flex flex-wrap gap-3">
        <input type="text" class="input-field w-44 py-2 text-sm" placeholder="Filter by store ID"
               [ngModel]="filterStore()" (ngModelChange)="onFilterStoreChange($event)" />
        <select class="input-field w-44 py-2 text-sm cursor-pointer"
                [ngModel]="filterActive()" (ngModelChange)="onFilterActiveChange($event)">
          <option value="">All statuses</option>
          <option value="true">Active only</option>
          <option value="false">Inactive only</option>
        </select>
      </div>

      <!-- Create / Edit form (inline panel) -->
      @if (showForm()) {
        <div class="card p-6 border-[#c4832a]/20 bg-[#c4832a]/5 animate-scale-in space-y-4">
          <h2 class="text-base font-semibold text-zinc-900">
            {{ formMode() === 'create' ? 'New Campaign' : 'Edit Campaign' }}
          </h2>

          <!-- Overlap error -->
          @if (formError()) {
            <div class="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
              <svg class="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
              {{ formError() }}
            </div>
          }

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <!-- Store ID -->
            <div class="flex flex-col gap-1">
              <label class="text-xs text-zinc-700 font-medium">Store ID *</label>
              <input type="text" class="input-field py-2 text-sm" placeholder="e.g. store-1"
                     [(ngModel)]="form.storeId" required />
            </div>

            <!-- Variant label -->
            <div class="flex flex-col gap-1">
              <label class="text-xs text-zinc-700 font-medium">Variant label *</label>
              <input type="text" class="input-field py-2 text-sm" placeholder="e.g. A, B, Control"
                     [(ngModel)]="form.variant" required />
            </div>

            <!-- Strategy -->
            <div class="flex flex-col gap-1">
              <label class="text-xs text-zinc-700 font-medium">Ranking strategy *</label>
              <select class="input-field py-2 text-sm cursor-pointer" [(ngModel)]="form.strategy">
                @for (opt of strategyOptions; track opt.value) {
                  <option [value]="opt.value">{{ opt.label }}</option>
                }
              </select>
            </div>

            <!-- Start date -->
            <div class="flex flex-col gap-1">
              <label class="text-xs text-zinc-700 font-medium">Start date *</label>
              <input type="date" class="input-field py-2 text-sm"
                     [(ngModel)]="form.startDate" required />
            </div>

            <!-- End date -->
            <div class="flex flex-col gap-1">
              <label class="text-xs text-zinc-700 font-medium">End date *</label>
              <input type="date" class="input-field py-2 text-sm"
                     [(ngModel)]="form.endDate" required />
            </div>
          </div>

          <div class="flex items-center gap-3 pt-2">
            <button type="button" class="btn-primary py-2 px-5 text-sm
                                         disabled:opacity-50 disabled:cursor-not-allowed
                                         disabled:transform-none disabled:shadow-none flex items-center gap-2"
                    [disabled]="saving()"
                    (click)="submitForm()">
              @if (saving()) {
                <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                </svg>
                Saving…
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

      <!-- Loading -->
      @if (loading()) {
        <div class="space-y-3">
          @for (_ of skeletons; track $index) {
            <div class="card p-4 flex gap-4">
              <div class="shimmer h-5 w-24 rounded"></div>
              <div class="shimmer h-5 w-20 rounded"></div>
              <div class="shimmer h-5 w-32 rounded ml-auto"></div>
            </div>
          }
        </div>
      }

      <!-- Table -->
      @if (!loading() && campaigns().length > 0) {
        <div class="card overflow-hidden p-0">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-zinc-200 bg-zinc-50">
                  <th class="text-left px-4 py-3 text-xs font-semibold text-zinc-700 uppercase tracking-wider">Store</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-zinc-700 uppercase tracking-wider">Variant</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-zinc-700 uppercase tracking-wider">Strategy</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-zinc-700 uppercase tracking-wider">Period</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-zinc-700 uppercase tracking-wider">Status</th>
                  <th class="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-zinc-200">
                @for (c of campaigns(); track c.id) {
                  <tr class="hover:bg-zinc-50 transition-colors">
                    <td class="px-4 py-3 font-mono text-xs text-zinc-700">{{ c.storeId }}</td>
                    <td class="px-4 py-3">
                      <span class="font-semibold text-zinc-800">Test {{ c.variant }}</span>
                    </td>
                    <td class="px-4 py-3 text-zinc-700 capitalize">{{ c.strategy }}</td>
                    <td class="px-4 py-3 text-zinc-700 text-xs whitespace-nowrap">
                      {{ c.startDate }} → {{ c.endDate }}
                    </td>
                    <td class="px-4 py-3">
                      @if (c.isCurrentlyActive) {
                        <span class="badge badge-green">Live now</span>
                      } @else if (c.isActive) {
                        <span class="badge badge-slate">Scheduled</span>
                      } @else {
                        <span class="badge badge-red">Inactive</span>
                      }
                    </td>
                    <td class="px-4 py-3">
                      <div class="flex items-center justify-end gap-2">
                        <button type="button"
                                class="text-xs text-zinc-700 hover:text-zinc-800 transition-colors px-2 py-1
                                       rounded border border-transparent hover:border-zinc-200"
                                (click)="openEdit(c)">
                          Edit
                        </button>
                        @if (c.isActive) {
                          <button type="button"
                                  class="text-xs text-red-500 hover:text-red-300 transition-colors px-2 py-1
                                         rounded border border-transparent hover:border-red-500/20
                                         disabled:opacity-40 disabled:cursor-not-allowed"
                                  [disabled]="deactivatingId() === c.id"
                                  (click)="deactivate(c)">
                            @if (deactivatingId() === c.id) { Deactivating… } @else { Deactivate }
                          </button>
                        }
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }

      <!-- Empty -->
      @if (!loading() && campaigns().length === 0) {
        <div class="card p-10 text-center">
          <p class="text-zinc-700">No campaigns found.
            <button type="button" class="text-[#c4832a] hover:underline ml-1" (click)="openCreate()">
              Create one.
            </button>
          </p>
        </div>
      }
    </div>
  `,
})
export class AdminCampaignComponent implements OnInit {
  private readonly api   = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly loading       = signal(true);
  readonly campaigns     = signal<CampaignItem[]>([]);
  readonly showForm      = signal(false);
  readonly formMode      = signal<FormMode>('create');
  readonly saving        = signal(false);
  readonly formError     = signal<string | null>(null);
  readonly deactivatingId = signal<string | null>(null);
  readonly filterStore   = signal('');
  readonly filterActive  = signal('');

  readonly strategyOptions = STRATEGY_OPTIONS;
  readonly skeletons = Array(4);

  form: CampaignForm = EMPTY_FORM();

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  onFilterStoreChange(v: string): void  { this.filterStore.set(v); void this.load(); }
  onFilterActiveChange(v: string): void { this.filterActive.set(v); void this.load(); }

  openCreate(): void {
    this.form = EMPTY_FORM();
    this.formError.set(null);
    this.formMode.set('create');
    this.showForm.set(true);
  }

  openEdit(c: CampaignItem): void {
    this.form = { id: c.id, storeId: c.storeId, variant: c.variant, strategy: c.strategy, startDate: c.startDate, endDate: c.endDate };
    this.formError.set(null);
    this.formMode.set('edit');
    this.showForm.set(true);
  }

  closeForm(): void { this.showForm.set(false); this.formError.set(null); }

  async submitForm(): Promise<void> {
    const { storeId, variant, strategy, startDate, endDate } = this.form;
    if (!storeId || !variant || !startDate || !endDate) {
      this.formError.set('All fields are required.');
      return;
    }
    if (endDate < startDate) {
      this.formError.set('End date must be on or after start date.');
      return;
    }

    this.saving.set(true);
    this.formError.set(null);

    const body: CampaignBody = { storeId, variant, strategy, startDate, endDate };

    try {
      if (this.formMode() === 'create') {
        await firstValueFrom(this.api.post<CampaignItem>('/admin/campaigns', body));
        this.toast.success('Campaign created');
      } else {
        await firstValueFrom(this.api.put<CampaignItem>(`/admin/campaigns/${this.form.id}`, body));
        this.toast.success('Campaign updated');
      }
      this.closeForm();
      await this.load();
    } catch (err: unknown) {
      const e = err as HttpErrorResponse;
      if (e.status === 409) {
        this.formError.set('An active campaign for this store already overlaps the selected date range.');
      } else {
        const msg: string = (e.error as { error?: string })?.error ?? 'Something went wrong';
        this.formError.set(msg);
      }
    } finally {
      this.saving.set(false);
    }
  }

  async deactivate(c: CampaignItem): Promise<void> {
    this.deactivatingId.set(c.id);
    try {
      await firstValueFrom(this.api.delete(`/admin/campaigns/${c.id}`));
      this.toast.success(`Campaign "${c.variant}" deactivated`);
      await this.load();
    } catch {
      this.toast.error('Could not deactivate campaign');
    } finally {
      this.deactivatingId.set(null);
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const params: Record<string, string | number | boolean | undefined | null> = { limit: 50, offset: 0 };
      if (this.filterStore()) params['storeId']  = this.filterStore();
      if (this.filterActive()) params['isActive'] = this.filterActive();

      const res = await firstValueFrom(this.api.get<CampaignListResponse>('/admin/campaigns', params));
      this.campaigns.set(res.data);
    } catch {
      this.campaigns.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
