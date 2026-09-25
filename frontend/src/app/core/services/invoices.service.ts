import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../config';
import { CreateInvoicePayload, Invoice } from '../models/invoice.model';

@Injectable({ providedIn: 'root' })
export class InvoicesService {
  private readonly http = inject(HttpClient);

  /** Scoped server-side to the caller's role: own invoices for SME/buyer, biddable ones for a financier. */
  list(): Observable<Invoice[]> {
    return this.http.get<Invoice[]>(`${API_BASE_URL}/invoices`);
  }

  getById(id: string): Observable<Invoice> {
    return this.http.get<Invoice>(`${API_BASE_URL}/invoices/${id}`);
  }

  create(payload: CreateInvoicePayload): Observable<Invoice> {
    return this.http.post<Invoice>(`${API_BASE_URL}/invoices`, payload);
  }

  confirm(id: string): Observable<Invoice> {
    return this.http.post<Invoice>(`${API_BASE_URL}/invoices/${id}/confirm`, {});
  }

  uploadDocument(id: string, file: File): Observable<Invoice> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<Invoice>(`${API_BASE_URL}/invoices/${id}/document`, formData);
  }

  /**
   * Returned as a Blob, not a direct <a href> link: the download endpoint
   * requires the same bearer token as every other request (visibility is
   * enforced the same way as getById), and a plain anchor tag has no way
   * to attach an Authorization header. Going through HttpClient means the
   * auth interceptor attaches it automatically, same as any other call.
   */
  downloadDocument(id: string): Observable<Blob> {
    return this.http.get(`${API_BASE_URL}/invoices/${id}/document`, { responseType: 'blob' });
  }
}
