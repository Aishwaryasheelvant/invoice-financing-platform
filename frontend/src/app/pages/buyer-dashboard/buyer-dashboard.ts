import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';
import { InvoicesService } from '../../core/services/invoices.service';
import { downloadBlob } from '../../core/utils/download-blob';
import { Invoice } from '../../core/models/invoice.model';

@Component({
  selector: 'app-buyer-dashboard',
  imports: [DatePipe],
  templateUrl: './buyer-dashboard.html',
  styleUrl: './buyer-dashboard.css',
})
export class BuyerDashboard implements OnInit {
  private readonly invoicesService = inject(InvoicesService);
  protected readonly authService = inject(AuthService);

  readonly invoices = signal<Invoice[]>([]);
  readonly loading = signal(false);
  readonly confirmingId = signal<string | null>(null);
  readonly payingId = signal<string | null>(null);
  readonly downloadingId = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);

  /** Financed or already overdue — a late payment still settles the invoice. */
  isPayable(invoice: Invoice): boolean {
    return invoice.status === 'financed' || invoice.status === 'overdue';
  }

  ngOnInit(): void {
    this.loadInvoices();
  }

  loadInvoices(): void {
    this.loading.set(true);
    this.invoicesService.list().subscribe({
      next: (invoices) => {
        this.invoices.set(invoices);
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set('Could not load invoices');
        this.loading.set(false);
      },
    });
  }

  confirm(invoice: Invoice): void {
    this.confirmingId.set(invoice.id);
    this.invoicesService.confirm(invoice.id).subscribe({
      next: () => {
        this.confirmingId.set(null);
        this.loadInvoices();
      },
      error: (err) => {
        this.confirmingId.set(null);
        this.errorMessage.set(err.error?.message ?? 'Could not confirm invoice');
      },
    });
  }

  pay(invoice: Invoice): void {
    this.payingId.set(invoice.id);
    this.errorMessage.set(null);
    this.invoicesService.pay(invoice.id).subscribe({
      next: () => {
        this.payingId.set(null);
        this.loadInvoices();
      },
      error: (err) => {
        this.payingId.set(null);
        this.errorMessage.set(err.error?.message ?? 'Could not pay this invoice');
      },
    });
  }

  download(invoice: Invoice): void {
    this.downloadingId.set(invoice.id);
    this.invoicesService.downloadDocument(invoice.id).subscribe({
      next: (blob) => {
        this.downloadingId.set(null);
        downloadBlob(blob, invoice.documentOriginalName ?? 'document');
      },
      error: () => {
        this.downloadingId.set(null);
        this.errorMessage.set('Could not download document');
      },
    });
  }
}
