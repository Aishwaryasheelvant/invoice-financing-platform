import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Not, Repository } from 'typeorm';
import { FinancingOffer } from '../entities/financing-offer.entity';
import { OfferStatus } from '../enums/offer-status.enum';

@Injectable()
export class FinancingOffersRepository {
  constructor(
    @InjectRepository(FinancingOffer)
    private readonly repository: Repository<FinancingOffer>,
  ) {}

  private repo(manager?: EntityManager): Repository<FinancingOffer> {
    return manager ? manager.getRepository(FinancingOffer) : this.repository;
  }

  findById(id: string, manager?: EntityManager): Promise<FinancingOffer | null> {
    return this.repo(manager).findOne({ where: { id } });
  }

  /** Required before deciding to accept an offer — see FinancingOffersService.acceptOffer. */
  findByIdForUpdate(id: string, manager: EntityManager): Promise<FinancingOffer | null> {
    return manager.findOne(FinancingOffer, { where: { id }, lock: { mode: 'pessimistic_write' } });
  }

  findByInvoiceId(invoiceId: string): Promise<FinancingOffer[]> {
    return this.repository.find({ where: { invoiceId }, order: { createdAt: 'DESC' } });
  }

  /** Backed by the partial unique index on (invoice_id) WHERE status='accepted'. */
  findAcceptedForInvoice(invoiceId: string, manager?: EntityManager): Promise<FinancingOffer | null> {
    return this.repo(manager).findOne({ where: { invoiceId, status: OfferStatus.ACCEPTED } });
  }

  async create(data: {
    invoiceId: string;
    financierId: string;
    advanceRate: string;
    advanceAmount: string;
    feeAmount: string;
    expiresAt: Date;
  }): Promise<FinancingOffer> {
    const offer = this.repository.create({ ...data, status: OfferStatus.PENDING });
    return this.repository.save(offer);
  }

  async markAccepted(id: string, manager: EntityManager): Promise<void> {
    await manager.update(FinancingOffer, { id }, { status: OfferStatus.ACCEPTED, decidedAt: new Date() });
  }

  /** Everyone else's still-pending bid loses once one offer is accepted. */
  async rejectOtherPendingOffers(invoiceId: string, acceptedOfferId: string, manager: EntityManager): Promise<void> {
    await manager.update(
      FinancingOffer,
      { invoiceId, id: Not(acceptedOfferId), status: OfferStatus.PENDING },
      { status: OfferStatus.REJECTED, decidedAt: new Date() },
    );
  }
}
