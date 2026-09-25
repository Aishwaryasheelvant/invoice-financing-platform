import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../config';
import { CreateOfferPayload, Offer } from '../models/offer.model';

@Injectable({ providedIn: 'root' })
export class OffersService {
  private readonly http = inject(HttpClient);

  /** SME sees every bid on their invoice; a financier sees only their own — enforced server-side. */
  listForInvoice(invoiceId: string): Observable<Offer[]> {
    return this.http.get<Offer[]>(`${API_BASE_URL}/invoices/${invoiceId}/offers`);
  }

  submit(invoiceId: string, payload: CreateOfferPayload): Observable<Offer> {
    return this.http.post<Offer>(`${API_BASE_URL}/invoices/${invoiceId}/offers`, payload);
  }

  accept(invoiceId: string, offerId: string): Observable<Offer> {
    return this.http.post<Offer>(`${API_BASE_URL}/invoices/${invoiceId}/offers/${offerId}/accept`, {});
  }
}
