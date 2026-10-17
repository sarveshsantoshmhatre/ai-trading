import { useCallback, useEffect, useState } from "react";
import PerformanceChart from "./components/PerformanceChart";
import RecentInvocations from "./components/RecentInvocations";
import Navbar from "./components/Navbar";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:3000";

function ChartSkeleton() {
  return <div className="relative w-full flex flex-1 border-r-2 border-black"><div className="w-full h-full flex items-center justify-center p-8"><div className="w-full h-full rounded bg-gray-100 animate-pulse" /></div></div>;
}
function ListSkeleton() {
  return <div className="hidden md:block md:w-[320px] shrink-0 p-4">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 mb-3 rounded bg-gray-100 animate-pulse" />)}</div>;
}

export default function App() {
  const [performanceData, setPerformanceData] = useState<any>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [invocationsData, setInvocationsData] = useState<any[] | null>(null);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [dataError, setDataError] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const [perfRes, invocRes] = await Promise.all([
        fetch(BACKEND_URL + "/performance", { credentials: "include" }),
        fetch(BACKEND_URL + "/invocations?limit=30", { credentials: "include" }),
      ]);
      if (perfRes.status === 401 || invocRes.status === 401) {
        setAuthenticated(false);
        return;
      }
      if (!perfRes.ok || !invocRes.ok) throw new Error("Dashboard API returned an error");
      const perfData = await perfRes.json();
      const invocData = await invocRes.json();
      setPerformanceData(perfData.data);
      setLastUpdated(perfData.lastUpdated ? new Date(perfData.lastUpdated) : null);
      setInvocationsData(invocData.data);
      setDataError("");
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
      setDataError("Unable to refresh dashboard data. Showing the last successful snapshot, if available.");
    }
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    fetch(BACKEND_URL + "/auth/me", { credentials: "include" })
      .then((res) => {
        if (!res.ok) {
          setAuthenticated(false);
          return;
        }
        setAuthenticated(true);
        void fetchData();
        interval = setInterval(() => void fetchData(), 3 * 60 * 1000);
      })
      .catch(() => {
        setAuthenticated(false);
        setAuthError("Cannot reach the dashboard API.");
      });
    return () => { if (interval) clearInterval(interval); };
  }, [fetchData]);

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError("");
    try {
      const response = await fetch(BACKEND_URL + "/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Login failed");
      setAuthenticated(true);
      setPassword("");
      await fetchData();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Login failed");
    }
  }

  async function logout() {
    await fetch(BACKEND_URL + "/auth/logout", { method: "POST", credentials: "include" });
    setAuthenticated(false);
    setPerformanceData(null);
    setInvocationsData(null);
  }

  if (authenticated === false) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <form onSubmit={login} className="w-full max-w-sm rounded border border-gray-300 bg-white p-6 shadow-sm">
        <h1 className="mb-2 text-xl font-bold">Alpha Arena dashboard</h1>
        <p className="mb-4 text-sm text-gray-600">Sign in to view private trading activity and portfolio history.</p>
        <label className="mb-2 block text-sm font-medium" htmlFor="dashboard-password">Dashboard password</label>
        <input id="dashboard-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="mb-3 w-full rounded border border-gray-300 p-2" />
        {authError && <p role="alert" className="mb-3 text-sm text-red-700">{authError}</p>}
        <button type="submit" className="w-full rounded bg-black px-4 py-2 font-medium text-white">Sign in</button>
      </form>
    </div>;
  }

  const loading = authenticated === null || !performanceData || !invocationsData;
  return <div className="h-screen flex flex-col overflow-hidden bg-gray-50 text-gray-900 font-[system-ui]">
    <div className="flex items-center justify-between border-b-2 border-black pr-4">
      <Navbar />
      <button onClick={logout} className="rounded border border-gray-400 px-3 py-1 text-sm">Sign out</button>
    </div>
    {dataError && <div role="status" className="bg-amber-50 px-4 py-2 text-sm text-amber-900">{dataError}</div>}
    <div className="flex min-h-0 flex-1 flex-col md:flex-row overflow-y-auto md:overflow-hidden">
      {loading ? <><ChartSkeleton /><ListSkeleton /></> : <><PerformanceChart data={performanceData} /><RecentInvocations data={invocationsData} /></>}
    </div>
    {lastUpdated && <div className="py-2 text-sm text-center text-gray-500 border-t-2 border-black">
      Last successful update: <span className="font-medium text-gray-700">{lastUpdated.toLocaleString()}</span>
    </div>}
  </div>;
}
