/** Step for g/ml amounts: 10 below 100, 50 below 1000, 100 from there. Counts and days step by 1. */
export function amountStep(unit: string | undefined, value: number | null): number {
  if (unit !== 'g' && unit !== 'ml') return 1
  const v = value ?? 0
  return v >= 1000 ? 100 : v >= 100 ? 50 : 10
}
