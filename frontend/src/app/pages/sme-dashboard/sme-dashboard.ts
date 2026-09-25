import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { InvoicesService } from '../../core/services/invoices.service';
import { OffersService } from '../../core/services/offers.service';
import { TransactionsService } from '../../core/services/transactions.service';
import { BuyerReliabilityCard } from '../../shared/buyer-reliability-card/buyer-reliability-card';
import { downloadBlob } from '../../core/utils/download-blob';
import { addMoney, percentOf, subtractMoney } from '../../core/utils/money';
import { Invoice } from '../../core/models/invoice.model';
import { Offer } from '../../core/models/offer.model';
import { Transaction } from '../../core/models/transaction.model';

@Component({
  selector: 'app-sme-dashboard',
  imports: [ReactiveFormsModule, DatePipe, BuyerReliabilityCard],
  templateUrl: './sme-dashboard.html',
  styleUrl: './sme-dashboard.css',
})
export class SmeDashboard implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly invoicesService = inject(InvoicesService);
  private readonly offersService = inject(OffersService);
  private readonly transactionsService = inject(TransactionsService);

  readonly invoices = signal<Invoice[]>([]);
  readonly selectedInvoice = signal<Invoice | null>(null);
  readonly offers = signal<Offer[]>([]);
  readonly transactions = signal<Transaction[]>([]);

  readonly loadingInvoices = signal(false);
  readonly loadingDetail = signal(false);
  readonly acceptingOfferId = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);

  readonly createForm = this.fb.nonNullable.group({
    buyerId: ['', [Validators.required]],
    invoiceNumber: ['', [Validators.required]],
    faceValue: ['', [Validators.required, Validators.pattern(/^\d+(\.\d{1,2})?$/)]],
    currency: ['USD', [Validators.required, Validators.minLength(3), Validators.maxLength(3)]],
    issueDate: ['', [Validators.required]],
    dueDate: ['', [Validators.required]],
  });
  readonly creating = signal(false);
  readonly selectedFile = signal<File | null>(null);
  readonly uploadingDocument = signal(false);
  readonly downloadingDocument = signal(false);

  /** The winning bid, once one has been accepted — drives the deal-economics panel. */
  readonly acceptedOffer = computed(() => this.offers().find((offer) => offer.status === 'accepted') ?? null);

  ngOnInit(): void {
    this.loadInvoices();
  }

  // --- Derived figures. All string arithmetic (integer cents under the hood),
  // never float math on currency. See core/utils/money.ts.

  /** What the SME is left with at settlement, after the financier takes advance + fee. */
  residualAtSettlement(offer: Offer, invoice: Invoice): string {
    return subtractMoney(invoice.faceValue, addMoney(offer.advanceAmount, offer.feeAmount));
  }

  /** Total the SME ends up with across both payments — i.e. face value minus the fee. */
  totalToSme(offer: Offer, invoice: Invoice): string {
    return subtractMoney(invoice.faceValue, offer.feeAmount);
  }

  /** The financier's fee as a percentage of face value — the real cost of financing. */
  costOfFinancingPercent(offer: Offer, invoice: Invoice): string {
    return percentOf(offer.feeAmount, invoice.faceValue);
  }

  /** What the financier is repaid on the due date: their advance back, plus their fee. */
  financierReceivesAtSettlement(offer: Offer): string {
    return addMoney(offer.advanceAmount, offer.feeAmount);
  }

  loadInvoices(): void {
    this.loadingInvoices.set(true);
    this.invoicesService.list().subscribe({
      next: (invoices) => {
        this.invoices.set(invoices);
        this.loadingInvoices.set(false);
        // Keep the detail panel in sync if the selected invoice's status just changed.
        const selected = this.selectedInvoice();
        if (selected) {
          const refreshed = invoices.find((i) => i.id === selected.id);
          if (refreshed) this.selectedInvoice.set(refreshed);
        }
      },
      error: () => {
        this.errorMessage.set('Could not load invoices');
        this.loadingInvoices.set(false);
      },
    });
  }

  selectInvoice(invoice: Invoice): void {
    this.selectedInvoice.set(invoice);
    this.loadingDetail.set(true);
    this.offersService.listForInvoice(invoice.id).subscribe({
      next: (offers) => this.offers.set(offers),
      error: () => this.errorMessage.set('Could not load offers'),
    });
    this.transactionsService.listForInvoice(invoice.id).subscribe({
      next: (transactions) => {
        this.transactions.set(transactions);
        this.loadingDetail.set(false);
      },
      error: () => {
        this.loadingDetail.set(false);
      },
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile.set(input.files?.[0] ?? null);
  }

  createInvoice(): void {
    if (this.createForm.invalid || this.creating()) {
      return;
    }
    this.creating.set(true);
    this.errorMessage.set(null);

    this.invoicesService.create(this.createForm.getRawValue()).subscribe({
      next: (invoice) => {
        const file = this.selectedFile();
        if (!file) {
          this.creating.set(false);
          this.resetCreateForm();
          this.loadInvoices();
          return;
        }
        // A second call, deliberately: creation is structured-data-only
        // on the backend, and attaching a file is a separate concern
        // (its own endpoint, its own failure mode — e.g. wrong file type).
        this.invoicesService.uploadDocument(invoice.id, file).subscribe({
          next: () => {
            this.creating.set(false);
            this.resetCreateForm();
            this.loadInvoices();
          },
          error: (err: HttpErrorResponse) => {
            this.creating.set(false);
            this.resetCreateForm();
            this.loadInvoices();
            this.errorMessage.set(
              `Invoice created, but the document could not be attached: ${err.error?.message ?? 'upload failed'}`,
            );
          },
        });
      },
      error: (err: HttpErrorResponse) => {
        this.creating.set(false);
        this.errorMessage.set(err.error?.message ?? 'Could not create invoice');
      },
    });
  }

  private resetCreateForm(): void {
    this.createForm.reset({ currency: 'USD' });
    this.selectedFile.set(null);
  }

  uploadDocumentForSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const invoice = this.selectedInvoice();
    if (!file || !invoice) return;

    this.uploadingDocument.set(true);
    this.invoicesService.uploadDocument(invoice.id, file).subscribe({
      next: (updated) => {
        this.uploadingDocument.set(false);
        this.selectedInvoice.set(updated);
        this.loadInvoices();
      },
      error: (err: HttpErrorResponse) => {
        this.uploadingDocument.set(false);
        this.errorMessage.set(err.error?.message ?? 'Could not upload document');
      },
    });
    input.value = '';
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

  acceptOffer(offer: Offer): void {
    const invoice = this.selectedInvoice();
    if (!invoice) return;

    this.acceptingOfferId.set(offer.id);
    this.offersService.accept(invoice.id, offer.id).subscribe({
      next: () => {
        this.acceptingOfferId.set(null);
        this.loadInvoices();
        this.selectInvoice(invoice);
      },
      error: (err: HttpErrorResponse) => {
        this.acceptingOfferId.set(null);
        this.errorMessage.set(err.error?.message ?? 'Could not accept offer');
      },
    });
  }
}
