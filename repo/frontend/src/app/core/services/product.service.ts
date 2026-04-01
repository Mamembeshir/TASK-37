import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import type {
  Product,
  ProductListResponse,
  RecommendationsResponse,
  SortValue,
} from '../models/product.model';

export interface ProductSearchParams {
  q?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  available?: boolean;
  sortBy?: SortValue;
  limit?: number;
  offset?: number;
}

@Injectable({ providedIn: 'root' })
export class ProductService {
  private readonly api = inject(ApiService);

  search(params: ProductSearchParams): Observable<ProductListResponse> {
    const qp: Record<string, string | number | boolean | undefined | null> = {
      limit:    params.limit  ?? 20,
      offset:   params.offset ?? 0,
      sortBy:   params.sortBy ?? 'name_asc',
    };

    if (params.q)                   qp['q']        = params.q;
    if (params.brand)               qp['brand']    = params.brand;
    if (params.minPrice !== undefined && params.minPrice !== null)
                                    qp['minPrice'] = params.minPrice;
    if (params.maxPrice !== undefined && params.maxPrice !== null)
                                    qp['maxPrice'] = params.maxPrice;
    if (params.available === true)  qp['available'] = 'true';

    return this.api.get<ProductListResponse>('/products', qp);
  }

  getById(id: string): Observable<Product> {
    return this.api.get<Product>(`/products/${id}`);
  }

  getRecommendations(storeId: string, limit = 8, offset = 0): Observable<RecommendationsResponse> {
    return this.api.get<RecommendationsResponse>('/recommendations', { storeId, limit, offset });
  }
}
