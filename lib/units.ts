export const METERS_PER_MILE = 1609.344;

export function metersToMiles(meters: number): number {
  if (!Number.isFinite(meters)) return NaN;
  return meters / METERS_PER_MILE;
}

export function milesToMeters(miles: number): number {
  if (!Number.isFinite(miles)) return NaN;
  return miles * METERS_PER_MILE;
}

export function formatMiles(miles: number, decimals = 2): string {
  if (!Number.isFinite(miles)) return "0";
  return miles.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
