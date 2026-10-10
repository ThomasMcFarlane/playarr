/** The web's `runtimeLabel` (lib/detailMeta.ts): "1h 48m", "2h" or "45m"; null for no runtime. */
export function runtimeLabel(
  ms: number | null | undefined,
  t: (key: 'pages.workDetail.runtimeMinutes' | 'pages.workDetail.runtimeHours' | 'pages.workDetail.runtimeHoursMinutes', params: Record<string, number>) => string,
): string | null {
  if (!ms || ms <= 0) return null;
  const total = Math.max(1, Math.round(ms / 60_000));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours <= 0) return t('pages.workDetail.runtimeMinutes', {minutes});
  return minutes > 0 ? t('pages.workDetail.runtimeHoursMinutes', {hours, minutes}) : t('pages.workDetail.runtimeHours', {hours});
}
