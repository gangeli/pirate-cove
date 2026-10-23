export const MONTH = 150; // game-seconds per month at normal speed (30 real minutes per year)
export const YEAR = MONTH * 12;
export const START_YEAR = 1680;
export const DT = 0.1;

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Apr 1680": the date a save slot shows */
export function shortDate(t: number): string {
  const m = Math.floor(t / MONTH);
  return `${SHORT_MONTHS[m % 12]} ${START_YEAR + Math.floor(m / 12)}`;
}
