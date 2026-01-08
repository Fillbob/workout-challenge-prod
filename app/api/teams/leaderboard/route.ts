import { getServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const DEFAULT_LIMIT = 25;

type ChallengeRelation =
  | { title?: string | null; base_points: number | null }
  | { title?: string | null; base_points: number | null }[]
  | null;

type ContributionRow = {
  user_id: string;
  completed_at: string | null;
  challenge_id: string;
  challenges: ChallengeRelation;
};

type StatsRow = {
  user_id: string;
  challenges: ChallengeRelation;
};

type ProgressRow = {
  user_id: string;
  challenge_id: string;
  completed: boolean | null;
  progress_percent: number | null;
};

type ChallengeRow = {
  id: string;
  team_ids: string[] | null;
  hidden: boolean | null;
  base_points: number | null;
  week_index: number | null;
  start_date: string | null;
  end_date: string | null;
};

function extractChallenge(relation: ChallengeRelation) {
  if (Array.isArray(relation)) {
    return relation[0];
  }
  return relation ?? undefined;
}

function parseDate(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function clampPercent(value: number) {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const teamId = searchParams.get("teamId");
  const limit = Number.parseInt(searchParams.get("limit") ?? `${DEFAULT_LIMIT}`, 10);
  const offset = Number.parseInt(searchParams.get("offset") ?? "0", 10);

  if (!teamId) {
    return NextResponse.json({ error: "teamId is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceRoleClient();

  const { data: memberRows, error: membersError } = await admin
    .from("team_members")
    .select("user_id")
    .eq("team_id", teamId);

  if (membersError) {
    return NextResponse.json({ error: membersError.message }, { status: 400 });
  }

  const memberIds = (memberRows ?? []).map((row) => row.user_id);

  if (memberIds.length === 0) {
    return NextResponse.json({ leaderboard: [], contributions: {}, hasMore: false, total: 0, maxAvailablePoints: 0 });
  }

  const { data: profileRows, error: profileError } = await admin
    .from("profiles")
    .select("id, display_name, profile_icon")
    .in("id", memberIds);

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  const nameMap = new Map<string, string>();
  const iconMap = new Map<string, string>();
  (profileRows ?? []).forEach((profile) => {
    nameMap.set(profile.id, profile.display_name ?? "Member");
    if (profile.profile_icon) {
      iconMap.set(profile.id, profile.profile_icon);
    }
  });

  const { data: challengeRows, error: challengeError } = await admin
    .from("challenges")
    .select("id, team_ids, hidden, base_points, week_index, start_date, end_date");

  if (challengeError) {
    return NextResponse.json({ error: challengeError.message }, { status: 400 });
  }

  const allowedChallenges = (challengeRows as ChallengeRow[] | null)?.filter(
    (challenge) =>
      !challenge.hidden &&
      (!challenge.team_ids ||
        challenge.team_ids.length === 0 ||
        (Array.isArray(challenge.team_ids) && challenge.team_ids.includes(teamId))),
  ) ?? [];

  const now = new Date();
  const activeWeekCandidates = allowedChallenges.filter((challenge) => {
    const start = parseDate(challenge.start_date);
    const end = parseDate(challenge.end_date);
    if (start && now < start) return false;
    if (end && now > end) return false;
    return true;
  });
  const activeWeekIndex = (activeWeekCandidates.length > 0 ? activeWeekCandidates : allowedChallenges)
    .map((challenge) => challenge.week_index ?? 0)
    .reduce((max, current) => (current > max ? current : max), 0);
  const activeWeekChallenges = allowedChallenges.filter((challenge) => (challenge.week_index ?? 0) === activeWeekIndex);

  const maxAvailablePoints = allowedChallenges.reduce(
    (total, challenge) => total + (challenge.base_points ?? 0),
    0,
  );

  const allowedChallengeIds = allowedChallenges.map((challenge) => challenge.id);

  const baseLeaderboard = memberIds
    .map((id) => ({
      user_id: id,
      name: nameMap.get(id) ?? "Member",
      points: 0,
      completed_count: 0,
      icon: iconMap.get(id) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (allowedChallengeIds.length === 0) {
    return NextResponse.json({
      leaderboard: baseLeaderboard,
      contributions: {},
      hasMore: false,
      total: 0,
      maxAvailablePoints,
      activeWeekIndex,
    });
  }

  const { data: statsRows, error: statsError } = await admin
    .from("submissions")
    .select("user_id, challenges(base_points)")
    .in("user_id", memberIds)
    .in("challenge_id", allowedChallengeIds)
    .eq("completed", true);

  if (statsError) {
    return NextResponse.json({ error: statsError.message }, { status: 400 });
  }

  const leaderboardTotals = new Map<string, { points: number; completed: number }>();
  (statsRows as StatsRow[] | null)?.forEach((row) => {
    const existing = leaderboardTotals.get(row.user_id) ?? { points: 0, completed: 0 };
    const challenge = extractChallenge(row.challenges);
    const points = challenge?.base_points ?? 0;
    leaderboardTotals.set(row.user_id, {
      points: existing.points + points,
      completed: existing.completed + 1,
    });
  });

  const leaderboard = memberIds
    .map((id) => ({
      user_id: id,
      name: nameMap.get(id) ?? "Member",
      points: leaderboardTotals.get(id)?.points ?? 0,
      completed_count: leaderboardTotals.get(id)?.completed ?? 0,
      icon: iconMap.get(id) ?? null,
      week_progress_percent: 0,
    }))
    .sort((a, b) => b.points - a.points || b.completed_count - a.completed_count || a.name.localeCompare(b.name));

  const { data: progressRows, error: progressError } = await admin
    .from("submissions")
    .select("user_id, challenge_id, completed, progress_percent")
    .in("user_id", memberIds)
    .in("challenge_id", allowedChallengeIds);

  if (progressError) {
    return NextResponse.json({ error: progressError.message }, { status: 400 });
  }

  const progressByUser = new Map<string, Map<string, number>>();
  (progressRows as ProgressRow[] | null)?.forEach((row) => {
    const percentRaw =
      typeof row.progress_percent === "number"
        ? row.progress_percent
        : row.completed
          ? 100
          : 0;
    const percent = clampPercent(percentRaw);
    if (!progressByUser.has(row.user_id)) {
      progressByUser.set(row.user_id, new Map());
    }
    progressByUser.get(row.user_id)?.set(row.challenge_id, percent);
  });

  const activeWeekChallengeIds = activeWeekChallenges.map((challenge) => challenge.id);

  const leaderboardWithWeekProgress = leaderboard.map((row) => {
    if (activeWeekChallengeIds.length === 0) {
      return { ...row, week_progress_percent: 0 };
    }
    const challengeProgress = progressByUser.get(row.user_id);
    const total = activeWeekChallengeIds.reduce(
      (sum, challengeId) => sum + (challengeProgress?.get(challengeId) ?? 0),
      0,
    );
    const percent = clampPercent(total / activeWeekChallengeIds.length);
    return { ...row, week_progress_percent: percent };
  });

  const { data: submissions, error: contributionError, count } = await admin
    .from("submissions")
    .select("user_id, completed_at, challenge_id, challenges(title, base_points)", { count: "exact" })
    .in("user_id", memberIds)
    .eq("completed", true)
    .in("challenge_id", allowedChallengeIds)
    .order("completed_at", { ascending: false })
    .range(offset, offset + (Number.isNaN(limit) ? DEFAULT_LIMIT : limit) - 1);

  if (contributionError) {
    return NextResponse.json({ error: contributionError.message }, { status: 400 });
  }

  const safeLimit = Number.isNaN(limit) ? DEFAULT_LIMIT : limit;
  const total = count ?? submissions?.length ?? 0;
  const hasMore = offset + safeLimit < total;

  const contributions: Record<
    string,
    { challenge_id: string; challenge_title: string; completed_at: string | null; points: number }[]
  > = {};

  (submissions as ContributionRow[] | null)?.forEach((row) => {
    if (!contributions[row.user_id]) {
      contributions[row.user_id] = [];
    }
    const challenge = extractChallenge(row.challenges);
    contributions[row.user_id].push({
      challenge_id: row.challenge_id,
      challenge_title: challenge?.title ?? "",
      completed_at: row.completed_at,
      points: challenge?.base_points ?? 0,
    });
  });

  return NextResponse.json({
    leaderboard: leaderboardWithWeekProgress,
    contributions,
    hasMore,
    total,
    maxAvailablePoints,
    activeWeekIndex,
  });
}
