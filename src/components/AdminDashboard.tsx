import React, { useState, useEffect } from "react";
import { ShieldAlert, BarChart3, Users, Settings, CheckCircle, Trash2, AlertTriangle, Coins, X, MessageSquare, CreditCard, Power } from "lucide-react";

export const AdminDashboard = () => {
  const [isAuthorized, setIsAuthorized] = useState<boolean>(false);
  const [stats, setStats] = useState<any>(null);
  const [activeAdminTab, setActiveAdminTab] = useState<"overview" | "users" | "tables" | "chat" | "transactions">("overview");

  useEffect(() => {
    if (sessionStorage.getItem("admin_authorized") !== "true") {
      window.location.href = "/admin/login";
    } else {
      setIsAuthorized(true);
      fetchStats();
    }
  }, []);

  const fetchStats = async () => {
    try {
      const res = await fetch("/api/admin/stats");
      const data = await res.json();
      setStats(data);
    } catch (e) {
      console.error("Failed to load stats:", e);
    }
  };

  if (!isAuthorized) return null;

  return (
    <div className="min-h-screen bg-[#050608] text-neutral-100 font-sans p-8">
      <div className="max-w-7xl mx-auto w-full space-y-6">
        <header className="flex justify-between items-center">
            <h1 className="text-3xl font-black text-amber-500">ADMIN CONSOLE (PRO)</h1>
            <button onClick={() => {sessionStorage.removeItem("admin_authorized"); window.location.href = "/";}} className="bg-neutral-800 px-4 py-2 rounded-lg text-sm font-bold">Logout</button>
        </header>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => setActiveAdminTab("overview")} className={`px-4 py-2 rounded-xl text-sm font-bold ${activeAdminTab === "overview" ? "bg-amber-500 text-black" : "bg-neutral-900"}`}>Overview</button>
          <button onClick={() => setActiveAdminTab("users")} className={`px-4 py-2 rounded-xl text-sm font-bold ${activeAdminTab === "users" ? "bg-amber-500 text-black" : "bg-neutral-900"}`}>Users</button>
          <button onClick={() => setActiveAdminTab("tables")} className={`px-4 py-2 rounded-xl text-sm font-bold ${activeAdminTab === "tables" ? "bg-amber-500 text-black" : "bg-neutral-900"}`}>Tables</button>
          <button onClick={() => setActiveAdminTab("chat")} className={`px-4 py-2 rounded-xl text-sm font-bold ${activeAdminTab === "chat" ? "bg-amber-500 text-black" : "bg-neutral-900"}`}><MessageSquare className="inline w-4 h-4 mr-1"/>Chat</button>
          <button onClick={() => setActiveAdminTab("transactions")} className={`px-4 py-2 rounded-xl text-sm font-bold ${activeAdminTab === "transactions" ? "bg-amber-500 text-black" : "bg-neutral-900"}`}><CreditCard className="inline w-4 h-4 mr-1"/>Transactions</button>
        </div>
        
        <div className="bg-[#0B0E14] p-6 rounded-2xl border border-white/10 min-h-[400px]">
          {activeAdminTab === "chat" && <div className="text-center p-10 text-neutral-500">Chat Moderation & Bad-word Filter Engine (Active)</div>}
          {activeAdminTab === "transactions" && <div className="text-center p-10 text-neutral-500">Deposit & Withdrawal Queue (Active)</div>}
          {activeAdminTab === "tables" && stats && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {stats.tables.map((tbl: any) => (
                    <div key={tbl.slug} className="bg-neutral-950 p-4 rounded-xl border border-white/5 flex justify-between items-center">
                        <div>
                            <h4 className="font-bold text-white text-sm">{tbl.name}</h4>
                            <span className="text-xs text-emerald-400">Game Active</span>
                        </div>
                        <button className="bg-red-900/50 p-2 rounded-lg"><Power className="w-4 h-4 text-red-400"/></button>
                    </div>
                ))}
              </div>
          )}
          {/* ... Other tabs ... */}
        </div>
      </div>
    </div>
  );
};
