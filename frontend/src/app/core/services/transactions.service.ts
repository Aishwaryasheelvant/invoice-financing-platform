import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../config';
import { Transaction } from '../models/transaction.model';

@Injectable({ providedIn: 'root' })
export class TransactionsService {
  private readonly http = inject(HttpClient);

  /** The money-movement history for an invoice — the payout and, later, the settlement split. */
  listForInvoice(invoiceId: string): Observable<Transaction[]> {
    return this.http.get<Transaction[]>(`${API_BASE_URL}/invoices/${invoiceId}/transactions`);
  }
}
