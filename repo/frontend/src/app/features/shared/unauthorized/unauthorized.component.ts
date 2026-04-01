import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-unauthorized',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="flex flex-col items-center justify-center min-h-screen bg-[#faf8f3]">
      <div class="glass rounded-2xl p-10 text-center animate-scale-in max-w-md">
        <div class="text-6xl mb-4">🔒</div>
        <h1 class="text-2xl font-bold text-zinc-900 mb-2">Access Denied</h1>
        <p class="text-zinc-700 mb-6">You don't have permission to view this page.</p>
        <a routerLink="/catalog" class="btn-primary inline-block">Go to Catalog</a>
      </div>
    </div>
  `,
})
export class UnauthorizedComponent {}
