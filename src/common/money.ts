import Decimal from 'decimal.js';

/**
 * All money arithmetic in the app goes through this, never native `+`/`*`
 * on numbers — NUMERIC columns come back from Postgres as strings
 * specifically to avoid float precision loss, and native JS math on
 * currency amounts would throw that guarantee away immediately.
 */
export class Money {
  private readonly value: Decimal;

  private constructor(value: Decimal) {
    this.value = value;
  }

  static of(amount: string | number): Money {
    return new Money(new Decimal(amount));
  }

  static zero(): Money {
    return new Money(new Decimal(0));
  }

  plus(other: Money): Money {
    return new Money(this.value.plus(other.value));
  }

  minus(other: Money): Money {
    return new Money(this.value.minus(other.value));
  }

  times(multiplier: string | number): Money {
    return new Money(this.value.times(multiplier));
  }

  isPositive(): boolean {
    return this.value.greaterThan(0);
  }

  isNegative(): boolean {
    return this.value.lessThan(0);
  }

  lessThanOrEqualTo(other: Money): boolean {
    return this.value.lessThanOrEqualTo(other.value);
  }

  greaterThan(other: Money): boolean {
    return this.value.greaterThan(other.value);
  }

  equals(other: Money): boolean {
    return this.value.equals(other.value);
  }

  /** Rounded to 2 decimal places — the shape every NUMERIC(14,2) column expects. */
  toFixed(): string {
    return this.value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
  }
}
