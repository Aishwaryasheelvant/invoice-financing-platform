import { Component, OnInit, inject, signal } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';
import { InvoicesService } from '../../core/services/invoices.service';
import { downloadBlob } from '../../core/utils/download-blob';
import { Invoice } from '../../core/models/invoice.model';

@Component({
  selector: 'app-buyer-dashboard',
  imports: [],
  templateUrl: './buyer-dashboard.html',
  styleUrl: './buyer-dashboard.css',
})
export class BuyerDashboard implements OnInit {
  private readonly invoicesService = inject(InvoicesService);
  protected readonly authService = inject(AuthService);

  readonly invoices = signal<Invoice[]>([]);
  readonly loading = signal(false);
  readonly confirmingId = signal<string | null>(null);
  readonly downloadingId = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);

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
