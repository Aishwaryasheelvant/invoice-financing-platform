import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { AuditLogsRepository } from '../audit/repositories/audit-logs.repository';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { Money } from '../common/money';
import { InvoiceStateMachine } from '../invoices/invoice-state-machine';
import { InvoiceStatus } from '../invoices/enums/invoice-status.enum';
import { InvoicesRepository } from '../invoices/repositories/invoices.repository';
import { JOB_NAMES, ProcessPayoutJobData, QUEUE_NAMES } from '../jobs/queues/queue-names';
import { CreateOfferDto } from './dto/create-offer.dto';
import { OfferResponseDto } from './dto/offer-response.dto';
import { OfferStatus } from './enums/offer-status.enum';
import { FinancingOffersRepository } from './repositories/financing-offers.repository';

@Injectable()
export class FinancingOffersService {
  constructor(
    private readonly financingOffersRepository: FinancingOffersRepository,
    private readonly invoicesRepository: InvoicesRepository,
    private readonly auditLogsRepository: AuditLogsRepository,
    private readonly dataSource: DataSource,
    @InjectQueue(QUEUE_NAMES.PAYOUTS) private readonly payoutsQueue: Queue<ProcessPayoutJobData>,
  ) {}

  async submitOffer(invoiceId: string, dto: CreateOfferDto, financierId: string): Promise<OfferResponseDto> {
    const invoice = await this.invoicesRepository.findById(invoiceId);
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    if (invoice.status !== InvoiceStatus.CONFIRMED) {
      throw new ConflictException('Invoice is not open for bidding');
    }
    if (invoice.sellerId === financierId || invoice.buyerId === financierId) {
      throw new BadRequestException('Cannot finance an invoice you are a party to');
    }
    if (new Date(dto.expiresAt) <= new Date()) {
      throw new BadRequestException('expiresAt must be in the future');
    }

    const faceValue = Money.of(invoice.faceValue);
    const advanceAmount = faceValue.times(dto.advanceRate);
    const feeAmount = Money.of(dto.feeAmount);
    if (advanceAmount.plus(feeAmount).greaterThan(faceValue)) {
      throw new BadRequestException('advanceAmount + feeAmount cannot exceed the invoice face value');
    }

    const offer = await this.financingOffersRepository.create({
      invoiceId,
      financierId,
      advanceRate: dto.advanceRate.toFixed(4),
      advanceAmount: advanceAmount.toFixed(),
      feeAmount: feeAmount.toFixed(),
      expiresAt: new Date(dto.expiresAt),
    });

    return OfferResponseDto.fromEntity(offer);
  }

  async listForInvoice(invoiceId: string, currentUser: AuthenticatedUser): Promise<OfferResponseDto[]> {
    await this.assertCanViewOffers(invoiceId, currentUser);
    const offers = await this.financingOffersRepository.findByInvoiceId(invoiceId);
    return offers.map(OfferResponseDto.fromEntity);
  }

  private async assertCanViewOffers(invoiceId: string, currentUser: AuthenticatedUser): Promise<void> {
    const invoice = await this.invoicesRepository.findById(invoiceId);
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    if (invoice.sellerId !== currentUser.id) {
      throw new ForbiddenException('Only the invoice owner can view its offers');
    }
  }

  /**
   * The core concurrency-sensitive operation: exactly one offer may ever
   * be accepted per invoice, even if two accept requests for two
   * different offers on the same invoice land at the same instant.
   *
   * Safeguards, layered:
   *  1. Pessimistic row lock on the invoice (SELECT ... FOR UPDATE) taken
   *     first, inside one DB transaction. A second, concurrent
   *     acceptOffer() call for the *same* invoice blocks here until the
   *     first transaction commits or rolls back — the two calls can
   *     never both proceed past this point at once.
   *  2. After acquiring the lock, the invoice status is re-checked. The
   *     second call (once unblocked) now sees the invoice already
   *     FINANCED and fails cleanly with a business error, instead of
   *     racing the first call.
   *  3. The target offer row is *also* locked and re-checked as PENDING,
   *     so accepting an offer that was concurrently withdrawn or already
   *     decided fails instead of silently succeeding on stale data.
   *  4. Defense in depth at the schema level: financing_offers has a
   *     partial UNIQUE INDEX on (invoice_id) WHERE status='accepted'.
   *     Even if this method had a bug and let two transactions both
   *     reach the final UPDATE, the database itself would reject the
   *     second one.
   */
  async acceptOffer(invoiceId: string, offerId: string, currentUser: AuthenticatedUser): Promise<OfferResponseDto> {
    const acceptedOffer = await this.dataSource.transaction(async (manager) => {
      const invoice = await this.invoicesRepository.findByIdForUpdate(invoiceId, manager);
      if (!invoice) {
        throw new NotFoundException('Invoice not found');
      }
      if (invoice.sellerId !== currentUser.id) {
        throw new ForbiddenException('Only the invoice owner can accept an offer');
      }
      InvoiceStateMachine.assertCanTransition(invoice.status, InvoiceStatus.FINANCED);

      const offer = await this.financingOffersRepository.findByIdForUpdate(offerId, manager);
      if (!offer || offer.invoiceId !== invoiceId) {
        throw new NotFoundException('Offer not found on this invoice');
      }
      if (offer.status !== OfferStatus.PENDING) {
        throw new ConflictException(`Offer is ${offer.status}, not available to accept`);
      }
      if (offer.expiresAt.getTime() < Date.now()) {
        throw new ConflictException('Offer has expired');
      }

      await this.financingOffersRepository.markAccepted(offer.id, manager);
      await this.financingOffersRepository.rejectOtherPendingOffers(invoiceId, offer.id, manager);
      await this.invoicesRepository.updateStatus(invoiceId, InvoiceStatus.FINANCED, manager);

      await this.auditLogsRepository.record(
        {
          entityType: 'invoice',
          entityId: invoiceId,
          fromStatus: invoice.status,
          toStatus: InvoiceStatus.FINANCED,
          actorId: currentUser.id,
          metadata: { acceptedOfferId: offer.id },
        },
        manager,
      );

      offer.status = OfferStatus.ACCEPTED;
      offer.decidedAt = new Date();
      return offer;
    });

    // Enqueued *after* the transaction commits, never inside it — a
    // worker must never be able to pick this job up before the
    // acceptance is durably committed, and if something after this line
    // fails, the accepted offer must not vanish along with it.
    await this.payoutsQueue.add(
      JOB_NAMES.PROCESS_PAYOUT,
      { offerId: acceptedOffer.id },
      { jobId: `payout-${acceptedOffer.id}` }, // stable id: a duplicate enqueue for the same offer is a no-op
    );

    return OfferResponseDto.fromEntity(acceptedOffer);
  }
}
