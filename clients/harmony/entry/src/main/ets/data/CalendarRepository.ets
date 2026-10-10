/** `GET /api/v1/calendar`: the release calendar for an inclusive range of UTC days. */

import { getPlayarrClient } from '../AppContainer';
import { ApiResult } from '../net/ApiResult';
import { calendarUrl } from '../core/Endpoints.ts';
import { CalendarResponse } from '../core/Types/Calendar.ts';

export function getCalendar(start: string, end: string): Promise<ApiResult<CalendarResponse>> {
  return getPlayarrClient().getJson<CalendarResponse>(calendarUrl(start, end));
}
