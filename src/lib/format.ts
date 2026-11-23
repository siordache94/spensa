// Number rounding for the quantities the Shop, Pantry and Use-soon screens show. One definition, so the three screens
// agree. Math.round: a half rounds up, and nothing goes through a string. (toFixed rounds exact binary halves the other
// way: 0.1235 gives 0.124 here and 0.123 with toFixed. Only a 4+ decimal input can tell the two apart.)
export const round1 = (n: number) => Math.round(n * 10) / 10
export const round3 = (n: number) => Math.round(n * 1000) / 1000
