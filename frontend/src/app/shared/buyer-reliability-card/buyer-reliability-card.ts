import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { BuyersService } from '../../core/services/buyers.service';
import { BuyerReliability, RELIABILITY_LABELS } from '../../core/models/buyer-reliability.model';

/**
 * Shown on both the financier and SME dashboards — the financier to price
 * risk, the SME to decide whether to keep extending credit terms to this
 * buyer. Fetches its own data from the buyer id it's given so neither
 * dashboard has to care how reliability is loaded.
 */
@Component({
  selector: 'app-buyer-reliability-card',
  imports: [],
  templateUrl: './buyer-reliability-card.html',
})
export class BuyerReliabilityCard {
  private readonly buyersService = inject(BuyersService);

  readonly buyerId = input.required<string>();

  readonly reliability = signal<BuyerReliability | null>(null);
  readonly loading = signal(false);
  readonly unavailable = signal(false);

  readonly ratingLabel = computed(() => {
    const rating = this.reliability()?.rating;
    return rating ? RELIABILITY_LABELS[rating] : '';
  });

  /**
   * Maps a rating onto the existing status-badge colours: green for a
   * dependable payer, amber for slipping, red for a real problem.
   */
  readonly ratingBadgeClass = computed(() => {
    switch (this.reliability()?.rating) {
      case 'reliable':
        return 'status-confirmed';
      case 'slightly_late':
        return 'status-pending';
      case 'habitually_late':
      case 'has_defaulted':
        return 'status-defaulted';
      default:
        return '';
    }
  });

  constructor() {
    // Refetches whenever the selected invoice (and so the buyer) changes.
    effect(() => {
      const id = this.buyerId();
      if (!id) return;
      this.loading.set(true);
      this.unavailable.set(false);
      this.buyersService.getReliability(id).subscribe({
        next: (reliability) => {
          this.reliability.set(reliability);
          this.loading.set(false);
        },
        error: () => {
          // Buyers themselves aren't permitted to read this; treat it as
          // simply not available rather than surfacing an error.
          this.reliability.set(null);
          this.unavailable.set(true);
          this.loading.set(false);
        },
      });
    });
  }
}
