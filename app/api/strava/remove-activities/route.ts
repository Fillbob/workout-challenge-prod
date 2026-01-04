import { getServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => ({}));
  const activityIds: number[] = Array.isArray(payload.activityIds)
    ? payload.activityIds
        .map((id: unknown) => Number(id))
        .filter((id: number): id is number => Number.isFinite(id))
    : [];

  if (activityIds.length === 0) {
    return NextResponse.json({ error: "activityIds must be a non-empty array" }, { status: 400 });
  }

  const admin = getServiceRoleClient();

  const { data: rowsToDelete, error: selectError } = await admin
    .from("submission_progress")
    .select("activity_id, challenge_id")
    .eq("user_id", user.id)
    .in("activity_id", activityIds);

  if (selectError) {
    return NextResponse.json({ error: selectError.message }, { status: 400 });
  }

  const { error: deleteProgressError } = await admin
    .from("submission_progress")
    .delete()
    .eq("user_id", user.id)
    .in("activity_id", activityIds);

  if (deleteProgressError) {
    return NextResponse.json({ error: deleteProgressError.message }, { status: 400 });
  }

  const { error: deleteIngestionsError } = await admin
    .from("strava_activity_ingestions")
    .delete()
    .eq("user_id", user.id)
    .in("activity_id", activityIds);

  if (deleteIngestionsError) {
    console.warn("Unable to delete activity ingestions", deleteIngestionsError.message);
  }

  const affectedChallenges = Array.from(
    new Set((rowsToDelete ?? []).map((row) => String(row.challenge_id)).filter(Boolean)),
  );

  if (affectedChallenges.length > 0) {
    const { data: remaining, error: remainingError } = await admin
      .from("submission_progress")
      .select("challenge_id, progress_value")
      .eq("user_id", user.id)
      .in("challenge_id", affectedChallenges);

    if (!remainingError) {
      const totals = new Map<string, number>();
      (remaining ?? []).forEach((row) => {
        const challengeId = String(row.challenge_id);
        const current = totals.get(challengeId) ?? 0;
        const value = typeof row.progress_value === "number" ? Number(row.progress_value) : 0;
        totals.set(challengeId, current + value);
      });

      const { data: challenges, error: challengeError } = await admin
        .from("challenges")
        .select("id, target_value")
        .in("id", affectedChallenges);

      if (!challengeError) {
        const targetLookup = new Map<string, number | null>();
        (challenges ?? []).forEach((challenge) => {
          const parsedTarget = Number(challenge.target_value);
          targetLookup.set(challenge.id as string, Number.isFinite(parsedTarget) ? parsedTarget : null);
        });

        const { data: existingSubmissions } = await admin
          .from("submissions")
          .select("challenge_id, completed_at")
          .eq("user_id", user.id)
          .in("challenge_id", affectedChallenges);

        const completedAtLookup = new Map<string, string | null>();
        (existingSubmissions ?? []).forEach((row) => {
          completedAtLookup.set(String(row.challenge_id), row.completed_at ?? null);
        });

        const updates = affectedChallenges.map((challengeId) => {
          const totalProgress = totals.get(challengeId) ?? 0;
          const target = targetLookup.get(challengeId);
          const completed = typeof target === "number" && target > 0 ? totalProgress >= target : false;
          const progressPercent = typeof target === "number" && target > 0 ? (totalProgress / target) * 100 : null;
          const existingCompletedAt = completedAtLookup.get(challengeId) ?? null;

          return {
            challenge_id: challengeId,
            user_id: user.id,
            progress_value: totalProgress,
            progress_percent: progressPercent,
            completed,
            completed_at: completed ? existingCompletedAt ?? new Date().toISOString() : null,
          };
        });

        const { error: upsertError } = await admin
          .from("submissions")
          .upsert(updates, { onConflict: "challenge_id,user_id" });

        if (upsertError) {
          console.warn("Unable to refresh submissions after deletion", upsertError.message);
        }
      }
    }
  }

  return NextResponse.json({
    removed: activityIds.length,
    affectedChallenges,
    message: "Selected activities removed",
  });
}
