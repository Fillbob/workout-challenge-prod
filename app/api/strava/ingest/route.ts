import {
  activityMatchesChallenge,
  fetchRecentActivities,
  fetchTeamIdsForUser,
  getDefaultSinceDate,
  loadActiveChallenges,
  normalizeMetricValueForChallenge,
  computeAfterForSyncNow,
  startOfWeekUtc,
  parseIsoDate,
  refreshConnectionIfNeeded,
  type ChallengeRow,
  type StravaConnection,
  type StravaSyncResult,
  type SyncContext,
} from "@/lib/stravaIngestion";
import { getServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const CRON_SECRET = process.env.STRAVA_CRON_SECRET;
const STRAVA_WEBHOOK_SECRET = process.env.STRAVA_WEBHOOK_SECRET;

async function authorizeWithSecret(request: Request, athleteId: number | null) {
  if (athleteId && STRAVA_WEBHOOK_SECRET) {
    const webhookSecret = request.headers.get("x-strava-webhook-secret");
    if (webhookSecret === STRAVA_WEBHOOK_SECRET) return true;
  }

  if (CRON_SECRET) {
    const headerSecret = request.headers.get("x-cron-secret");
    if (headerSecret === CRON_SECRET) return true;
  }

  return false;
}

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Unknown error";
}

function isMissingTableError(error: unknown, table: string) {
  const message = extractErrorMessage(error).toLowerCase();
  const normalizedTable = `public.${table}`.toLowerCase();
  return message.includes(normalizedTable) || message.includes(`missing ${table.toLowerCase()} table`);
}

function normalizeSchemaError(error: unknown, context: string, syncContext?: SyncContext) {
  const message = extractErrorMessage(error);

  const registerMissingTable = (table: string) => {
    syncContext?.missingTables.add(table);
  };

  if (message.includes("public.submission_progress")) {
    registerMissingTable("submission_progress");
    return `${context}: missing submission_progress table. Apply sql/strava_ingestion.sql to Supabase and reload the schema cache.`;
  }

  if (message.includes("public.strava_activity_ingestions")) {
    registerMissingTable("strava_activity_ingestions");
    return `${context}: missing strava_activity_ingestions table. Apply sql/strava_ingestion.sql to Supabase and reload the schema cache.`;
  }

  if (message.includes("public.strava_sync_logs")) {
    registerMissingTable("strava_sync_logs");
    return `${context}: missing strava_sync_logs table. Apply sql/strava_ingestion.sql to Supabase and reload the schema cache.`;
  }

  return `${context}: ${message}`;
}

async function loadConnections(athleteId?: number | null) {
  const admin = getServiceRoleClient();
  const query = admin
    .from("strava_connections")
    .select("user_id, access_token, refresh_token, expires_at, athlete_id, last_synced_at");

  if (athleteId) {
    query.eq("athlete_id", athleteId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

async function loadUserConnections(userId: string) {
  const admin = getServiceRoleClient();
  const { data, error } = await admin
    .from("strava_connections")
    .select("user_id, access_token, refresh_token, expires_at, athlete_id, last_synced_at")
    .eq("user_id", userId);

  if (error) throw error;
  return data ?? [];
}

async function loadExistingProgress(syncContext: SyncContext, userId: string, challengeIds: string[]) {
  const admin = getServiceRoleClient();
  const { data, error } = await admin
    .from("submission_progress")
    .select("challenge_id, progress_value")
    .eq("user_id", userId)
    .in("challenge_id", challengeIds);

  if (error) {
    if (isMissingTableError(error, "submission_progress")) {
      console.warn("Submission progress table missing; proceeding without historical totals");
      syncContext.missingTables.add("submission_progress");
      return new Map<string, number>();
    }
    throw new Error(normalizeSchemaError(error, "Failed to load submission progress", syncContext));
  }
  const totals = new Map<string, number>();
  (data ?? []).forEach((row) => {
    const current = totals.get(row.challenge_id) ?? 0;
    totals.set(row.challenge_id, current + Number(row.progress_value ?? 0));
  });
  return totals;
}

async function loadExistingCompletion(userId: string, challengeIds: string[]) {
  const admin = getServiceRoleClient();
  const { data, error } = await admin
    .from("submissions")
    .select("challenge_id, completed, completed_at")
    .eq("user_id", userId)
    .in("challenge_id", challengeIds);
  if (error) throw error;
  const completion = new Map<string, { completed: boolean; completed_at: string | null }>();
  (data ?? []).forEach((row) => {
    completion.set(row.challenge_id, {
      completed: Boolean(row.completed),
      completed_at: row.completed_at ?? null,
    });
  });
  return completion;
}

async function markActivityProcessed(syncContext: SyncContext, userId: string, activityId: number, raw_payload: unknown) {
  const admin = getServiceRoleClient();
  const { error } = await admin
    .from("strava_activity_ingestions")
    .insert({ user_id: userId, activity_id: activityId, raw_payload });

  if (error) {
    if (isMissingTableError(error, "strava_activity_ingestions")) {
      console.warn("Strava ingestion table missing; skipping ingestion record");
      syncContext.missingTables.add("strava_activity_ingestions");
      return;
    }
    throw new Error(normalizeSchemaError(error, "Failed to record ingestion", syncContext));
  }
}

async function wasActivityProcessed(syncContext: SyncContext, activityId: number) {
  const admin = getServiceRoleClient();
  const { count, error } = await admin
    .from("strava_activity_ingestions")
    .select("id", { count: "exact", head: true })
    .eq("activity_id", activityId);
  if (error) {
    if (isMissingTableError(error, "strava_activity_ingestions")) {
      console.warn("Strava ingestion table missing; treating activities as unprocessed");
      syncContext.missingTables.add("strava_activity_ingestions");
      return false;
    }
    throw error;
  }
  return (count ?? 0) > 0;
}

async function upsertSubmissionProgress(
  syncContext: SyncContext,
  userId: string,
  challengeId: string,
  activityId: number,
  progress: number,
  target: number | null,
  completed: boolean,
  completedAt: string | null,
) {
  const admin = getServiceRoleClient();
  const { error } = await admin
    .from("submission_progress")
    .upsert(
      {
        user_id: userId,
        challenge_id: challengeId,
        activity_id: activityId,
        progress_value: progress,
        target_value: target,
        completed,
        completed_at: completedAt,
      },
      { onConflict: "challenge_id,user_id,activity_id" },
    );

  if (error) {
    if (isMissingTableError(error, "submission_progress")) {
      console.warn("Submission progress table missing; skipping progress upsert");
      syncContext.missingTables.add("submission_progress");
      return false;
    }
    throw new Error(normalizeSchemaError(error, "Failed to upsert submission progress", syncContext));
  }
  return true;
}

async function upsertSubmission(userId: string, challengeId: string, completed: boolean, completedAt: string | null) {
  const admin = getServiceRoleClient();
  await admin
    .from("submissions")
    .upsert(
      {
        user_id: userId,
        challenge_id: challengeId,
        completed,
        completed_at: completed ? completedAt ?? new Date().toISOString() : null,
      },
      { onConflict: "challenge_id,user_id" },
    );
}

async function recordSyncLog({
  connection,
  result,
  startedAt,
  finishedAt,
  status,
  error,
}: {
  connection: StravaConnection;
  result?: StravaSyncResult;
  startedAt: Date;
  finishedAt: Date;
  status: "success" | "error";
  error?: string | null;
}) {
  const admin = getServiceRoleClient();
  const warnings = [
    ...(result?.missingTables ?? []),
    ...(result?.warnings ?? []),
  ];
  const { error: logError } = await admin.from("strava_sync_logs").insert({
    user_id: result?.userId ?? connection.user_id,
    athlete_id: result?.athleteId ?? connection.athlete_id ?? null,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    since: result?.since?.toISOString() ?? null,
    fetched_activities: result?.fetchedActivities ?? null,
    processed_activities: result?.processedActivities ?? null,
    matched_activities: result?.matchedActivities ?? null,
    progress_updates: result?.progressUpdates ?? null,
    sample_activities: result?.sampleActivities ?? null,
    warnings: warnings.length > 0 ? Array.from(new Set(warnings)) : null,
    status,
    error: error ?? null,
  });

  if (logError) {
    console.error("Failed to persist Strava sync log", {
      message: logError.message,
      details: logError.details,
      hint: logError.hint,
      code: logError.code,
    });
  }
}

async function syncConnection(
  connection: StravaConnection,
  challenges: ChallengeRow[],
  options?: { sinceOverride?: Date; warnings?: string[]; afterUsedSeconds?: number },
): Promise<StravaSyncResult> {
  const admin = getServiceRoleClient();
  const refreshed = await refreshConnectionIfNeeded(connection);
  const allowedTeamIds = await fetchTeamIdsForUser(refreshed.user_id);
  const syncContext: SyncContext = { missingTables: new Set<string>() };

  const permittedChallenges = challenges.filter((challenge) => {
    if (challenge.team_ids && challenge.team_ids.length > 0) {
      return challenge.team_ids.some((teamId) => allowedTeamIds.includes(teamId));
    }
    return true;
  });

  const challengeIds = permittedChallenges.map((challenge) => challenge.id);
  const existingProgressTotals = await loadExistingProgress(syncContext, refreshed.user_id, challengeIds);
  const existingSubmissions = await loadExistingCompletion(refreshed.user_id, challengeIds);

  const since = options?.sinceOverride ?? getDefaultSinceDate(refreshed.last_synced_at);
  const afterUsedSeconds = options?.afterUsedSeconds ?? Math.floor(since.getTime() / 1000);
  const { activities, pagesFetched } = await fetchRecentActivities(refreshed, since);
  const newProgress: Map<string, number> = new Map();
  let processedActivities = 0;
  let matchedActivities = 0;
  let progressUpdates = 0;
  const warnings = [...(options?.warnings ?? [])];

  const sampleActivities = activities.slice(0, 5).map((activity) => ({
    id: activity.id,
    name: activity.raw.name,
    type: activity.raw.type,
    occurred_at: activity.occurred_at.toISOString(),
    distance_meters: activity.metrics.distance_meters,
    moving_time: activity.metrics.moving_time,
    steps: activity.metrics.steps,
  }));

  for (const activity of activities) {
    if (await wasActivityProcessed(syncContext, activity.id)) continue;
    processedActivities += 1;
    let matchedThisActivity = false;

    for (const challenge of permittedChallenges) {
      if (!challenge.metric_type || !challenge.target_value) continue;
      if (!activityMatchesChallenge(activity, challenge, allowedTeamIds)) continue;
      const metricValue = normalizeMetricValueForChallenge(activity, challenge);
      if (typeof metricValue !== "number") continue;

      const progressRecorded = await upsertSubmissionProgress(
        syncContext,
        refreshed.user_id,
        challenge.id,
        activity.id,
        metricValue,
        challenge.target_value ?? null,
        false,
        null,
      );

      if (progressRecorded) {
        const current = newProgress.get(challenge.id) ?? 0;
        newProgress.set(challenge.id, current + metricValue);
        matchedThisActivity = true;
        progressUpdates += 1;
      }
    }

    if (matchedThisActivity) matchedActivities += 1;
    await markActivityProcessed(syncContext, refreshed.user_id, activity.id, activity.raw);
  }

  for (const challenge of permittedChallenges) {
    const totalProgress = (existingProgressTotals.get(challenge.id) ?? 0) + (newProgress.get(challenge.id) ?? 0);
    const target = Number(challenge.target_value ?? 0);
    const completed = target > 0 ? totalProgress >= target : false;
    const existing = existingSubmissions.get(challenge.id);
    const completedAt = existing?.completed_at ?? (completed ? new Date().toISOString() : null);

    await upsertSubmission(refreshed.user_id, challenge.id, completed || existing?.completed === true, completedAt);
  }

  const lastSyncedAt = new Date().toISOString();

  await admin
    .from("strava_connections")
    .update({ last_synced_at: lastSyncedAt, last_error: null })
    .eq("user_id", refreshed.user_id);

  const activityTimes = activities.map((activity) => activity.occurred_at.getTime());
  const earliestActivity = activityTimes.length > 0 ? new Date(Math.min(...activityTimes)).toISOString() : null;
  const latestActivity = activityTimes.length > 0 ? new Date(Math.max(...activityTimes)).toISOString() : null;
  const afterUsedIso = new Date(afterUsedSeconds * 1000).toISOString();
  console.log("[strava-sync] window", {
    user_id: refreshed.user_id,
    athlete_id: refreshed.athlete_id,
    after_used: afterUsedSeconds,
    after_used_iso: afterUsedIso,
    activities: activities.length,
    pages_fetched: pagesFetched,
    earliest_activity: earliestActivity,
    latest_activity: latestActivity,
  });

  return {
    userId: refreshed.user_id,
    athleteId: refreshed.athlete_id ?? null,
    since,
    afterUsed: afterUsedSeconds,
    afterUsedIso,
    fetchedActivities: activities.length,
    processedActivities,
    matchedActivities,
    progressUpdates,
    pagesFetched,
    warnings: warnings.length > 0 ? warnings : undefined,
    missingTables: syncContext.missingTables.size > 0 ? Array.from(syncContext.missingTables) : undefined,
    sampleActivities,
    lastSyncedAt,
  } satisfies StravaSyncResult;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const challenge = url.searchParams.get("hub.challenge");
  const token = url.searchParams.get("hub.verify_token");
  if (challenge && token === STRAVA_WEBHOOK_SECRET) {
    return NextResponse.json({ "hub.challenge": challenge });
  }
  return NextResponse.json({ status: "ok" });
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({}));
  const athleteId = payload?.owner_id ?? payload?.athlete_id ?? null;

  const isSecretAuthorized = await authorizeWithSecret(request, athleteId);

  try {
    const challenges = await loadActiveChallenges();
    if (challenges.length === 0) {
      return NextResponse.json({ status: "no_challenges" });
    }

    let connections: StravaConnection[];
    const results: StravaSyncResult[] = [];
    let latestSyncedAt: string | null = null;
    if (isSecretAuthorized) {
      connections = await loadConnections(athleteId);
    } else {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      connections = await loadUserConnections(user.id);
      if (connections.length === 0) {
        return NextResponse.json({ error: "No Strava connection found" }, { status: 403 });
      }
    }
    for (const connection of connections) {
      const startedAt = new Date();
      try {
        const syncWarnings: string[] = [];
        let sinceOverride: Date | undefined;
        if (!isSecretAuthorized) {
          const now = new Date();
          const weekStart = startOfWeekUtc(now);
          const challengeStarts = challenges
            .map((challenge) => parseIsoDate(challenge.start_date))
            .filter((date): date is Date => Boolean(date));
          const earliestChallengeStart =
            challengeStarts.length > 0
              ? new Date(Math.min(...challengeStarts.map((date) => date.getTime())))
              : null;
          const afterSeconds = computeAfterForSyncNow({
            now,
            challengeStart: earliestChallengeStart,
            weekStart,
          });
          sinceOverride = new Date(afterSeconds * 1000);
          syncWarnings.push("mode=sync_now_window", `after=${sinceOverride.toISOString()}`);
        }

        const result = await syncConnection(connection, challenges, {
          sinceOverride,
          warnings: syncWarnings,
          afterUsedSeconds: sinceOverride ? Math.floor(sinceOverride.getTime() / 1000) : undefined,
        });
        results.push(result);
        if (!latestSyncedAt) latestSyncedAt = result.lastSyncedAt;
        await recordSyncLog({
          connection,
          result,
          startedAt,
          finishedAt: new Date(),
          status: "success",
        });
      } catch (error) {
        const admin = getServiceRoleClient();
        const message = extractErrorMessage(error);
        console.error("Strava sync failed", {
          user_id: connection.user_id,
          athlete_id: connection.athlete_id,
          error: message,
        });
        await admin
          .from("strava_connections")
          .update({ last_error: message, updated_at: new Date().toISOString() })
          .eq("user_id", connection.user_id);
        await recordSyncLog({
          connection,
          startedAt,
          finishedAt: new Date(),
          status: "error",
          error: message,
        });
      }
    }

    const responseResults = results.map((result) => ({
      ...result,
      after_used: result.afterUsed ?? Math.floor(result.since.getTime() / 1000),
      after_used_iso: result.afterUsedIso ?? result.since.toISOString(),
    }));

    return NextResponse.json({
      status: "processed",
      connections: connections.length,
      last_synced_at: latestSyncedAt,
      results: responseResults,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error && "message" in error
          ? String((error as { message: unknown }).message)
          : "Unable to ingest Strava data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
