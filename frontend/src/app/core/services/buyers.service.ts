import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../config';
import { BuyerReliability } from '../models/buyer-reliability.model';

@Injectable({ providedIn: 'root' })
export class BuyersService {
  private readonly http = inject(HttpClient);

  /** Payment track record for a buyer. Visible to SMEs, financiers and admins. */
  getReliability(buyerId: string): Observable<BuyerReliability> {
    return this.http.get<BuyerReliability>(`${API_BASE_URL}/buyers/${buyerId}/reliability`);
  }
}
