"use client";

import { useRequireUser } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { useCallback, useEffect, useMemo, useState } from "react";

interface Challenge {
  id: string;
  week_index: number;
  title: string;
  description: string;
  start_date: string | null;
  end_date: string | null;
  base_points: number;
}

interface Submission {
  id?: string;
  challenge_id: string;
  user_id: string;
  completed: boolean;
  completed_at: string | null;
}

interface TeamRow {
  team_id: string;
  team: {
    id: string;
    name: string;
    join_code: string;
  } | null;
}

export default function DashboardPage() {
  const supabase = getSupabaseClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileStatus, setProfileStatus] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [teamName, setTeamName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [teamStatus, setTeamStatus] = useState<string | null>(null);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [submissions, setSubmissions] = useState<Record<string, Submission>>({});
  const [changedIds, setChangedIds] = useState<Set<string>>(new Set());
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);

  const ensureProfileExists = useCallback(
    async (id: string) => {
      await supabase
        .from("profiles")
        .upsert({ id, display_name: profileName || "New athlete", role: "user" });
    },
    [profileName, supabase],
  );

  const loadProfile = useCallback(
    async (id: string) => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", id)
        .single();
      if (data?.display_name) setProfileName(data.display_name);
    },
    [supabase],
  );

  const loadTeams = useCallback(async () => {
    const { data, error } = await supabase
      .from("team_members")
      .select("team_id, teams(id, name, join_code)");
    if (error) {
      setTeamStatus(error.message);
      return;
    }
    const normalizedTeams: TeamRow[] = (data ?? []).map((row: any) => ({
      team_id: String(row.team_id),
      team: Array.isArray(row.teams) && row.teams.length > 0 ? row.teams[0] : null,
    }));

    setTeams(normalizedTeams);
  }, [supabase]);

  const loadChallenges = useCallback(async () => {
    const { data, error } = await supabase
      .from("challenges")
      .select("*")
      .order("week_index", { ascending: true });
    if (error) {
      setSaveStatus(error.message);
      return;
    }
    setChallenges(data ?? []);
  }, [supabase]);

  const loadSubmissions = useCallback(
    async (id: string) => {
      const { data, error } = await supabase
        .from("submissions")
        .select("id, challenge_id, completed, completed_at, user_id")
        .eq("user_id", id);
      if (error) {
        setSaveStatus(error.message);
        return;
      }
      const map: Record<string, Submission> = {};
      (data ?? []).forEach((row) => {
        map[row.challenge_id] = row;
      });
      setSubmissions(map);
    },
    [supabase],
  );

  useRequireUser((id) => {
    setUserId(id);
    ensureProfileExists(id);
  });

  useEffect(() => {
    if (!userId) return;
    loadProfile(userId);
    loadTeams();
    loadChallenges();
    loadSubmissions(userId);
    const stored = window.localStorage.getItem("activeTeamId");
    if (stored) setActiveTeamId(stored);
  }, [userId, loadProfile, loadTeams, loadChallenges, loadSubmissions]);

  const handleProfileSave = async () => {
    if (!userId) return;
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: profileName })
      .eq("id", userId);
    if (error) {
      setProfileStatus(error.message);
    } else {
      setProfileStatus("Name updated");
    }
  };

  const handleCreateTeam = async () => {
    setTeamStatus(null);
    const { error } = await supabase.rpc("create_team", { team_name: teamName });
    if (error) {
      setTeamStatus(error.message);
    } else {
      setTeamStatus("Team created");
      setTeamName("");
      loadTeams();
    }
  };

  const handleJoinTeam = async () => {
    setTeamStatus(null);
    const { error } = await supabase.rpc("join_team", { join_code: joinCode });
    if (error) {
      setTeamStatus(error.message);
    } else {
      setTeamStatus("Joined team");
      setJoinCode("");
      loadTeams();
    }
  };

  const submissionState = useMemo(() => {
    const map: Record<string, boolean> = {};
    challenges.forEach((c) => {
      map[c.id] = submissions[c.id]?.completed ?? false;
    });
    return map;
  }, [challenges, submissions]);

  const toggleChallenge = (id: string, checked: boolean) => {
    setSubmissions((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || { challenge_id: id, user_id: userId!, completed_at: null }),
        challenge_id: id,
        user_id: userId!,
        completed: checked,
        completed_at: checked ? new Date().toISOString() : null,
      },
    }));
    setChangedIds((prev) => new Set([...Array.from(prev), id]));
  };

  const handleSaveSubmissions = async () => {
    if (!userId || changedIds.size === 0) return;
    setSaveStatus(null);
    console.log("Saving submissions via", process.env.NEXT_PUBLIC_SUPABASE_URL);
    const payload = Array.from(changedIds).map((id) => ({
      challenge_id: id,
      user_id: userId,
      completed: submissions[id]?.completed ?? false,
      completed_at: submissions[id]?.completed ? submissions[id]?.completed_at : null,
    }));

    const { error } = await supabase
      .from("submissions")
      .upsert(payload, { onConflict: "challenge_id,user_id" });

    if (error) {
      setSaveStatus(error.message);
    } else {
      setSaveStatus("Progress saved");
      setChangedIds(new Set());
      loadSubmissions(userId);
    }
  };

  const handleActiveTeamChange = (teamId: string) => {
    setActiveTeamId(teamId);
    window.localStorage.setItem("activeTeamId", teamId);
  };

  const activeTeamName = teams.find((t) => t.team?.id === activeTeamId)?.team?.name;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-6xl mx-auto p-8 space-y-10">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-sm text-indigo-400">Dashboard</p>
            <h1 className="text-3xl font-semibold">Welcome back</h1>
          </div>
          <button
            className="text-sm text-slate-300 underline"
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.href = "/";
            }}
          >
            Sign out
          </button>
        </header>

        <section className="grid md:grid-cols-2 gap-6">
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Profile</h2>
              {profileStatus && <span className="text-sm text-indigo-400">{profileStatus}</span>}
            </div>
            <div className="space-y-2">
              <label className="text-sm text-slate-400">Display name</label>
              <input
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                onClick={handleProfileSave}
                className="bg-indigo-500 hover:bg-indigo-600 text-white font-medium px-4 py-2 rounded-lg"
              >
                Save name
              </button>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Teams</h2>
              {teamStatus && <span className="text-sm text-rose-400">{teamStatus}</span>}
            </div>
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder="Team name"
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  onClick={handleCreateTeam}
                  className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg"
                >
                  Create
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="Join code"
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  onClick={handleJoinTeam}
                  className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg"
                >
                  Join
                </button>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-slate-400">Your teams</p>
                <div className="space-y-2">
                  {teams.length === 0 && <p className="text-slate-500">No teams yet</p>}
                  {teams.map((row) => {
                    if (!row.team) return null;

                    return (
                      <div
                        key={row.team.id}
                        className={`flex items-center justify-between bg-slate-800 border border-slate-700 rounded-lg p-3 ${
                          activeTeamId === row.team.id ? "ring-2 ring-indigo-500" : ""
                        }`}
                      >
                        <div>
                          <p className="font-medium">{row.team.name}</p>
                          <p className="text-xs text-slate-400">Join code: {row.team.join_code}</p>
                        </div>
                        <button
                          onClick={() => handleActiveTeamChange(row.team!.id)}
                          className="text-sm text-indigo-400"
                        >
                          {activeTeamId === row.team.id ? "Active" : "Set active"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-indigo-400">Challenges</p>
              <h2 className="text-2xl font-semibold">Weekly goals</h2>
            </div>
            <button
              onClick={handleSaveSubmissions}
              className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg"
            >
              Save progress
            </button>
          </div>
          {saveStatus && <p className="text-sm text-rose-400">{saveStatus}</p>}
          <div className="space-y-3">
            {challenges.map((challenge) => (
              <div
                key={challenge.id}
                className="flex items-start gap-3 bg-slate-800 border border-slate-700 rounded-lg p-4"
              >
                <input
                  type="checkbox"
                  checked={submissionState[challenge.id] || false}
                  onChange={(e) => toggleChallenge(challenge.id, e.target.checked)}
                  className="mt-1 h-5 w-5 accent-indigo-500"
                />
                <div className="space-y-1">
                  <p className="text-sm text-slate-400">Week {challenge.week_index}</p>
                  <h3 className="text-lg font-semibold">{challenge.title}</h3>
                  <p className="text-slate-300 text-sm">{challenge.description}</p>
                  <p className="text-xs text-slate-500">
                    {challenge.start_date && `Starts ${challenge.start_date}`} · {" "}
                    {challenge.end_date && `Ends ${challenge.end_date}`} · {challenge.base_points} pts
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {activeTeamId && (
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
            <p className="text-sm text-slate-400">Active team</p>
            <h3 className="text-xl font-semibold">{activeTeamName}</h3>
            <p className="text-slate-400 text-sm">
              View team stats in the <a className="text-indigo-400" href="/leaderboard">leaderboard</a>.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
