import { getServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isDateOnly(value: string | null) {
  return Boolean(value && DATE_ONLY_PATTERN.test(value));
}

function parseDateSafe(value: string | null): Date | null {
  if (!value) return null;

  if (isDateOnly(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(year, month - 1, day);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function computeCompletedAt(endDate: string | null) {
  const parsed = parseDateSafe(endDate);
  if (!parsed) return new Date().toISOString();
  const timestamp = isDateOnly(endDate) ? endOfDay(parsed) : parsed;
  return timestamp.toISOString();
}

type ChallengeRow = { end_date?: string | null };

function extractEndDate(value: unknown): string | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    const first = value[0] as ChallengeRow | undefined;
    return first?.end_date ?? null;
  }
  if (typeof value === "object") {
    return (value as ChallengeRow).end_date ?? null;
  }
  return null;
}

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profileError) {
    return { error: NextResponse.json({ error: profileError.message }, { status: 400 }) };
  }

  if (profile?.role !== "admin" && profile?.role !== "mod") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { user };
}

export async function GET(request: NextRequest) {
  const { error, user } = await requireAdmin();
  if (error) return error;

  const statusFilter = request.nextUrl.searchParams.get("status") ?? "pending";

  const admin = getServiceRoleClient();
  let query = admin
    .from("late_completion_requests")
    .select(
      "id, status, requested_at, resolved_at, user_id, challenge_id, challenges(title, week_index, challenge_index, end_date)",
    )
    .order("requested_at", { ascending: false });

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data, error: queryError } = await query;

  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 400 });
  }

  const userIds = Array.from(
    new Set((data ?? []).map((row) => row.user_id).filter((id): id is string => Boolean(id))),
  );

  let profileMap = new Map<string, { display_name?: string | null }>();

  if (userIds.length > 0) {
    const { data: profiles, error: profileError } = await admin
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 400 });
    }

    profileMap = new Map(
      (profiles ?? []).map((profile) => [profile.id, { display_name: profile.display_name ?? null }]),
    );
  }

  const requests = (data ?? []).map((row) => ({
    ...row,
    profiles: profileMap.get(row.user_id) ?? null,
  }));

  return NextResponse.json({ requests, requestedBy: user?.id ?? null });
}

export async function PATCH(request: NextRequest) {
  const { error, user } = await requireAdmin();
  if (error) return error;

  const body = (await request.json()) as { requestId?: string; action?: string };
  const requestId = body.requestId?.trim();
  const action = body.action?.trim();

  if (!requestId || !action) {
    return NextResponse.json({ error: "Request id and action are required" }, { status: 400 });
  }

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (action !== "approve" && action !== "decline") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const admin = getServiceRoleClient();

  const { data: requestRow, error: requestError } = await admin
    .from("late_completion_requests")
    .select("id, user_id, challenge_id, status, challenges(end_date)")
    .eq("id", requestId)
    .single();

  if (requestError || !requestRow) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  if (requestRow.status !== "pending") {
    return NextResponse.json({ error: "Request already resolved" }, { status: 409 });
  }

  if (action === "approve") {
    const completedAt = computeCompletedAt(extractEndDate(requestRow.challenges));

    const { error: submissionError } = await admin
      .from("submissions")
      .upsert(
        {
          challenge_id: requestRow.challenge_id,
          user_id: requestRow.user_id,
          completed: true,
          completed_at: completedAt,
        },
        { onConflict: "challenge_id,user_id" },
      );

    if (submissionError) {
      return NextResponse.json({ error: submissionError.message }, { status: 400 });
    }
  }

  const { data: updated, error: updateError } = await admin
    .from("late_completion_requests")
    .update({ status: action === "approve" ? "approved" : "declined", resolved_at: new Date().toISOString(), resolved_by: user.id })
    .eq("id", requestId)
    .select("id, status, resolved_at")
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({ request: updated });
}
