import React, { useState } from "react";
import { ShieldAlert, X } from "lucide-react";

export const AdminLogin = ({ onLoginSuccess }: { onLoginSuccess: () => void }) => {
  const [adminUsername, setAdminUsername] = useState<string>("");
  const [adminPassword, setAdminPassword] = useState<string>("");
  const [authError, setAuthError] = useState<string | null>(null);

  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminUsername === "admin" && adminPassword === "123456") {
      sessionStorage.setItem("admin_authorized", "true");
      onLoginSuccess();
    } else {
      setAuthError("ভুল অ্যাডমিন ইউজারনেম অথবা পাসওয়ার্ড! পুনরায় চেষ্টা করুন।");
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="bg-[#0F131C] border-2 border-amber-500/40 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-6">
        <div className="text-center space-y-2 pt-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/40 flex items-center justify-center text-amber-400 mx-auto">
            <ShieldAlert className="w-6 h-6 animate-pulse" />
          </div>
          <h2 className="text-lg font-black text-white tracking-wide">অ্যাডমিন লগইন (Secure Login)</h2>
          <p className="text-xs text-neutral-400">অ্যাডমিন কনসোল অ্যাক্সেস করতে অনুগ্রহ করে পাসওয়ার্ড দিন</p>
        </div>

        <form onSubmit={handleAdminLogin} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider">ইউজারনেম</label>
            <input
              type="text"
              required
              value={adminUsername}
              onChange={(e) => setAdminUsername(e.target.value)}
              placeholder="Enter Username"
              className="w-full bg-neutral-950 border border-neutral-800 focus:border-amber-500/60 rounded-xl px-3.5 py-2.5 text-white text-xs outline-none font-bold transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider">পাসওয়ার্ড</label>
            <input
              type="password"
              required
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              placeholder="Enter Password"
              className="w-full bg-neutral-950 border border-neutral-800 focus:border-amber-500/60 rounded-xl px-3.5 py-2.5 text-white text-xs outline-none font-bold transition-all"
            />
          </div>

          {authError && (
            <div className="p-3 bg-red-500/15 border border-red-500/30 text-red-400 rounded-xl text-xs font-bold text-center">
              {authError}
            </div>
          )}

          <button
            type="submit"
            className="w-full py-3 bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-neutral-950 text-xs font-black rounded-xl transition-all shadow-md shadow-amber-500/15 cursor-pointer active:scale-95"
          >
            🔒 প্রবেশ করুন (Verify Auth)
          </button>
        </form>
      </div>
    </div>
  );
};
