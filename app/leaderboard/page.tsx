"use client";

import { useRequireUser } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { useCallback, useEffect, useState } from "react";

interface TeamRow {
  team_id: string;
  teams: {
    id: string;
    name: string;
  }[];
}

interface LeaderboardRow {
  name: string;
  points: number;
  completed_count: number;
}

export default function LeaderboardPage() {
  const supabase = getSupabaseClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [activeTeam, setActiveTeam] = useState<string | null>(null);
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const loadTeams = useCallback(async () => {
    const { data, error } = await supabase
      .from("team_members")
      .select("team_id, teams(id, name)");
    if (error) {
      setStatus(error.message);
      return;
    }
    setTeams(
      (data ?? []).map((row) => ({
        team_id: String(row.team_id),
        teams: row.teams?.map((team) => ({
          id: String(team.id),
          name: String(team.name),
        })) ?? [],
      })),
    );
  }, [supabase]);

  const loadLeaderboard = useCallback(
    async (teamId: string) => {
      setStatus(null);
      const { data, error } = await supabase.rpc("get_team_leaderboard", {
        team_id: teamId,
      });
      if (error) {
        setStatus(error.message);
        return;
      }
      setRows(data ?? []);
    },
    [supabase],
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

  const handleTeamChange = (id: string) => {
    setActiveTeam(id);
    window.localStorage.setItem("activeTeamId", id);
    loadLeaderboard(id);
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
            <div className="overflow-hidden rounded-lg border border-slate-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-800 text-slate-300">
                  <tr>
                    <th className="p-3">Rank</th>
                    <th className="p-3">Name</th>
                    <th className="p-3">Points</th>
                    <th className="p-3">Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr
                      key={row.name + idx}
                      className={idx % 2 === 0 ? "bg-slate-900" : "bg-slate-800"}
                    >
                      <td className="p-3">#{idx + 1}</td>
                      <td className="p-3 font-medium">{row.name}</td>
                      <td className="p-3">{row.points}</td>
                      <td className="p-3">{row.completed_count}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td className="p-3" colSpan={4}>
                        <p className="text-slate-500">No data yet for this team.</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
