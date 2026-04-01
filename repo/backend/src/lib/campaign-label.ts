/**
 * Formats the A/B test banner label shown in the recommendation panel.
 *
 * SPEC: "showing clear UI feedback such as 'Test A active for 03/25/2026–04/08/2026.'"
 *
 * Dates arrive as YYYY-MM-DD strings from the PG `date` column and are
 * re-formatted to MM/DD/YYYY for display.
 *
 * Used by GET /recommendations (kiosk panel) and GET/POST/PUT /admin/campaigns.
 */

function toDisplayDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-');
  return `${month}/${day}/${year}`;
}

export function formatCampaignLabel(
  variant: string,
  startDate: string,
  endDate: string,
): string {
  return `Test ${variant} active for ${toDisplayDate(startDate)}–${toDisplayDate(endDate)}`;
}
