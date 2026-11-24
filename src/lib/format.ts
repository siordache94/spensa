// Number rounding for the quantities the Shop, Pantry and Use-soon screens show. One definition, so the three screens
// agree. Math.round: a half rounds up, and nothing goes through a string. (toFixed rounds exact binary halves the other
// way: 0.1235 gives 0.124 here and 0.123 with toFixed. Only a 4+ decimal input can tell the two apart.)
export const round1 = (n: number) => Math.round(n * 10) / 10
export const round3 = (n: number) => Math.round(n * 1000) / 1000

/** The one locale for dates. The UI is English-only, so a non-English phone never translates half of it. */
export const DATE_LOCALE = 'en-GB'

/** A calendar day (YYYY-MM-DD) has no time and no zone: parse it at UTC midnight so no local offset moves it. */
const calendarDay = (day: string) => new Date(`${day}T00:00:00Z`)

/**
 * One date formatter for every surface: en-GB, UTC calendar days. Pass Intl options for the shape a place needs;
 * the default is the short date the shop, pantry and use-soon rows share ("23 Nov").
 */
export function formatDay(day: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  return calendarDay(day).toLocaleDateString(DATE_LOCALE, { timeZone: 'UTC', ...options })
}

/**
 * The unit shown beside a figure. `count` is a storage unit, never a visible one: four of something reads "4".
 * `to_taste` is drawn as a word in the amount column, not as a unit.
 */
export function visibleUnit(unit: string | null | undefined): string {
  return unit && unit !== 'count' && unit !== 'to_taste' ? unit : ''
}

/** A quantity in running text: "300 g", "4" (count), never "4 count". */
export function formatQuantity(value: number, unit?: string | null): string {
  const label = visibleUnit(unit)
  return label ? `${value} ${label}` : `${value}`
}
