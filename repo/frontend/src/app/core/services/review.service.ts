import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import type { Review } from '../models/review.model';

@Injectable({ providedIn: 'root' })
export class ReviewService {
  private readonly api = inject(ApiService);

  /** List all reviews (original + follow-ups) for an order. */
  list(orderId: string): Observable<Review[]> {
    return this.api.get<Review[]>('/reviews', { orderId });
  }

  /** Submit an original review with optional images (multipart). */
  submit(orderId: string, body: string, images: File[]): Observable<Review> {
    const fd = new FormData();
    fd.append('orderId', orderId);
    fd.append('body', body);
    images.forEach((f) => fd.append('images', f, f.name));
    return this.api.postForm<Review>('/reviews', fd);
  }

  /** Submit a follow-up review on an existing original review. */
  submitFollowup(parentReviewId: string, body: string, images: File[]): Observable<Review> {
    const fd = new FormData();
    fd.append('body', body);
    images.forEach((f) => fd.append('images', f, f.name));
    return this.api.postForm<Review>(`/reviews/${parentReviewId}/followup`, fd);
  }
}
