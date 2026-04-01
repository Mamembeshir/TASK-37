import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';

export const routes: Routes = [
  // Public routes
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login/login.component').then((m) => m.LoginComponent),
    title: 'Sign In — Retail Hub',
  },
  {
    path: 'unauthorized',
    loadComponent: () =>
      import('./features/shared/unauthorized/unauthorized.component').then(
        (m) => m.UnauthorizedComponent,
      ),
    title: 'Access Denied — Retail Hub',
  },

  // Protected shell — all authenticated routes live here
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/shell/shell.component').then((m) => m.ShellComponent),
    children: [
      // Catalog
      {
        path: 'catalog',
        loadComponent: () =>
          import('./features/catalog/catalog.component').then((m) => m.CatalogComponent),
        title: 'Catalog — Retail Hub',
      },
      {
        path: 'catalog/:id',
        loadComponent: () =>
          import('./features/catalog/product-detail.component').then(
            (m) => m.ProductDetailComponent,
          ),
        title: 'Product — Retail Hub',
      },

      // Cart + orders
      {
        path: 'cart',
        loadComponent: () =>
          import('./features/cart/cart.component').then((m) => m.CartComponent),
        title: 'Cart — Retail Hub',
      },
      {
        path: 'orders',
        loadComponent: () =>
          import('./features/orders/orders.component').then((m) => m.OrdersComponent),
        title: 'My Orders — Retail Hub',
      },
      {
        path: 'orders/:id/reviews',
        loadComponent: () =>
          import('./features/reviews/reviews-page.component').then(
            (m) => m.ReviewsPageComponent,
          ),
        title: 'Reviews — Retail Hub',
      },

      // After-sales
      {
        path: 'tickets',
        loadComponent: () =>
          import('./features/tickets/tickets.component').then((m) => m.TicketsComponent),
        title: 'My Tickets — Retail Hub',
      },
      {
        path: 'tickets/:id',
        loadComponent: () =>
          import('./features/tickets/ticket-detail.component').then(
            (m) => m.TicketDetailComponent,
          ),
        title: 'Ticket — Retail Hub',
      },
      {
        path: 'notifications',
        loadComponent: () =>
          import('./features/notifications/notifications.component').then(
            (m) => m.NotificationsComponent,
          ),
        title: 'Notifications — Retail Hub',
      },

      // Staff
      {
        path: 'associate',
        canActivate: [roleGuard('associate', 'supervisor', 'manager', 'admin')],
        loadComponent: () =>
          import('./features/associate/associate.component').then((m) => m.AssociateComponent),
        title: 'Associate Console — Retail Hub',
      },
      {
        path: 'associate/checkout/:id',
        canActivate: [roleGuard('associate', 'supervisor', 'manager', 'admin')],
        loadComponent: () =>
          import('./features/orders/checkout.component').then((m) => m.CheckoutComponent),
        title: 'Process Payment — Retail Hub',
      },
      {
        path: 'associate/queue',
        canActivate: [roleGuard('associate', 'supervisor', 'manager', 'admin')],
        loadComponent: () =>
          import('./features/associate/associate-console.component').then(
            (m) => m.AssociateConsoleComponent,
          ),
        title: 'Ticket Queue — Retail Hub',
      },
      {
        path: 'associate/pickup-verify',
        canActivate: [roleGuard('associate', 'supervisor', 'manager', 'admin')],
        loadComponent: () =>
          import('./features/associate/pickup-verify.component').then(
            (m) => m.PickupVerifyComponent,
          ),
        title: 'Pickup Verify — Retail Hub',
      },

      // Admin area
      {
        path: 'admin',
        canActivate: [roleGuard('admin', 'manager')],
        loadComponent: () =>
          import('./features/admin/admin.component').then((m) => m.AdminComponent),
        title: 'Admin — Retail Hub',
      },
      {
        path: 'admin/products',
        canActivate: [roleGuard('admin', 'manager')],
        loadComponent: () =>
          import('./features/admin/products/admin-products.component').then(
            (m) => m.AdminProductsComponent,
          ),
        title: 'Products — Retail Hub',
      },
      {
        path: 'admin/rules',
        canActivate: [roleGuard('admin')],
        loadComponent: () =>
          import('./features/admin/rules/admin-rules.component').then(
            (m) => m.AdminRulesComponent,
          ),
        title: 'Rules Engine — Retail Hub',
      },
      {
        path: 'admin/banned-terms',
        canActivate: [roleGuard('admin')],
        loadComponent: () =>
          import('./features/admin/banned-terms/admin-banned-terms.component').then(
            (m) => m.AdminBannedTermsComponent,
          ),
        title: 'Banned Terms — Retail Hub',
      },
      {
        path: 'admin/moderation',
        canActivate: [roleGuard('admin', 'manager')],
        loadComponent: () =>
          import('./features/admin/moderation/admin-moderation-queue.component').then(
            (m) => m.AdminModerationQueueComponent,
          ),
        title: 'Moderation Queue — Retail Hub',
      },
      {
        path: 'admin/audit-log',
        canActivate: [roleGuard('admin', 'manager')],
        loadComponent: () =>
          import('./features/admin/audit-log/admin-audit-log.component').then(
            (m) => m.AdminAuditLogComponent,
          ),
        title: 'Audit Log — Retail Hub',
      },
      {
        path: 'admin/users',
        canActivate: [roleGuard('admin')],
        loadComponent: () =>
          import('./features/admin/users/admin-users.component').then(
            (m) => m.AdminUsersComponent,
          ),
        title: 'User Management — Retail Hub',
      },
      {
        path: 'admin/campaigns',
        canActivate: [roleGuard('admin')],
        loadComponent: () =>
          import('./features/admin/campaign/admin-campaign.component').then(
            (m) => m.AdminCampaignComponent,
          ),
        title: 'Campaigns — Retail Hub',
      },

      // Default
      { path: '', redirectTo: 'catalog', pathMatch: 'full' },
    ],
  },

  // Fallback
  { path: '**', redirectTo: '/catalog' },
];
