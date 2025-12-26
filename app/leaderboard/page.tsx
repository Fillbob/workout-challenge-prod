"use client";

import { useRequireUser } from "@/lib/auth";
import { Fragment, useCallback, useEffect, useState } from "react";

interface TeamRow {
  team_id: string;
  teams: {
    id: string;
    name: string;
  }[];
}

interface LeaderboardRow {
  user_id: string;
  name: string;
  points: number;
  completed_count: number;
}

interface ContributionRow {
  challenge_id: string;
  challenge_title: string;
  completed_at: string | null;
  points: number;
}

export default function LeaderboardPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [activeTeam, setActiveTeam] = useState<string | null>(null);
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [contributions, setContributions] = useState<Record<string, ContributionRow[]>>({});
  const [activityOffset, setActivityOffset] = useState(0);
  const [activityHasMore, setActivityHasMore] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);

  const PAGE_SIZE = 15;

  const loadTeams = useCallback(async () => {
    try {
      const response = await fetch("/api/teams/memberships");
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to load teams");
      }

      setTeams(
        (payload.teams ?? []).map((row: { team_id: string; teams?: { id: string; name: string }[] }) => ({
          team_id: String(row.team_id),
          teams: row.teams?.map((team) => ({
            id: String(team.id),
            name: String(team.name),
          })) ?? [],
        })),
      );
      setStatus(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load teams");
    }
  }, []);

  const appendContributions = useCallback(
    (
      current: Record<string, ContributionRow[]>,
      incoming: Record<string, ContributionRow[]>,
      reset: boolean,
    ) => {
      if (reset) return incoming;

      const merged: Record<string, ContributionRow[]> = { ...current };
      Object.entries(incoming).forEach(([userId, items]) => {
        merged[userId] = [...(merged[userId] ?? []), ...items];
      });
      return merged;
    },
    [],
  );

  const loadLeaderboard = useCallback(
    async (teamId: string, reset = true) => {
      setStatus(null);
      setActivityLoading(true);
      if (reset) {
        setActivityOffset(0);
        setContributions({});
        setExpandedUser(null);
      }

      const offset = reset ? 0 : activityOffset;

      try {
        const params = new URLSearchParams({
          teamId,
          limit: `${PAGE_SIZE}`,
          offset: `${offset}`,
        });

        const response = await fetch(`/api/teams/leaderboard?${params.toString()}`);
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "Unable to load leaderboard");
        }

        const returnedContributions: Record<string, ContributionRow[]> = payload.contributions ?? {};
        const contributionCount = Object.values(returnedContributions).reduce((count, list) => count + list.length, 0);

        setRows(payload.leaderboard ?? []);
        setContributions((prev) => appendContributions(prev, returnedContributions, reset));
        setActivityHasMore(Boolean(payload.hasMore));
        setActivityOffset(offset + contributionCount);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Unable to load leaderboard");
      } finally {
        setActivityLoading(false);
      }
    },
    [PAGE_SIZE, activityOffset, appendContributions],
  );

  useRequireUser((id) => setUserId(id));

  useEffect(() => {
    if (!userId) return;
    loadTeams();
  }, [userId, loadTeams]);

  useEffect(() => {
    const stored = window.localStorage.getItem("activeTeamId");
    if (stored) {
      setActiveTeam(stored);
      loadLeaderboard(stored);
    }
  }, [loadLeaderboard]);

  useEffect(() => {
    if (activeTeam || teams.length === 0) return;

    const firstTeamId = teams[0].teams[0]?.id ?? teams[0].team_id;
    if (firstTeamId) {
      setActiveTeam(firstTeamId);
      window.localStorage.setItem("activeTeamId", firstTeamId);
      loadLeaderboard(firstTeamId);
    }
  }, [activeTeam, loadLeaderboard, teams]);

  const handleTeamChange = (id: string) => {
    setActiveTeam(id);
    window.localStorage.setItem("activeTeamId", id);
    loadLeaderboard(id);
  };

  const loadMoreActivity = () => {
    if (!activeTeam || activityLoading || !activityHasMore) return;
    loadLeaderboard(activeTeam, false);
  };

  const formatTimestamp = (value: string | null) => {
    if (!value) return "";
    return new Date(value).toLocaleString();
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-4xl mx-auto p-8 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-indigo-400">Leaderboard</p>
            <h1 className="text-3xl font-semibold">Team rankings</h1>
          </div>
          <a className="text-sm text-indigo-400 underline" href="/dashboard">
            Back to dashboard
          </a>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <label className="text-sm text-slate-400">Choose a team</label>
            <select
              value={activeTeam ?? ""}
              onChange={(e) => handleTeamChange(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="" disabled>
                Select team
              </option>
              {teams.map((row) => (
                <option key={row.team_id} value={row.teams[0]?.id ?? row.team_id}>
                  {row.teams[0]?.name ?? "Unnamed team"}
                </option>
              ))}
            </select>
          </div>
          {status && <p className="text-sm text-rose-400">{status}</p>}

          {activeTeam && (
            <div className="space-y-4">
              <div className="overflow-hidden rounded-lg border border-slate-800">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-800 text-slate-300">
                    <tr>
                      <th className="p-3">Rank</th>
                      <th className="p-3">Name</th>
                      <th className="p-3">Points</th>
                      <th className="p-3">Completed</th>
                      <th className="p-3">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => {
                      const isExpanded = expandedUser === row.user_id;
                      const memberContributions = contributions[row.user_id] ?? [];

                      return (
                        <Fragment key={row.user_id}>
                          <tr className={idx % 2 === 0 ? "bg-slate-900" : "bg-slate-800"}>
                            <td className="p-3">#{idx + 1}</td>
                            <td className="p-3 font-medium">{row.name}</td>
                            <td className="p-3">{row.points}</td>
                            <td className="p-3">{row.completed_count}</td>
                            <td className="p-3">
                              <button
                                onClick={() => setExpandedUser(isExpanded ? null : row.user_id)}
                                className="text-sm text-indigo-400 underline"
                              >
                                {isExpanded ? "Hide" : "View"} contributions
                              </button>
                            </td>
                          </tr>

                          {isExpanded && (
                            <tr className="bg-slate-900/60">
                              <td colSpan={5} className="p-3">
                                <div className="space-y-2">
                                  <p className="text-sm text-slate-300">Recent contributions</p>
                                  {memberContributions.length === 0 && (
                                    <p className="text-xs text-slate-500">No submissions loaded yet.</p>
                                  )}
                                  <ul className="space-y-1">
                                    {memberContributions.map((entry) => (
                                      <li
                                        key={`${row.user_id}-${entry.challenge_id}-${entry.completed_at}`}
                                        className="flex justify-between rounded border border-slate-800 bg-slate-800/60 px-3 py-2 text-xs text-slate-200"
                                      >
                                        <span>
                                          {entry.challenge_title} <span className="text-slate-400">· {entry.points} pts</span>
                                        </span>
                                        <span className="text-slate-500">{formatTimestamp(entry.completed_at)}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                    {rows.length === 0 && (
                      <tr>
                        <td className="p-3" colSpan={5}>
                          <p className="text-slate-500">No data yet for this team.</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center gap-3">
                <button
                  disabled={!activityHasMore || activityLoading}
                  onClick={loadMoreActivity}
                  className={`rounded-lg px-4 py-2 text-sm font-medium ${
                    activityHasMore
                      ? "bg-indigo-500 text-white hover:bg-indigo-600"
                      : "cursor-not-allowed bg-slate-800 text-slate-400"
                  }`}
                >
                  {activityLoading ? "Loading..." : activityHasMore ? "Load more activity" : "No more activity"}
                </button>
                <p className="text-xs text-slate-500">Loaded {activityOffset} submissions</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
