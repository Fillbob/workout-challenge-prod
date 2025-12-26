import { getServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const DEFAULT_DAYS = 7;
const DEFAULT_LIMIT = 10;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const teamId = searchParams.get("teamId");
  const days = Number.parseInt(searchParams.get("days") ?? `${DEFAULT_DAYS}`, 10);
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

  const { data: membership, error: membershipError } = await admin
    .from("team_members")
    .select("team_id")
    .eq("team_id", teamId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    return NextResponse.json({ error: membershipError.message }, { status: 400 });
  }

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: memberRows, error: membersError } = await admin
    .from("team_members")
    .select("user_id")
    .eq("team_id", teamId);

  if (membersError) {
    return NextResponse.json({ error: membersError.message }, { status: 400 });
  }

  const memberIds = (memberRows ?? []).map((row) => row.user_id);

  if (memberIds.length === 0) {
    return NextResponse.json({ submissions: [], hasMore: false, total: 0 });
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - (Number.isNaN(days) ? DEFAULT_DAYS : days));

  const { data, error, count } = await admin
    .from("submissions")
    .select("id, user_id, completed_at, challenge_id, challenges(title), profiles(display_name)", {
      count: "exact",
    })
    .in("user_id", memberIds)
    .eq("completed", true)
    .gte("completed_at", cutoffDate.toISOString())
    .order("completed_at", { ascending: false })
    .range(offset, offset + (Number.isNaN(limit) ? DEFAULT_LIMIT : limit) - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const safeLimit = Number.isNaN(limit) ? DEFAULT_LIMIT : limit;
  const total = count ?? data?.length ?? 0;
  const hasMore = offset + safeLimit < total;

  const submissions = (data ?? []).map((row) => ({
    id: row.id,
    user_id: row.user_id,
    challenge_id: row.challenge_id,
    challenge_title: row.challenges?.title ?? "",
    completed_at: row.completed_at,
    name: row.profiles?.display_name ?? "Member",
  }));

  return NextResponse.json({ submissions, hasMore, total });
}
