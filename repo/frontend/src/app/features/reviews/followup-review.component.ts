import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  inject,
  signal,
  computed,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ReviewService } from '../../core/services/review.service';
import { ToastService } from '../../core/services/toast.service';
import {
  validateImageFiles,
  formatBytes,
  MAX_IMAGES,
  type ImageValidationError,
  type Review,
} from '../../core/models/review.model';

const FOLLOWUP_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

@Component({
  selector: 'app-followup-review',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (!withinWindow()) {
      <!-- Outside 14-day window -->
      <div class="glass rounded-2xl border border-zinc-200 p-5">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-zinc-800 border border-zinc-200
                      flex items-center justify-center shrink-0">
            <svg class="w-4 h-4 text-zinc-800" fill="none" stroke="currentColor"
                 stroke-width="1.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </div>
          <div>
            <p class="text-sm font-medium text-zinc-700">Follow-up window closed</p>
            <p class="text-xs text-zinc-800 mt-0.5">
              The 14-day window for follow-up reviews expired on
              {{ windowExpiry() }}.
            </p>
          </div>
        </div>
      </div>
    } @else {
      <!-- Follow-up form -->
      <div class="glass rounded-2xl border border-violet-500/20 p-6 space-y-5
                  shadow-[0_0_20px_rgba(139,92,246,0.05)]">
        <!-- Header -->
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl bg-violet-500/10 flex items-center justify-center shrink-0">
              <svg class="w-4 h-4 text-violet-400" fill="none" stroke="currentColor"
                   stroke-width="1.75" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round"
                  d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
              </svg>
            </div>
            <div>
              <h3 class="text-sm font-semibold text-zinc-900">Add a Follow-up</h3>
              <p class="text-xs text-zinc-700">Update your review with new information</p>
            </div>
          </div>
          <!-- Window countdown -->
          <div class="text-right shrink-0">
            <p class="text-[10px] text-zinc-800">Window closes</p>
            <p class="text-xs font-medium"
               [class]="daysRemaining() <= 2 ? 'text-[#c4832a]' : 'text-zinc-700'">
              {{ daysRemaining() }}d {{ hoursRemaining() }}h left
            </p>
          </div>
        </div>

        <!-- Follow-up body -->
        <div class="space-y-1.5">
          <label class="text-xs font-medium text-zinc-700">Your follow-up</label>
          <textarea
            class="input-field text-sm resize-none min-h-[80px] leading-relaxed"
            placeholder="What changed since your original review? Update your experience…"
            [(ngModel)]="bodyText"
            (input)="apiError.set(null)"
            maxlength="2000"
            rows="3">
          </textarea>
          <div class="flex justify-end">
            <span class="text-[10px]"
                  [class]="bodyText.length > 1800 ? 'text-[#c4832a]' : 'text-zinc-700'">
              {{ bodyText.length }} / 2000
            </span>
          </div>
        </div>

        <!-- Image upload -->
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <label class="text-xs font-medium text-zinc-700">
              Photos
              <span class="text-zinc-800 font-normal ml-1">(optional)</span>
            </label>
            <span class="text-[10px] text-zinc-800">{{ selectedFiles().length }} / {{ MAX_IMAGES }}</span>
          </div>

          <label
            class="relative flex items-center justify-center gap-2 rounded-xl
                   border border-dashed border-zinc-700/60 py-4 px-4
                   cursor-pointer transition-all duration-200 hover:border-zinc-500">
            <input
              type="file"
              accept="image/jpeg,image/png"
              multiple
              class="sr-only"
              (change)="onFileChange($event)"
            />
            <svg class="w-4.5 h-4.5 text-zinc-800" fill="none" stroke="currentColor"
                 stroke-width="1.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>
            <span class="text-xs text-zinc-700">
              <span class="text-zinc-700 font-medium">Upload photos</span>
              · JPEG/PNG · max 5 MB
            </span>
          </label>

          @if (validationErrors().length > 0) {
            <div class="space-y-1">
              @for (e of validationErrors(); track e.file.name) {
                <p class="text-xs text-red-400 flex items-center gap-1.5">
                  <svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor"
                       stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                  {{ e.error }}
                </p>
              }
            </div>
          }

          @if (selectedFiles().length > 0) {
            <ul class="space-y-1">
              @for (f of selectedFiles(); track f.name; let i = $index) {
                <li class="flex items-center gap-2 px-3 py-1.5 rounded-lg
                           bg-zinc-50 border border-zinc-200 text-xs">
                  <svg class="w-3.5 h-3.5 text-zinc-700 shrink-0" fill="none"
                       stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round"
                      d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159" />
                  </svg>
                  <span class="text-zinc-700 truncate flex-1">{{ f.name }}</span>
                  <span class="text-zinc-800 shrink-0">{{ formatBytes(f.size) }}</span>
                  <button type="button"
                    class="text-zinc-800 hover:text-red-400 transition-colors ml-1"
                    (click)="removeFile(i)">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor"
                         stroke-width="2" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round"
                        d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              }
            </ul>
          }
        </div>

        <!-- API error -->
        @if (apiError()) {
          <div class="flex items-center gap-2 px-3 py-2 rounded-lg
                      bg-red-500/10 border border-red-500/25 text-xs text-red-300">
            {{ apiError() }}
          </div>
        }

        <!-- Submit -->
        <button type="button"
          class="w-full py-2.5 text-sm rounded-xl font-medium transition-all duration-200
                 flex items-center justify-center gap-2
                 bg-violet-600 hover:bg-violet-500 text-white
                 shadow-[0_0_12px_rgba(139,92,246,0.25)] hover:shadow-[0_0_16px_rgba(139,92,246,0.35)]
                 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
          [disabled]="!bodyText.trim() || submitting()"
          (click)="submit()">
          @if (submitting()) {
            <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10"
                      stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
            </svg>
            Submitting…
          } @else {
            Submit Follow-up
          }
        </button>
      </div>
    }
  `,
})
export class FollowUpReviewComponent implements OnInit {
  @Input({ required: true }) parentReview!: Review;
  @Output() submitted = new EventEmitter<Review>();

  private readonly reviewSvc = inject(ReviewService);
  private readonly toast      = inject(ToastService);

  readonly submitting       = signal(false);
  readonly apiError         = signal<string | null>(null);
  readonly selectedFiles    = signal<File[]>([]);
  readonly validationErrors = signal<ImageValidationError[]>([]);

  /** ms remaining until window closes */
  private readonly msRemaining = signal(0);

  readonly withinWindow  = computed(() => this.msRemaining() > 0);
  readonly daysRemaining  = computed(() => Math.floor(this.msRemaining() / (24 * 3600 * 1000)));
  readonly hoursRemaining = computed(() =>
    Math.floor((this.msRemaining() % (24 * 3600 * 1000)) / 3600_000),
  );

  readonly MAX_IMAGES = MAX_IMAGES;
  readonly formatBytes = formatBytes;

  bodyText = '';

  ngOnInit(): void {
    const submitted = new Date(this.parentReview.submittedAt).getTime();
    const remaining = submitted + FOLLOWUP_WINDOW_MS - Date.now();
    this.msRemaining.set(Math.max(0, remaining));
  }

  windowExpiry(): string {
    const d = new Date(
      new Date(this.parentReview.submittedAt).getTime() + FOLLOWUP_WINDOW_MS,
    );
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    const remaining = MAX_IMAGES - this.selectedFiles().length;
    const { valid, errors } = validateImageFiles(files.slice(0, remaining));
    this.validationErrors.set(errors);
    if (valid.length > 0) this.selectedFiles.update((prev) => [...prev, ...valid]);
  }

  removeFile(index: number): void {
    this.selectedFiles.update((fs) => fs.filter((_, i) => i !== index));
  }

  async submit(): Promise<void> {
    const body = this.bodyText.trim();
    if (!body || this.submitting()) return;
    this.submitting.set(true);
    this.apiError.set(null);

    try {
      const review = await firstValueFrom(
        this.reviewSvc.submitFollowup(this.parentReview.id, body, this.selectedFiles()),
      );
      this.toast.success('Follow-up submitted — it is under moderation.');
      this.bodyText = '';
      this.selectedFiles.set([]);
      this.validationErrors.set([]);
      this.submitted.emit(review);
    } catch (err: unknown) {
      const e = err as { error?: { error?: string }; status?: number };
      if (e.status === 409) {
        this.apiError.set('A follow-up has already been submitted for this review.');
      } else {
        this.apiError.set(
          (e.error as { error?: string })?.error ?? 'Could not submit follow-up.',
        );
      }
    } finally {
      this.submitting.set(false);
    }
  }
}
