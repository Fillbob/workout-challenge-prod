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

function extractChallenge(relation: ChallengeRelation) {
  if (Array.isArray(relation)) {
    return relation[0];
  }
  return relation ?? undefined;
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
    return NextResponse.json({ leaderboard: [], contributions: {}, hasMore: false, total: 0 });
  }

  const { data: profileRows, error: profileError } = await admin
    .from("profiles")
    .select("id, display_name")
    .in("id", memberIds);

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  const nameMap = new Map<string, string>();
  (profileRows ?? []).forEach((profile) => {
    nameMap.set(profile.id, profile.display_name ?? "Member");
  });

  const { data: challengeRows, error: challengeError } = await admin
    .from("challenges")
    .select("id, team_ids, hidden");

  if (challengeError) {
    return NextResponse.json({ error: challengeError.message }, { status: 400 });
  }

  const allowedChallengeIds = (challengeRows ?? [])
    .filter(
      (challenge) =>
        !challenge.hidden &&
        (!challenge.team_ids ||
          challenge.team_ids.length === 0 ||
          (Array.isArray(challenge.team_ids) && challenge.team_ids.includes(teamId))),
    )
    .map((challenge) => challenge.id);

  const baseLeaderboard = memberIds
    .map((id) => ({
      user_id: id,
      name: nameMap.get(id) ?? "Member",
      points: 0,
      completed_count: 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (allowedChallengeIds.length === 0) {
    return NextResponse.json({ leaderboard: baseLeaderboard, contributions: {}, hasMore: false, total: 0 });
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
    }))
    .sort((a, b) => b.points - a.points || b.completed_count - a.completed_count || a.name.localeCompare(b.name));

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

  return NextResponse.json({ leaderboard, contributions, hasMore, total });
}
