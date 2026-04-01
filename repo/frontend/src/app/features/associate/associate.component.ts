import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-associate',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="max-w-2xl mx-auto px-4 py-10 space-y-8">
      <!-- Header -->
      <div>
        <h1 class="text-2xl font-bold text-zinc-900">Associate Console</h1>
        <p class="mt-1 text-sm text-zinc-700">
          Welcome, <span class="text-zinc-800 font-medium">{{ auth.currentUser()?.username }}</span>.
          Choose a workflow below.
        </p>
      </div>

      <!-- Workflow cards -->
      <div class="grid gap-4 sm:grid-cols-2">
        <!-- Process Payment -->
        <a routerLink="/associate/pickup-verify"
           class="group relative glass rounded-2xl p-6 flex flex-col gap-4
                  border border-zinc-200 hover:border-[#c4832a]/20
                  transition-all duration-200 hover:shadow-[0_0_24px_rgba(245,158,11,0.08)]
                  hover:-translate-y-0.5 cursor-pointer no-underline">
          <div class="w-11 h-11 rounded-xl bg-[#c4832a]/10 flex items-center justify-center
                      group-hover:bg-[#c4832a]/10 transition-colors">
            <svg class="w-5 h-5 text-[#c4832a]" fill="none" stroke="currentColor"
                 stroke-width="1.75" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round"
                    d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </div>
          <div>
            <p class="text-sm font-semibold text-zinc-900 group-hover:text-[#c4832a]
                      transition-colors">
              Verify Pickup
            </p>
            <p class="mt-1 text-xs text-zinc-700 leading-relaxed">
              Look up an order and confirm the customer's 6-digit pickup code.
              Manager override available for locked orders.
            </p>
          </div>
          <div class="mt-auto flex items-center gap-1 text-xs text-amber-500
                      group-hover:text-[#c4832a] transition-colors font-medium">
            Open
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2"
                 viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round"
                    d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </div>
        </a>

        <!-- Pickup Verify (navigates to orders list for now) -->
        <a routerLink="/orders"
           class="group relative glass rounded-2xl p-6 flex flex-col gap-4
                  border border-zinc-200 hover:border-violet-500/30
                  transition-all duration-200 hover:shadow-[0_0_24px_rgba(139,92,246,0.08)]
                  hover:-translate-y-0.5 cursor-pointer no-underline">
          <div class="w-11 h-11 rounded-xl bg-violet-500/10 flex items-center justify-center
                      group-hover:bg-violet-500/20 transition-colors">
            <svg class="w-5 h-5 text-violet-400" fill="none" stroke="currentColor"
                 stroke-width="1.75" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round"
                    d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25
                       2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0
                       0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
            </svg>
          </div>
          <div>
            <p class="text-sm font-semibold text-zinc-900 group-hover:text-violet-300
                      transition-colors">
              Process Payment
            </p>
            <p class="mt-1 text-xs text-zinc-700 leading-relaxed">
              View pending orders and process tender splits — cash, card, or mixed payments
              at the checkout counter.
            </p>
          </div>
          <div class="mt-auto flex items-center gap-1 text-xs text-violet-500
                      group-hover:text-violet-400 transition-colors font-medium">
            View Orders
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2"
                 viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round"
                    d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </div>
        </a>

        <!-- Ticket Queue -->
        <a routerLink="/associate/queue"
           class="group relative glass rounded-2xl p-6 flex flex-col gap-4
                  border border-zinc-200 hover:border-sky-500/30
                  transition-all duration-200 hover:shadow-[0_0_24px_rgba(14,165,233,0.08)]
                  hover:-translate-y-0.5 cursor-pointer no-underline">
          <div class="w-11 h-11 rounded-xl bg-sky-50 flex items-center justify-center
                      group-hover:bg-sky-500/20 transition-colors">
            <svg class="w-5 h-5 text-sky-700" fill="none" stroke="currentColor"
                 stroke-width="1.75" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round"
                    d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
            </svg>
          </div>
          <div>
            <p class="text-sm font-semibold text-zinc-900 group-hover:text-sky-300
                      transition-colors">
              Ticket Queue
            </p>
            <p class="mt-1 text-xs text-zinc-700 leading-relaxed">
              Handle after-sales tickets — returns, refunds, and price adjustments.
              Check in, triage, and resolve customer requests.
            </p>
          </div>
          <div class="mt-auto flex items-center gap-1 text-xs text-sky-500
                      group-hover:text-sky-700 transition-colors font-medium">
            Open Queue
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2"
                 viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round"
                    d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </div>
        </a>
      </div>

      <!-- Quick tip -->
      <p class="text-xs text-zinc-800 text-center">
        Tip: use the <span class="text-zinc-700 font-medium">Orders</span> list to find a
        specific order ID, then open checkout directly from there.
      </p>
    </div>
  `,
})
export class AssociateComponent {
  readonly auth = inject(AuthService);
}
