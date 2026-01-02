import {
  activityMatchesChallenge,
  fetchRecentActivities,
  fetchTeamIdsForUser,
  getDefaultSinceDate,
  loadActiveChallenges,
  refreshConnectionIfNeeded,
  selectMetricValue,
  type ChallengeRow,
  type StravaConnection,
  type StravaSyncResult,
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

function normalizeSchemaError(error: unknown, context: string) {
  const message = extractErrorMessage(error);

  if (message.includes("public.submission_progress")) {
    return `${context}: missing submission_progress table. Apply sql/strava_ingestion.sql to Supabase and reload the schema cache.`;
  }

  if (message.includes("public.strava_activity_ingestions")) {
    return `${context}: missing strava_activity_ingestions table. Apply sql/strava_ingestion.sql to Supabase and reload the schema cache.`;
  }

  if (message.includes("public.strava_sync_logs")) {
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

async function loadExistingProgress(userId: string, challengeIds: string[]) {
  const admin = getServiceRoleClient();
  const { data, error } = await admin
    .from("submission_progress")
    .select("challenge_id, progress_value")
    .eq("user_id", userId)
    .in("challenge_id", challengeIds);

  if (error) throw new Error(normalizeSchemaError(error, "Failed to load submission progress"));
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

async function markActivityProcessed(userId: string, activityId: number, raw_payload: unknown) {
  const admin = getServiceRoleClient();
  const { error } = await admin
    .from("strava_activity_ingestions")
    .insert({ user_id: userId, activity_id: activityId, raw_payload });

  if (error) {
    throw new Error(normalizeSchemaError(error, "Failed to record ingestion"));
  }
}

async function wasActivityProcessed(activityId: number) {
  const admin = getServiceRoleClient();
  const { count, error } = await admin
    .from("strava_activity_ingestions")
    .select("id", { count: "exact", head: true })
    .eq("activity_id", activityId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

async function upsertSubmissionProgress(
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
    throw new Error(normalizeSchemaError(error, "Failed to upsert submission progress"));
  }
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

async function syncConnection(connection: StravaConnection, challenges: ChallengeRow[]): Promise<StravaSyncResult> {
  const admin = getServiceRoleClient();
  const refreshed = await refreshConnectionIfNeeded(connection);
  const allowedTeamIds = await fetchTeamIdsForUser(refreshed.user_id);

  const permittedChallenges = challenges.filter((challenge) => {
    if (challenge.team_ids && challenge.team_ids.length > 0) {
      return challenge.team_ids.some((teamId) => allowedTeamIds.includes(teamId));
    }
    return true;
  });

  const challengeIds = permittedChallenges.map((challenge) => challenge.id);
  const existingProgressTotals = await loadExistingProgress(refreshed.user_id, challengeIds);
  const existingSubmissions = await loadExistingCompletion(refreshed.user_id, challengeIds);

  const since = getDefaultSinceDate(refreshed.last_synced_at);
  const activities = await fetchRecentActivities(refreshed, since);
  const newProgress: Map<string, number> = new Map();
  let processedActivities = 0;
  let matchedActivities = 0;
  let progressUpdates = 0;

  const sampleActivities = activities.slice(0, 5).map((activity) => ({
    id: activity.id,
    name: activity.raw.name,
    type: activity.raw.type,
    occurred_at: activity.occurred_at.toISOString(),
    distance: activity.metrics.distance,
    moving_time: activity.metrics.moving_time,
    steps: activity.metrics.steps,
  }));

  for (const activity of activities) {
    if (await wasActivityProcessed(activity.id)) continue;
    processedActivities += 1;
    let matchedThisActivity = false;

    for (const challenge of permittedChallenges) {
      if (!challenge.metric_type || !challenge.target_value) continue;
      if (!activityMatchesChallenge(activity, challenge, allowedTeamIds)) continue;
      const metricValue = selectMetricValue(activity, challenge.metric_type!);
      if (typeof metricValue !== "number") continue;

      await upsertSubmissionProgress(
        refreshed.user_id,
        challenge.id,
        activity.id,
        metricValue,
        challenge.target_value ?? null,
        false,
        null,
      );

      const current = newProgress.get(challenge.id) ?? 0;
      newProgress.set(challenge.id, current + metricValue);
      matchedThisActivity = true;
      progressUpdates += 1;
    }

    if (matchedThisActivity) matchedActivities += 1;
    await markActivityProcessed(refreshed.user_id, activity.id, activity.raw);
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

  return {
    userId: refreshed.user_id,
    athleteId: refreshed.athlete_id ?? null,
    since,
    fetchedActivities: activities.length,
    processedActivities,
    matchedActivities,
    progressUpdates,
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
        const result = await syncConnection(connection, challenges);
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

    return NextResponse.json({ status: "processed", connections: connections.length, last_synced_at: latestSyncedAt, results });
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
