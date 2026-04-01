import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

interface AdminCard {
  title: string;
  description: string;
  link: string;
  linkLabel: string;
  accent: string;          // hover border / shadow / icon bg / icon text / link text
  iconPath: string;
}

const CARDS: AdminCard[] = [
  {
    title: 'Products',
    description: 'Create, edit, and archive catalog listings. Adjust pricing, stock levels, and categories.',
    link: '/admin/products',
    linkLabel: 'Manage Products',
    accent: 'green',
    iconPath: 'M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z',
  },
  {
    title: 'Rules Engine',
    description: 'Publish and roll back versioned rule sets for coupons, tier benefits, risk limits, and moderation.',
    link: '/admin/rules',
    linkLabel: 'Manage Rules',
    accent: 'violet',
    iconPath: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  },
  {
    title: 'Banned Terms',
    description: 'Manage the offline content moderation dictionary — exact words and regex patterns.',
    link: '/admin/banned-terms',
    linkLabel: 'Manage Terms',
    accent: 'amber',
    iconPath: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z',
  },
  {
    title: 'Moderation Queue',
    description: 'Review flagged content from the appeals queue — approve to publish or reject with an audit trail.',
    link: '/admin/moderation',
    linkLabel: 'Open Queue',
    accent: 'red',
    iconPath: 'M3 3l1.664 1.664M21 21l-1.5-1.5m-5.485-1.242L12 17.25 4.5 21V8.742m.164-4.078a2.15 2.15 0 0 1 1.743-1.342 48.507 48.507 0 0 1 11.186 0c1.1.128 1.907 1.077 1.907 2.185V19.5M4.664 4.664 19.5 19.5',
  },
  {
    title: 'A/B Campaigns',
    description: 'Create and manage recommendation test variants by store and date range.',
    link: '/admin/campaigns',
    linkLabel: 'Manage Campaigns',
    accent: 'sky',
    iconPath: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z',
  },
  {
    title: 'Audit Log',
    description: 'Browse the immutable system audit trail — filter by entity, actor, or date range. Expand rows to diff before/after values.',
    link: '/admin/audit-log',
    linkLabel: 'View Logs',
    accent: 'indigo',
    iconPath: 'M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25',
  },
  {
    title: 'User Management',
    description: 'View accounts, reassign roles, and clear 15-minute security lockouts caused by failed login attempts.',
    link: '/admin/users',
    linkLabel: 'Manage Users',
    accent: 'zinc',
    iconPath: 'M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z',
  },
];

// Accent colour class maps — must be fully spelled out for Tailwind JIT
const BORDER: Record<string, string> = {
  green: 'hover:border-[#c4832a]/20',
  violet:  'hover:border-violet-500/30',
  amber:   'hover:border-[#c4832a]/20',
  red:     'hover:border-red-500/30',
  sky:     'hover:border-sky-500/30',
  indigo:  'hover:border-indigo-500/30',
  zinc:    'hover:border-zinc-400/30',
};
const SHADOW: Record<string, string> = {
  green: 'hover:shadow-[0_0_24px_rgba(245,158,11,0.08)]',
  violet:  'hover:shadow-[0_0_24px_rgba(139,92,246,0.08)]',
  amber:   'hover:shadow-[0_0_24px_rgba(245,158,11,0.08)]',
  red:     'hover:shadow-[0_0_24px_rgba(239,68,68,0.08)]',
  sky:     'hover:shadow-[0_0_24px_rgba(14,165,233,0.08)]',
  indigo:  'hover:shadow-[0_0_24px_rgba(99,102,241,0.08)]',
  zinc:    'hover:shadow-[0_0_24px_rgba(161,161,170,0.06)]',
};
const ICON_BG: Record<string, string> = {
  green: 'bg-[#c4832a]/10 group-hover:bg-[#c4832a]/10',
  violet:  'bg-violet-500/10 group-hover:bg-violet-500/20',
  amber:   'bg-[#c4832a]/10 group-hover:bg-[#c4832a]/10',
  red:     'bg-red-500/10 group-hover:bg-red-500/20',
  sky:     'bg-sky-50 group-hover:bg-sky-500/20',
  indigo:  'bg-indigo-500/10 group-hover:bg-indigo-500/20',
  zinc:    'bg-zinc-500/10 group-hover:bg-zinc-500/20',
};
const ICON_COLOR: Record<string, string> = {
  green: 'text-[#c4832a]',
  violet:  'text-violet-400',
  amber:   'text-[#c4832a]',
  red:     'text-red-400',
  sky:     'text-sky-700',
  indigo:  'text-indigo-400',
  zinc:    'text-zinc-700',
};
const TITLE_HOVER: Record<string, string> = {
  green: 'group-hover:text-[#c4832a]',
  violet:  'group-hover:text-violet-300',
  amber:   'group-hover:text-[#c4832a]',
  red:     'group-hover:text-red-300',
  sky:     'group-hover:text-sky-300',
  indigo:  'group-hover:text-indigo-300',
  zinc:    'group-hover:text-zinc-800',
};
const LINK_COLOR: Record<string, string> = {
  green: 'text-amber-500 group-hover:text-[#c4832a]',
  violet:  'text-violet-500 group-hover:text-violet-400',
  amber:   'text-amber-500 group-hover:text-[#c4832a]',
  red:     'text-red-500 group-hover:text-red-400',
  sky:     'text-sky-500 group-hover:text-sky-700',
  indigo:  'text-indigo-500 group-hover:text-indigo-400',
  zinc:    'text-zinc-700 group-hover:text-zinc-700',
};

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="max-w-4xl mx-auto px-4 py-10 space-y-8 animate-fade-in">
      <!-- Header -->
      <div>
        <h1 class="text-2xl font-bold text-zinc-900">Admin</h1>
        <p class="mt-1 text-sm text-zinc-700">
          System administration — manage catalog, rules, moderation, and campaigns.
        </p>
      </div>

      <!-- Cards -->
      <div class="grid gap-4 sm:grid-cols-2">
        @for (card of cards; track card.link) {
          <a [routerLink]="card.link"
             [class]="cardClass(card.accent)">
            <div [class]="iconBgClass(card.accent) + ' w-11 h-11 rounded-xl flex items-center justify-center transition-colors'">
              <svg [class]="'w-5 h-5 ' + iconColor(card.accent)"
                   fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" [attr.d]="card.iconPath" />
              </svg>
            </div>
            <div>
              <p [class]="'text-sm font-semibold text-zinc-900 transition-colors ' + titleHover(card.accent)">
                {{ card.title }}
              </p>
              <p class="mt-1 text-xs text-zinc-700 leading-relaxed">
                {{ card.description }}
              </p>
            </div>
            <div [class]="'mt-auto flex items-center gap-1 text-xs font-medium transition-colors ' + linkColor(card.accent)">
              {{ card.linkLabel }}
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2"
                   viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round"
                      d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </div>
          </a>
        }
      </div>
    </div>
  `,
})
export class AdminComponent {
  readonly cards = CARDS;

  cardClass(accent: string): string {
    return [
      'group relative glass rounded-2xl p-6 flex flex-col gap-4',
      'border border-zinc-200 transition-all duration-200',
      'hover:-translate-y-0.5 cursor-pointer no-underline',
      BORDER[accent] ?? '',
      SHADOW[accent] ?? '',
    ].join(' ');
  }

  iconBgClass(accent: string): string { return ICON_BG[accent] ?? ''; }
  iconColor(accent: string): string   { return ICON_COLOR[accent] ?? ''; }
  titleHover(accent: string): string  { return TITLE_HOVER[accent] ?? ''; }
  linkColor(accent: string): string   { return LINK_COLOR[accent] ?? ''; }
}
