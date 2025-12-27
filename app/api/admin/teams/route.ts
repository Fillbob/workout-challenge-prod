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
    .select("id, name, join_code, team_members(user_id, profiles(display_name))")
    .order("name", { ascending: true });

  if (teamError) {
    return NextResponse.json({ error: teamError.message }, { status: 500 });
  }

  try {
    const teamsWithCounts = await Promise.all(
      (teams ?? []).map(async (team) => {
        const members = team.team_members?.map((member) => ({
          user_id: member.user_id,
          display_name: member.profiles?.display_name ?? "Member",
        })) ?? [];

        return {
          id: team.id,
          name: team.name,
          join_code: team.join_code,
          members,
          member_count: members.length,
        };
      }),
    );

    return NextResponse.json({ teams: teamsWithCounts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load team members";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
