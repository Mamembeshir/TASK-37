import {
  Component,
  Input,
  Output,
  EventEmitter,
  inject,
  signal,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { HttpErrorResponse } from '@angular/common/http';
import { ReviewService } from '../../core/services/review.service';
import { ToastService } from '../../core/services/toast.service';
import {
  validateImageFiles,
  formatBytes,
  MAX_IMAGES,
  type ImageValidationError,
  type Review,
} from '../../core/models/review.model';

@Component({
  selector: 'app-review-form',
  standalone: true,
  imports: [FormsModule, NgClass],
  template: `
    <div class="glass rounded-2xl border border-zinc-200 p-6 space-y-5">
      <!-- Header -->
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-xl bg-[#c4832a]/10 flex items-center justify-center shrink-0">
          <svg class="w-4.5 h-4.5 text-[#c4832a]" fill="none" stroke="currentColor"
               stroke-width="1.75" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
          </svg>
        </div>
        <div>
          <h3 class="text-sm font-semibold text-zinc-900">Write a Review</h3>
          <p class="text-xs text-zinc-700">Share your experience with this order</p>
        </div>
      </div>

      <!-- Review body -->
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-zinc-700">Your review</label>
        <textarea
          class="input-field text-sm resize-none min-h-[100px] leading-relaxed"
          placeholder="What did you think about your order? Be specific about quality, accuracy, and service…"
          [(ngModel)]="bodyText"
          (input)="apiError.set(null)"
          maxlength="2000"
          rows="4">
        </textarea>
        <div class="flex justify-end">
          <span class="text-[10px]"
                [class]="bodyText.length > 1800 ? 'text-[#c4832a]' : 'text-zinc-700'">
            {{ bodyText.length }} / 2000
          </span>
        </div>
      </div>

      <!-- Image upload zone -->
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <label class="text-xs font-medium text-zinc-700">
            Photos
            <span class="text-zinc-800 font-normal ml-1">(optional · JPEG/PNG · max 5 MB each)</span>
          </label>
          <span class="text-[10px] text-zinc-800">{{ selectedFiles().length }} / {{ MAX_IMAGES }}</span>
        </div>

        <!-- Drop zone -->
        <label
          class="relative flex flex-col items-center justify-center gap-2
                 rounded-xl border-2 border-dashed border-zinc-700/60 py-6
                 cursor-pointer transition-all duration-200
                 hover:border-zinc-500 hover:bg-zinc-800/30"
          [ngClass]="isDragging ? 'border-[#c4832a]/30 bg-[#c4832a]/5' : ''"
          (dragover)="onDragOver($event)"
          (dragleave)="isDragging = false"
          (drop)="onDrop($event)">
          <input
            type="file"
            accept="image/jpeg,image/png"
            multiple
            class="sr-only"
            (change)="onFileChange($event)"
          />
          <svg class="w-7 h-7 text-zinc-800" fill="none" stroke="currentColor"
               stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
          </svg>
          <p class="text-xs text-zinc-700 text-center">
            <span class="text-zinc-700 font-medium">Click to upload</span> or drag and drop
          </p>
          @if (selectedFiles().length >= MAX_IMAGES) {
            <p class="text-[10px] text-[#c4832a]">Maximum {{ MAX_IMAGES }} images reached</p>
          }
        </label>

        <!-- Validation errors -->
        @if (validationErrors().length > 0) {
          <div class="space-y-1">
            @for (e of validationErrors(); track e.file.name) {
              <div class="flex items-center gap-2 px-3 py-2 rounded-lg
                          bg-red-500/8 border border-red-500/20 text-xs text-red-300">
                <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor"
                     stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round"
                    d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                </svg>
                {{ e.error }}
              </div>
            }
          </div>
        }

        <!-- Selected files list -->
        @if (selectedFiles().length > 0) {
          <ul class="space-y-1.5">
            @for (f of selectedFiles(); track f.name; let i = $index) {
              <li class="flex items-center gap-2.5 px-3 py-2 rounded-lg
                         bg-zinc-50 border border-zinc-200">
                <!-- Thumbnail -->
                <div class="w-8 h-8 rounded-md bg-zinc-700/50 overflow-hidden shrink-0 flex items-center justify-center">
                  @if (previews()[i]) {
                    <img [src]="previews()[i]" class="w-full h-full object-cover" alt="" />
                  } @else {
                    <svg class="w-4 h-4 text-zinc-700" fill="none" stroke="currentColor"
                         stroke-width="1.5" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round"
                        d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159" />
                    </svg>
                  }
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-xs text-zinc-700 truncate">{{ f.name }}</p>
                  <p class="text-[10px] text-zinc-800">{{ formatBytes(f.size) }}</p>
                </div>
                <button type="button"
                  class="p-1 rounded-md text-zinc-800 hover:text-red-400 hover:bg-red-500/10
                         transition-colors"
                  (click)="removeFile(i)"
                  [attr.aria-label]="'Remove ' + f.name">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor"
                       stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </li>
            }
          </ul>
        }
      </div>

      <!-- Submit -->
      <button type="button"
        class="btn-primary w-full py-3 text-sm flex items-center justify-center gap-2
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
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"
               viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
          </svg>
          Submit Review
        }
      </button>
    </div>
  `,
})
export class ReviewFormComponent {
  @Input({ required: true }) orderId!: string;
  @Output() submitted = new EventEmitter<Review>();

  private readonly reviewSvc = inject(ReviewService);
  private readonly toast      = inject(ToastService);

  readonly submitting       = signal(false);
  readonly apiError         = signal<string | null>(null);
  readonly selectedFiles    = signal<File[]>([]);
  readonly previews         = signal<string[]>([]);
  readonly validationErrors = signal<ImageValidationError[]>([]);

  readonly MAX_IMAGES = MAX_IMAGES;
  readonly formatBytes = formatBytes;

  bodyText = '';
  isDragging = false;

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragging = true;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging = false;
    const files = Array.from(event.dataTransfer?.files ?? []);
    this.addFiles(files);
  }

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    this.addFiles(files);
  }

  private addFiles(incoming: File[]): void {
    const remaining = MAX_IMAGES - this.selectedFiles().length;
    const candidates = incoming.slice(0, remaining);

    const { valid, errors } = validateImageFiles(candidates);
    this.validationErrors.set(errors);

    if (valid.length === 0) return;

    const newPreviews = valid.map((f) => URL.createObjectURL(f));
    this.selectedFiles.update((prev) => [...prev, ...valid]);
    this.previews.update((prev) => [...prev, ...newPreviews]);
  }

  removeFile(index: number): void {
    const prev = this.previews();
    URL.revokeObjectURL(prev[index]);
    this.selectedFiles.update((fs) => fs.filter((_, i) => i !== index));
    this.previews.update((ps) => ps.filter((_, i) => i !== index));
  }

  async submit(): Promise<void> {
    const body = this.bodyText.trim();
    if (!body || this.submitting()) return;
    this.submitting.set(true);
    this.apiError.set(null);

    try {
      const review = await firstValueFrom(
        this.reviewSvc.submit(this.orderId, body, this.selectedFiles()),
      );
      this.toast.success('Review submitted — it is under moderation.');
      this.bodyText = '';
      this.selectedFiles.set([]);
      this.previews.set([]);
      this.validationErrors.set([]);
      this.submitted.emit(review);
    } catch (err: unknown) {
      const e = err as { error?: { error?: string } };
      this.toast.error(e.error?.error ?? 'Could not submit review — please try again.');
    } finally {
      this.submitting.set(false);
    }
  }
}
