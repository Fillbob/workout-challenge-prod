import { mapStravaScope, refreshStravaToken } from "@/lib/strava";
import { getServiceRoleClient } from "@/lib/supabase/admin";

type StravaActivity = {
  id: number;
  name: string;
  start_date: string;
  start_date_local: string;
  distance?: number;
  moving_time?: number;
  total_elevation_gain?: number;
  steps?: number;
  type?: string;
};

export type ChallengeRow = {
  id: string;
  start_date: string | null;
  end_date: string | null;
  team_ids?: string[] | null;
  hidden?: boolean | null;
  metric_type?: string | null;
  target_value?: number | null;
  target_unit?: string | null;
  activity_types?: string[] | null;
};

export type StravaConnection = {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  athlete_id?: number | null;
  last_synced_at?: string | null;
};

export type NormalizedActivity = {
  id: number;
  occurred_at: Date;
  metrics: {
    /** Strava reports meters; keep canonical storage in meters for downstream calculations. */
    distance_meters?: number;
    moving_time?: number;
    elevation?: number;
    steps?: number;
  };
  raw: StravaActivity;
};

export type StravaSyncResult = {
  userId: string;
  athleteId?: number | null;
  since: Date;
  fetchedActivities: number;
  processedActivities: number;
  matchedActivities: number;
  progressUpdates: number;
  pagesFetched?: number;
  warnings?: string[];
  afterUsed?: number;
  afterUsedIso?: string;
  missingTables?: string[];
  sampleActivities: Array<{
    id: number;
    name: string;
    type?: string;
    occurred_at: string;
    distance_meters?: number;
    moving_time?: number;
    steps?: number;
  }>;
  lastSyncedAt: string;
};

const STRAVA_ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities";
const INGESTION_LOOKBACK_DAYS = 30;
const SYNC_NOW_BUFFER_MINUTES = 5;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseIsoDate(value: string | null | undefined) {
  if (!value) return null;
  if (DATE_ONLY_PATTERN.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(year, month - 1, day);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addOneDay(date: Date) {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  return next;
}

export async function refreshConnectionIfNeeded(connection: StravaConnection) {
  const expiresAt = parseIsoDate(connection.expires_at);
  const shouldRefresh = !expiresAt || expiresAt.getTime() - Date.now() < 10 * 60 * 1000;

  if (!shouldRefresh) return connection;

  const refreshed = await refreshStravaToken(connection.refresh_token);
  const admin = getServiceRoleClient();
  const expiresAtIso = new Date(refreshed.expires_at * 1000).toISOString();

  await admin
    .from("strava_connections")
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: expiresAtIso,
      athlete_id: refreshed.athlete?.id ?? connection.athlete_id ?? null,
      scope: mapStravaScope(refreshed.scope),
      updated_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("user_id", connection.user_id);

  return {
    ...connection,
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token,
    expires_at: expiresAtIso,
    athlete_id: refreshed.athlete?.id ?? connection.athlete_id ?? null,
  } satisfies StravaConnection;
}

export function normalizeActivity(activity: StravaActivity): NormalizedActivity {
  const occurredAt = parseIsoDate(activity.start_date_local) ?? parseIsoDate(activity.start_date) ?? new Date();

  return {
    id: activity.id,
    occurred_at: occurredAt,
    metrics: {
      distance_meters: activity.distance ?? undefined,
      moving_time: activity.moving_time ?? undefined,
      elevation: activity.total_elevation_gain ?? undefined,
      steps: activity.steps ?? undefined,
    },
    raw: activity,
  };
}

export async function fetchRecentActivities(connection: StravaConnection, since?: Date) {
  const afterParam = since ? Math.floor(since.getTime() / 1000) : undefined;
  const params = new URLSearchParams({ per_page: "50" });
  if (afterParam) params.set("after", `${afterParam}`);

  const activities: NormalizedActivity[] = [];
  let page = 1;
  let pagesFetched = 0;

  while (true) {
    params.set("page", `${page}`);
    const response = await fetch(`${STRAVA_ACTIVITIES_URL}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${connection.access_token}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to load Strava activities: ${response.status} ${errorText}`);
    }

    const payload = (await response.json()) as StravaActivity[];
    activities.push(...payload.map(normalizeActivity));
    pagesFetched += 1;

    if (payload.length < 50) break;
    page += 1;
  }

  return { activities, pagesFetched };
}

export function activityMatchesChallenge(
  activity: NormalizedActivity,
  challenge: ChallengeRow,
  allowedTeamIds: string[] | null,
) {
  if (challenge.hidden) return false;
  if (!challenge.metric_type || !challenge.target_value) return false;

  const startDate = parseIsoDate(challenge.start_date);
  const endDate = parseIsoDate(challenge.end_date);
  const inclusiveEndDate =
    endDate && DATE_ONLY_PATTERN.test(challenge.end_date ?? "") ? addOneDay(endDate) : endDate;

  if (
    (startDate && activity.occurred_at < startDate) ||
    (inclusiveEndDate && activity.occurred_at >= inclusiveEndDate)
  ) {
    return false;
  }

  if (challenge.team_ids && challenge.team_ids.length > 0) {
    if (!allowedTeamIds) return false;
    const allowed = challenge.team_ids.some((teamId) => allowedTeamIds.includes(teamId));
    if (!allowed) return false;
  }

  if (challenge.activity_types && challenge.activity_types.length > 0) {
    const activityType = activity.raw.type;
    if (!activityType) return false;

    const normalizedActivityType = activityType.toLowerCase();
    const allowedTypes = challenge.activity_types
      .flatMap((type) => type.split(","))
      .map((type) => type.trim().toLowerCase())
      .filter(Boolean);

    if (!allowedTypes.includes(normalizedActivityType)) return false;
  }

  const metricValue = normalizeMetricValueForChallenge(activity, challenge);
  return typeof metricValue === "number" && Number.isFinite(metricValue) && metricValue > 0;
}

export function selectMetricValue(activity: NormalizedActivity, metricType: string) {
  switch (metricType) {
    case "distance":
      return activity.metrics.distance_meters;
    case "moving_time":
    case "duration":
      return activity.metrics.moving_time;
    case "elevation":
      return activity.metrics.elevation;
    case "steps":
      return activity.metrics.steps;
    default:
      return undefined;
  }
}

export function normalizeMetricValueForChallenge(activity: NormalizedActivity, challenge: ChallengeRow) {
  const rawMetricValue = selectMetricValue(activity, challenge.metric_type ?? "");
  if (typeof rawMetricValue !== "number" || Number.isNaN(rawMetricValue)) return undefined;

  if (challenge.metric_type === "distance") {
    return normalizeDistanceValue(rawMetricValue);
  }

  return rawMetricValue;
}

function normalizeDistanceValue(distanceMeters: number) {
  // Strava delivers meters; keep this as the canonical storage unit.
  return distanceMeters;
}

export async function loadActiveChallenges() {
  const admin = getServiceRoleClient();
  const { data, error } = await admin
    .from("challenges")
    .select(
      "id, start_date, end_date, team_ids, hidden, metric_type, target_value, target_unit, activity_types",
    )
    .eq("hidden", false);

  if (error) throw error;
  const now = new Date();
  return (data as ChallengeRow[]).filter((challenge) => {
    const start = parseIsoDate(challenge.start_date);
    const end = parseIsoDate(challenge.end_date);
    if (start && start > now) return false;
    if (end && end < now) return false;
    return true;
  });
}

export async function fetchTeamIdsForUser(userId: string) {
  const admin = getServiceRoleClient();
  const { data, error } = await admin
    .from("team_members")
    .select("team_id")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map((row) => row.team_id as string);
}

export function getDefaultSinceDate(lastSyncedAt?: string | null) {
  const fallback = new Date();
  fallback.setDate(fallback.getDate() - INGESTION_LOOKBACK_DAYS);
  const parsedLast = parseIsoDate(lastSyncedAt ?? undefined);
  if (parsedLast) return parsedLast;
  return fallback;
}

export function startOfWeekUtc(now: Date) {
  const day = now.getUTCDay();
  const diffToMonday = (day + 6) % 7;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - diffToMonday);
  return start;
}

export function computeAfterForSyncNow({
  now,
  challengeStart,
  weekStart,
}: {
  now: Date;
  challengeStart?: Date | null;
  weekStart?: Date | null;
}) {
  const week = weekStart ?? startOfWeekUtc(now);
  const challengeStartDate = challengeStart ?? null;
  const base = challengeStartDate ? (challengeStartDate > week ? challengeStartDate : week) : week;
  const buffered = new Date(base.getTime() - SYNC_NOW_BUFFER_MINUTES * 60 * 1000);
  return Math.floor(buffered.getTime() / 1000);
}

export type SyncContext = {
  missingTables: Set<string>;
};
