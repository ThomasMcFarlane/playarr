/** Web TV shell clock text: "04:06" and "Sun 11 October" (shown uppercase). English names only. */

const WEEKDAYS: string[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS: string[] = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

export function clockTime(now: Date): string {
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

export function clockDate(now: Date): string {
  return `${WEEKDAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`;
}
