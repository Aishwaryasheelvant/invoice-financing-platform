export enum AccountType {
  WALLET = 'wallet',
  ESCROW = 'escrow',
  REVENUE = 'revenue',
  /**
   * Represents money in transit between the platform and the outside
   * world (e.g. a buyer's bank payment landing in escrow). Without a real
   * payment gateway there's no external account to book the other side
   * of that entry against, so this single platform-owned account plays
   * that role — keeping every transaction's debits equal to its credits
   * even for money that "arrives from outside".
   */
  CLEARING = 'clearing',
}
