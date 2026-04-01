export interface Product {
  id: string;
  name: string;
  description: string | null;
  brand: string | null;
  price: string;         // numeric(10,2) — kept as string, never float
  stockQty: number;
  category: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface ProductListResponse {
  data: Product[];
  total: number;
  limit: number;
  offset: number;
}

export interface CampaignMeta {
  id: string;
  variant: string;
  strategy: string;
  startDate: string;
  endDate: string;
  displayLabel: string;
}

export interface RecommendationsResponse {
  data: Product[];
  campaign: CampaignMeta | null;
  strategy: string;
  total: number;
  limit: number;
  offset: number;
}

export const SORT_OPTIONS = [
  { value: 'name_asc',    label: 'Name A–Z' },
  { value: 'name_desc',   label: 'Name Z–A' },
  { value: 'price_asc',   label: 'Price: Low to High' },
  { value: 'price_desc',  label: 'Price: High to Low' },
  { value: 'availability', label: 'Availability' },
] as const;

export type SortValue = (typeof SORT_OPTIONS)[number]['value'];
