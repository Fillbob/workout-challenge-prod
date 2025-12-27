import { getServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profileError || profile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = getServiceRoleClient();

  const { data: teams, error: teamError } = await admin
    .from("teams")
    .select("id, name, join_code")
    .order("name", { ascending: true });

  if (teamError) {
    return NextResponse.json({ error: teamError.message }, { status: 500 });
  }

  try {
    const teamsWithCounts = await Promise.all(
      (teams ?? []).map(async (team) => {
        const { count, error: countError } = await admin
          .from("team_members")
          .select("id", { count: "exact", head: true })
          .eq("team_id", team.id);

        if (countError) {
          throw countError;
        }

        return {
          ...team,
          member_count: count ?? 0,
        };
      }),
    );

    return NextResponse.json({ teams: teamsWithCounts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load team members";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
