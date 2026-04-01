export const STRATEGY_OPTIONS = [
  { value: 'popularity',  label: 'Popularity' },
  { value: 'price_asc',   label: 'Price: Low to High' },
  { value: 'price_desc',  label: 'Price: High to Low' },
  { value: 'newest',      label: 'Newest First' },
  { value: 'manual',      label: 'Manual (sort_order)' },
] as const;

export type Strategy = (typeof STRATEGY_OPTIONS)[number]['value'];

export interface CampaignItem {
  id: string;
  storeId: string;
  variant: string;
  strategy: Strategy;
  startDate: string;    // YYYY-MM-DD
  endDate: string;      // YYYY-MM-DD
  isActive: boolean;
  isCurrentlyActive: boolean;
  displayLabel: string;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignListResponse {
  data: CampaignItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface CampaignBody {
  storeId: string;
  variant: string;
  strategy: Strategy;
  startDate: string;
  endDate: string;
}
