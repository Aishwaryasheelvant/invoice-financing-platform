import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { InvoicesService } from '../../core/services/invoices.service';
import { OffersService } from '../../core/services/offers.service';
import { TransactionsService } from '../../core/services/transactions.service';
import { downloadBlob } from '../../core/utils/download-blob';
import { Invoice } from '../../core/models/invoice.model';
import { Offer } from '../../core/models/offer.model';
import { Transaction } from '../../core/models/transaction.model';

@Component({
  selector: 'app-financier-dashboard',
  imports: [ReactiveFormsModule, DatePipe],
  templateUrl: './financier-dashboard.html',
  styleUrl: './financier-dashboard.css',
})
export class FinancierDashboard implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly invoicesService = inject(InvoicesService);
  private readonly offersService = inject(OffersService);
  private readonly transactionsService = inject(TransactionsService);

  /** Server already scopes this to CONFIRMED invoices for a financier caller. */
  readonly invoices = signal<Invoice[]>([]);
  readonly selectedInvoice = signal<Invoice | null>(null);
  readonly myOffer = signal<Offer | null>(null);
  readonly transactions = signal<Transaction[]>([]);

  readonly loadingInvoices = signal(false);
  readonly loadingDetail = signal(false);
  readonly submitting = signal(false);
  readonly downloadingDocument = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly offerForm = this.fb.nonNullable.group({
    advanceRate: [0.9, [Validators.required, Validators.min(0.0001), Validators.max(1)]],
    feeAmount: ['', [Validators.required, Validators.pattern(/^\d+(\.\d{1,2})?$/)]],
    expiresAt: ['', [Validators.required]],
  });

  ngOnInit(): void {
    this.loadInvoices();
  }

  loadInvoices(): void {
    this.loadingInvoices.set(true);
    this.invoicesService.list().subscribe({
      next: (invoices) => {
        this.invoices.set(invoices);
        this.loadingInvoices.set(false);
      },
      error: () => {
        this.errorMessage.set('Could not load invoices');
        this.loadingInvoices.set(false);
      },
    });
  }

  selectInvoice(invoice: Invoice): void {
    this.selectedInvoice.set(invoice);
    this.myOffer.set(null);
    this.loadingDetail.set(true);
    this.offersService.listForInvoice(invoice.id).subscribe({
      next: (offers) => {
        // The backend already filters this list to just this financier's own offer(s).
        this.myOffer.set(offers[0] ?? null);
        this.loadingDetail.set(false);
      },
      error: () => this.loadingDetail.set(false),
    });
    this.transactionsService.listForInvoice(invoice.id).subscribe({
      next: (transactions) => this.transactions.set(transactions),
      error: () => {
        // A financier with no accepted offer on this invoice isn't allowed to see this — that's expected, not an error to surface.
      },
    });
  }

  submitOffer(): void {
    const invoice = this.selectedInvoice();
    if (!invoice || this.offerForm.invalid || this.submitting()) {
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set(null);

    const { advanceRate, feeAmount, expiresAt } = this.offerForm.getRawValue();
    this.offersService
      .submit(invoice.id, { advanceRate: Number(advanceRate), feeAmount, expiresAt: new Date(expiresAt).toISOString() })
      .subscribe({
        next: (offer) => {
          this.submitting.set(false);
          this.myOffer.set(offer);
        },
        error: (err: HttpErrorResponse) => {
          this.submitting.set(false);
          this.errorMessage.set(err.error?.message ?? 'Could not submit offer');
        },
      });
  }

  downloadDocument(invoice: Invoice): void {
    this.downloadingDocument.set(true);
    this.invoicesService.downloadDocument(invoice.id).subscribe({
      next: (blob) => {
        this.downloadingDocument.set(false);
        downloadBlob(blob, invoice.documentOriginalName ?? 'document');
      },
      error: () => {
        this.downloadingDocument.set(false);
        this.errorMessage.set('Could not download document');
      },
    });
  }
}
