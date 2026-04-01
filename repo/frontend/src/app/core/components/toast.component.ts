import { Component, inject } from '@angular/core';
import { ToastService } from '../services/toast.service';
import type { Toast } from '../services/toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  template: `
    <div class="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2 pointer-events-none">
      @for (toast of toastSvc.toasts(); track toast.id) {
        <div
          class="pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl
                 text-sm font-medium shadow-xl animate-slide-in
                 min-w-[280px] max-w-[400px]"
          [class]="toastClass(toast)"
        >
          <!-- Icon -->
          <svg class="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            @if (toast.type === 'success') {
              <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            } @else if (toast.type === 'error') {
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
            } @else {
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            }
          </svg>

          <span class="flex-1 leading-snug">{{ toast.message }}</span>

          <!-- Dismiss -->
          <button
            (click)="toastSvc.dismiss(toast.id)"
            class="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            aria-label="Dismiss"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      }
    </div>
  `,
})
export class ToastComponent {
  protected readonly toastSvc = inject(ToastService);

  protected toastClass(toast: Toast): string {
    const base = 'border ';
    switch (toast.type) {
      case 'success': return base + 'bg-green-50 border-green-300 text-green-800';
      case 'error':   return base + 'bg-red-50 border-red-300 text-red-800';
      case 'warning': return base + 'bg-amber-50 border-amber-300 text-amber-800';
    }
  }
}
