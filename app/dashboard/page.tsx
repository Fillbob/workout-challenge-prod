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

interface RecentSubmission {
  id: string;
  user_id: string;
  challenge_id: string;
  challenge_title: string;
  completed_at: string | null;
  name: string;
}

interface TeamRow {
  team_id: string;
  team: {
    id: string;
    name: string;
    join_code: string;
  } | null;
}

interface LocalTeam {
  id: string;
  name: string;
  join_code: string;
  owner_id: string;
  members: string[];
}

const LOCAL_TEAM_STORAGE_KEY = "localTeams";

function readLocalTeams() {
  if (typeof window === "undefined") return [] as LocalTeam[];
  const raw = window.localStorage.getItem(LOCAL_TEAM_STORAGE_KEY);
  if (!raw) return [] as LocalTeam[];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [] as LocalTeam[];

    return parsed
      .map((team) => ({
        id: String(team.id ?? ""),
        name: String(team.name ?? ""),
        join_code: String(team.join_code ?? ""),
        owner_id: String(team.owner_id ?? ""),
        members: Array.isArray(team.members) ? team.members.map(String) : [],
      }))
      .filter((team) => team.id && team.name && team.join_code && team.owner_id);
  } catch (error) {
    console.error("Unable to read local teams", error);
    return [] as LocalTeam[];
  }
}

function writeLocalTeams(teams: LocalTeam[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_TEAM_STORAGE_KEY, JSON.stringify(teams));
}

function addLocalMembership(team: LocalTeam, userId: string) {
  if (team.members.includes(userId)) return team;
  return { ...team, members: [...team.members, userId] };
}

function ensureLocalTeam(name: string, userId: string) {
  const teams = readLocalTeams();
  const existing = teams.find(
    (team) => team.name.toLowerCase() === name.toLowerCase() || team.join_code.toLowerCase() === name.toLowerCase(),
  );

  if (existing) {
    const updated = addLocalMembership(existing, userId);
    const nextTeams = teams.map((team) => (team.id === existing.id ? updated : team));
    writeLocalTeams(nextTeams);
    return updated;
  }

  const newTeam: LocalTeam = {
    id: crypto.randomUUID(),
    name,
    join_code: name,
    owner_id: userId,
    members: [userId],
  };

  writeLocalTeams([...teams, newTeam]);
  return newTeam;
}

function localTeamsForUser(userId: string | null) {
  if (!userId) return [] as TeamRow[];
  return readLocalTeams()
    .filter((team) => team.members.includes(userId))
    .map((team) => ({
      team_id: team.id,
      team: { id: team.id, name: team.name, join_code: team.join_code },
    }));
}

function mergeTeams(primary: TeamRow[], extras: TeamRow[]) {
  const seen = new Set(primary.map((team) => team.team?.id ?? team.team_id));
  const merged = [...primary];

  extras.forEach((team) => {
    const identifier = team.team?.id ?? team.team_id;
    if (!identifier || seen.has(identifier)) return;
    merged.push(team);
    seen.add(identifier);
  });

  return merged;
}

export default function DashboardPage() {
  const supabase = getSupabaseClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [userIdentifier, setUserIdentifier] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileRole, setProfileRole] = useState<string | null>(null);
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
  const [recentSubmissions, setRecentSubmissions] = useState<RecentSubmission[]>([]);
  const [recentStatus, setRecentStatus] = useState<string | null>(null);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentHasMore, setRecentHasMore] = useState(false);
  const [recentOffset, setRecentOffset] = useState(0);

  const RECENT_PAGE_SIZE = 8;

  const initializeProfile = useCallback(
    async (id: string) => {
      setProfileStatus(null);
      const { data: authData } = await supabase.auth.getUser();
      const emailIdentifier = authData.user?.email?.split("@")[0] || authData.user?.email || null;
      setUserIdentifier(emailIdentifier);
      const fallbackName = emailIdentifier || "New athlete";

      const { data: existing, error } = await supabase
        .from("profiles")
        .select("display_name, role")
        .eq("id", id)
        .maybeSingle();

      if (error) {
        setProfileStatus(error.message);
        return;
      }

      if (!existing) {
        const { error: insertError } = await supabase
          .from("profiles")
          .insert({ id, display_name: fallbackName, role: "user" });

        if (insertError) {
          setProfileStatus(insertError.message);
          return;
        }

        setProfileName(fallbackName);
        setProfileRole("user");
        return;
      }

      setProfileName(existing.display_name || fallbackName);
      setProfileRole(existing.role || "user");
    },
    [supabase],
  );

  const loadTeams = useCallback(async () => {
    const local = localTeamsForUser(userId);

    try {
      const response = await fetch("/api/teams/memberships");
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to load teams");
      }

      const normalizedTeams: TeamRow[] = (payload.teams ?? []).map((row: { team_id: string; teams?: TeamRow["team"] }) => ({
        team_id: String(row.team_id),
        team: Array.isArray(row.teams) ? row.teams[0] : row.teams ?? null,
      }));

      setTeams(mergeTeams(local, normalizedTeams));
      setTeamStatus(null);
    } catch (error) {
      console.warn("Falling back to local teams", error);
      setTeamStatus(error instanceof Error ? error.message : "Unable to load teams");
      setTeams(local);
    }
  }, [userId]);

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
  });

  useEffect(() => {
    if (!userId) return;
    initializeProfile(userId);
    loadTeams();
    loadChallenges();
    loadSubmissions(userId);
    const stored = window.localStorage.getItem("activeTeamId");
    if (stored) setActiveTeamId(stored);
  }, [userId, initializeProfile, loadTeams, loadChallenges, loadSubmissions]);

  useEffect(() => {
    if (teams.length === 0) return;
    if (activeTeamId && teams.some((team) => team.team?.id === activeTeamId)) return;

    const firstTeamId = teams[0]?.team?.id;
    if (firstTeamId) handleActiveTeamChange(firstTeamId);
  }, [teams, activeTeamId]);

  const handleProfileSave = async () => {
    if (!userId) return;
    const trimmedName = profileName.trim();
    if (!trimmedName) {
      setProfileStatus("Name cannot be empty");
      return;
    }
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: trimmedName })
      .eq("id", userId);
    if (error) {
      setProfileStatus(error.message);
    } else {
      setProfileStatus("Name updated");
    }
  };

  const handleCreateTeam = async () => {
    setTeamStatus(null);
    const trimmedName = teamName.trim();
    if (!trimmedName) {
      setTeamStatus("Team name is required");
      return;
    }
    if (!userId) {
      setTeamStatus("You must be signed in to create a team");
      return;
    }

    try {
      const response = await fetch("/api/teams/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamName: trimmedName }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to create team");
      }

      setTeamStatus("Team created");
      setTeamName("");
      if (result.team?.id) handleActiveTeamChange(String(result.team.id));
      loadTeams();
      return;
    } catch (error) {
      console.warn("Falling back to local team storage", error);
    }

    const fallbackTeam = ensureLocalTeam(trimmedName, userId);
    setTeamStatus("Team created and saved locally");
    setTeamName("");
    setTeams((prev) => mergeTeams(prev, [{ team_id: fallbackTeam.id, team: fallbackTeam }]));
    handleActiveTeamChange(fallbackTeam.id);
  };

  const handleJoinTeam = async () => {
    setTeamStatus(null);
    const trimmedCode = joinCode.trim();

    if (!trimmedCode) {
      setTeamStatus("Join code is required");
      return;
    }

    try {
      const response = await fetch("/api/teams/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinCode: trimmedCode }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to join team");
      }

      setTeamStatus("Joined team");
      setJoinCode("");
      if (result.team?.id) handleActiveTeamChange(String(result.team.id));
      loadTeams();
      return;
    } catch (error) {
      console.warn("Falling back to local join", error);
    }

    if (!userId) {
      setTeamStatus("You must be signed in to join a team");
      return;
    }

    const local = readLocalTeams();
    const target = local.find(
      (team) => team.name.toLowerCase() === trimmedCode.toLowerCase() || team.join_code.toLowerCase() === trimmedCode.toLowerCase(),
    );

    if (!target) {
      setTeamStatus("Team not found");
      return;
    }

    const updated = addLocalMembership(target, userId);
    const nextTeams = local.map((team) => (team.id === target.id ? updated : team));
    writeLocalTeams(nextTeams);
    setTeams((prev) => mergeTeams(prev, [{ team_id: updated.id, team: updated }]));
    setTeamStatus("Joined team");
    setJoinCode("");
    handleActiveTeamChange(updated.id);
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

  const loadRecentActivity = useCallback(
    async (teamId: string, reset = false) => {
      setRecentStatus(null);
      setRecentLoading(true);

      const nextOffset = reset ? 0 : recentOffset;

      try {
        const response = await fetch(
          `/api/teams/recent-submissions?teamId=${teamId}&limit=${RECENT_PAGE_SIZE}&offset=${nextOffset}`,
        );
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "Unable to load recent submissions");
        }

        const submissions: RecentSubmission[] = payload.submissions ?? [];
        setRecentSubmissions((prev) => (reset ? submissions : [...prev, ...submissions]));
        setRecentHasMore(Boolean(payload.hasMore));
        setRecentOffset(nextOffset + submissions.length);
      } catch (error) {
        setRecentStatus(error instanceof Error ? error.message : "Unable to load recent submissions");
      } finally {
        setRecentLoading(false);
      }
    },
    [RECENT_PAGE_SIZE, recentOffset],
  );

  useEffect(() => {
    if (!activeTeamId) return;
    loadRecentActivity(activeTeamId, true);
  }, [activeTeamId, loadRecentActivity]);

  const formatTimestamp = (value: string | null) => {
    if (!value) return "";
    return new Date(value).toLocaleString();
  };

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
              <div className="space-y-1">
                <h2 className="text-xl font-semibold">Profile</h2>
                <div className="flex gap-2 text-xs text-slate-300">
                  {userIdentifier && <span className="px-2 py-1 rounded bg-slate-800">ID: {userIdentifier}</span>}
                  {profileRole && <span className="px-2 py-1 rounded bg-slate-800">Access: {profileRole}</span>}
                </div>
              </div>
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
            {challenges.map((challenge) => {
              const checked = submissionState[challenge.id] || false;

              return (
                <div
                  key={challenge.id}
                  className="flex items-start gap-3 bg-slate-800 border border-slate-700 rounded-lg p-4"
                >
                  <button
                    type="button"
                    role="switch"
                    aria-checked={checked}
                    aria-label={`Mark ${challenge.title} as completed`}
                    onClick={() => toggleChallenge(challenge.id, !checked)}
                    onKeyDown={(event) => {
                      if (event.key === " " || event.key === "Enter") {
                        event.preventDefault();
                        toggleChallenge(challenge.id, !checked);
                      }
                    }}
                    className={`mt-1 inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${
                      checked ? "bg-indigo-500" : "bg-slate-600"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        checked ? "translate-x-5" : "translate-x-1"
                      }`}
                    />
                  </button>
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
              );
            })}
          </div>
        </section>

        <section className="bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-indigo-400">Team activity</p>
              <h2 className="text-2xl font-semibold">Recent submissions</h2>
              <p className="text-slate-400 text-sm">Last 7 days</p>
            </div>
            {recentStatus && <span className="text-sm text-rose-400">{recentStatus}</span>}
          </div>

          {!activeTeamId && <p className="text-slate-500 text-sm">Set an active team to see recent activity.</p>}

          {activeTeamId && (
            <div className="space-y-3">
              {recentSubmissions.length === 0 && !recentLoading && (
                <p className="text-slate-500 text-sm">No submissions yet.</p>
              )}

              <ul className="space-y-2">
                {recentSubmissions.map((submission) => (
                  <li
                    key={submission.id}
                    className="flex items-start justify-between rounded-lg border border-slate-800 bg-slate-800/70 p-3"
                  >
                    <div className="space-y-1">
                      <p className="font-medium">{submission.name}</p>
                      <p className="text-sm text-slate-300">Completed {submission.challenge_title}</p>
                    </div>
                    <p className="text-xs text-slate-500">{formatTimestamp(submission.completed_at)}</p>
                  </li>
                ))}
              </ul>

              <div className="flex items-center gap-3">
                <button
                  disabled={!recentHasMore || recentLoading}
                  onClick={() => activeTeamId && loadRecentActivity(activeTeamId)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium ${
                    recentHasMore
                      ? "bg-indigo-500 text-white hover:bg-indigo-600"
                      : "cursor-not-allowed bg-slate-800 text-slate-400"
                  }`}
                >
                  {recentLoading ? "Loading..." : recentHasMore ? "Load more" : "No more results"}
                </button>
                <p className="text-xs text-slate-500">Showing {recentSubmissions.length} of {recentOffset} loaded</p>
              </div>
            </div>
          )}
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
