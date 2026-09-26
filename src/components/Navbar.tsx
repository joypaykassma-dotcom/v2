import React, { useState, useRef, useEffect } from "react";
import {
  Shield,
  Wallet,
  Gamepad2,
  Flame,
  Menu,
  ChevronDown,
  Globe,
  Check,
  Swords,
  Trophy,
  Crown,
} from "lucide-react";
import { UserWallet } from "../types";
import { formatCurrency, CURRENCIES, getStoredCurrencyCode } from "../utils/currency";

interface NavbarProps {
  user: UserWallet;
  activeTab: "game" | "p2p" | "leaderboard";
  setActiveTab: (tab: "game" | "p2p" | "leaderboard") => void;
  selectedTable: "express" | "classic" | "vip";
  onSelectTable: (table: "express" | "classic" | "vip") => void;
  soundEnabled?: boolean;
  onToggleSound?: () => void;
  voiceEnabled?: boolean;
  onToggleVoice?: () => void;
  onOpenWallet: () => void;
  onOpenMenu: () => void;
  onOpenOnlineUsers: () => void;
  onOpenQuickDeposit?: () => void;
  onOpenProfile?: () => void;
  onOpenProvablyFair?: () => void;
  onOpenRoadmap?: () => void;
  onOpenAdmin?: () => void;
  onOpenMerchant?: () => void;
  onOpenSiteLiquidity?: () => void;
  onOpenBetHistory?: () => void;
  onOpenRules?: () => void;
  onOpenTransparency?: () => void;
  onOpenPublicUsers?: () => void;
  onOpenReferral?: () => void;
  onOpenCurrencySelector?: () => void;
  selectedCurrency?: string;
  onLogout: () => void;
  onToggleBalanceType: () => void;
  lang?: "bn" | "en";
  onToggleLang?: () => void;
  telemetryPlayerCount?: number;
  tablePlayerCounts?: {
    express: number;
    classic: number;
    vip: number;
  };
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  activeTab,
  setActiveTab,
  selectedTable,
  onSelectTable,
  onOpenWallet,
  onOpenMenu,
  onOpenOnlineUsers,
  onOpenCurrencySelector,
  selectedCurrency,
  onToggleBalanceType,
  lang = "bn",
  onToggleLang,
  telemetryPlayerCount = 1,
  tablePlayerCounts,
}) => {
  const [tableDropdownOpen, setTableDropdownOpen] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeCurrencyCode = selectedCurrency || getStoredCurrencyCode();
  const activeCurrencyConfig = CURRENCIES[activeCurrencyCode] || CURRENCIES.INR;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setTableDropdownOpen(false);
      }
    };
    if (tableDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("touchstart", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [tableDropdownOpen]);

  // Real active counts calculation per table
  const realTableCounts = {
    express: tablePlayerCounts?.express ?? (selectedTable === "express" ? Math.max(1, telemetryPlayerCount) : 0),
    classic: tablePlayerCounts?.classic ?? (selectedTable === "classic" ? Math.max(1, telemetryPlayerCount) : 0),
    vip: tablePlayerCounts?.vip ?? (selectedTable === "vip" ? Math.max(1, telemetryPlayerCount) : 0),
  };

  const tableOptions: Array<{
    id: "express" | "classic" | "vip";
    name: string;
    icon: string;
    speed: string;
    minBet: number;
    maxBet: number;
    minBetFormatted: string;
    maxBetFormatted: string;
    realActiveCount: number;
  }> = [
    {
      id: "express",
      name: "Express",
      icon: "⚡",
      speed: "10s",
      minBet: 1 / activeCurrencyConfig.rateFromBase,
      maxBet: 1000,
      minBetFormatted: formatCurrency(1 / activeCurrencyConfig.rateFromBase, { currencyCode: activeCurrencyCode, convertFromBase: true }),
      maxBetFormatted: formatCurrency(1000, { currencyCode: activeCurrencyCode, convertFromBase: true }),
      realActiveCount: realTableCounts.express,
    },
    {
      id: "classic",
      name: "Classic",
      icon: "🎯",
      speed: "15s",
      minBet: 1 / activeCurrencyConfig.rateFromBase,
      maxBet: 10000,
      minBetFormatted: formatCurrency(1 / activeCurrencyConfig.rateFromBase, { currencyCode: activeCurrencyCode, convertFromBase: true }),
      maxBetFormatted: formatCurrency(10000, { currencyCode: activeCurrencyCode, convertFromBase: true }),
      realActiveCount: realTableCounts.classic,
    },
    {
      id: "vip",
      name: "VIP",
      icon: "👑",
      speed: "20s",
      minBet: 1 / activeCurrencyConfig.rateFromBase,
      maxBet: 100000,
      minBetFormatted: formatCurrency(1 / activeCurrencyConfig.rateFromBase, { currencyCode: activeCurrencyCode, convertFromBase: true }),
      maxBetFormatted: formatCurrency(100000, { currencyCode: activeCurrencyCode, convertFromBase: true }),
      realActiveCount: realTableCounts.vip,
    },
  ];

  const currentTable = tableOptions.find((t) => t.id === selectedTable) || tableOptions[0];

  const currentBalance = user.balanceType === "real" ? user.balance : user.demoBalance;

  return (
    <>
      {/* High-Performance Top Utility Bar */}
      <div className="bg-[#080B11] border-b border-white/5 px-2 sm:px-4 lg:px-6 py-1 flex items-center justify-between text-[11px] text-neutral-400 select-none w-full max-w-full overflow-hidden whitespace-nowrap gap-2">
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Clickable Active Online Player Counter */}
          <button
            onClick={onOpenOnlineUsers}
            title={lang === "bn" ? "অনলাইন সক্রিয় প্লেয়ারদের তালিকা দেখতে ক্লিক করুন" : "Click to view all active online players"}
            className="flex items-center gap-1.5 hover:bg-neutral-900/80 px-2 py-0.5 rounded-lg transition-all cursor-pointer group border border-transparent hover:border-emerald-500/30 shrink-0"
          >
            <div className="flex items-center gap-1.5 font-bold text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse group-hover:scale-125 transition-transform" />
              <span className="tracking-wide text-[10px] uppercase">{lang === "bn" ? "লাইভ" : "LIVE"}</span>
            </div>
            <span className="text-neutral-700">·</span>
            <span className="text-neutral-300 font-mono text-[11px] tabular-nums group-hover:text-emerald-300 transition-colors">
              <strong className="text-white font-bold underline decoration-dotted decoration-emerald-500/60">{telemetryPlayerCount.toLocaleString()}</strong>{" "}
              <span className="text-neutral-400 font-sans">{lang === "bn" ? "অনলাইন" : "Online"}</span>
            </span>
          </button>

          <span className="text-neutral-700 hidden md:inline">·</span>
          <span className="hidden md:inline font-mono text-neutral-400 text-[10px] tabular-nums">
            1,840 TPS · 14ms
          </span>
        </div>

        {/* Right Side: Language Trigger */}
        <div className="flex items-center gap-2 text-xs shrink-0">
          {/* Language Toggle */}
          {onToggleLang && (
            <button
              onClick={onToggleLang}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-neutral-900/90 hover:bg-neutral-800 text-[10px] font-semibold text-neutral-200 border border-neutral-800 hover:border-amber-500/40 transition-colors shrink-0 cursor-pointer"
            >
              <Globe className="w-3 h-3 text-amber-400 shrink-0" />
              <span>{lang === "bn" ? "BN" : "EN"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Top Navigation Header */}
      <header className="bg-[#0B0E14]/95 backdrop-blur-xl border-b border-white/10 sticky top-0 z-50 px-2 sm:px-4 lg:px-6 py-1.5 sm:py-2 shadow-xl transition-all w-full select-none">
        <div className="max-w-7xl mx-auto flex flex-col gap-2 w-full py-0.5">
          
          {/* Row 1: Brand/Logo (Left), Desktop Menu, and Menu Trigger Button (Right) */}
          <div className="flex items-center justify-between w-full">
            {/* Brand/Logo */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-gradient-to-br from-amber-400 via-amber-500 to-amber-700 p-0.5 shadow-md shadow-amber-500/10 flex items-center justify-center shrink-0">
                <div className="w-full h-full bg-[#0B0E14] rounded-[10px] flex items-center justify-center">
                  <Shield className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-400" />
                </div>
              </div>
              <div className="flex flex-col">
                <div className="text-xs sm:text-sm font-black tracking-wider text-white font-sans flex items-center gap-0.5 sm:gap-1 whitespace-nowrap">
                  <span>APEX</span>
                  <span className="text-amber-400 font-serif italic">CASINO</span>
                </div>
              </div>
            </div>

            {/* Desktop Center Navigation Tabs: Live Table, 1v1 P2P Duels, Leaderboard (Shown on XL screens) */}
            <div className="hidden xl:flex items-center gap-1 sm:gap-1.5 shrink-0">
              <button
                onClick={() => setActiveTab("game")}
                className={`flex items-center gap-1 sm:gap-1.5 px-2.5 py-1.5 rounded-xl font-bold text-xs transition-all whitespace-nowrap cursor-pointer ${
                  activeTab === "game"
                    ? "bg-amber-500 text-neutral-950 shadow-md shadow-amber-500/20 font-black"
                    : "bg-neutral-900/80 hover:bg-neutral-800 text-neutral-300 border border-neutral-800"
                }`}
              >
                <Gamepad2 className="w-3.5 h-3.5" />
                <span>{lang === "bn" ? "লাইভ টেবিল" : "Table"}</span>
              </button>

              <button
                onClick={() => setActiveTab("p2p")}
                className={`flex items-center gap-1 sm:gap-1.5 px-2.5 py-1.5 rounded-xl font-bold text-xs transition-all whitespace-nowrap cursor-pointer relative ${
                  activeTab === "p2p"
                    ? "bg-amber-500 text-neutral-950 shadow-md shadow-amber-500/20 font-black"
                    : "bg-gradient-to-r from-red-950/40 via-neutral-900 to-neutral-900 hover:bg-neutral-800 text-amber-300 border border-amber-500/30"
                }`}
              >
                <Swords className="w-3.5 h-3.5 text-amber-400" />
                <span>{lang === "bn" ? "⚔️ ১v১" : "⚔️ 1v1"}</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              </button>

              <button
                onClick={() => setActiveTab("leaderboard")}
                className={`flex items-center gap-1 sm:gap-1.5 px-2.5 py-1.5 rounded-xl font-bold text-xs transition-all whitespace-nowrap cursor-pointer ${
                  activeTab === "leaderboard"
                    ? "bg-amber-500 text-neutral-950 shadow-md shadow-amber-500/20 font-black"
                    : "bg-neutral-900/80 hover:bg-neutral-800 text-neutral-300 border border-neutral-800"
                }`}
              >
                <Trophy className="w-3.5 h-3.5" />
                <span>{lang === "bn" ? "র‍্যাংক" : "Rank"}</span>
              </button>
            </div>

            {/* Dedicated Menu Trigger Button (Guaranteed Always Visible and Uncovered on Top-Right) */}
            <button
              onClick={onOpenMenu}
              className="flex items-center gap-1 sm:gap-1.5 bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-neutral-950 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl font-black text-xs transition-all shadow-md shadow-amber-500/20 group shrink-0 cursor-pointer whitespace-nowrap active:scale-95 border border-amber-300 z-50"
              aria-label="Open Casino Menu and Settings Drawer"
            >
              <Menu className="w-4 h-4 text-neutral-950 group-hover:scale-110 transition-transform" />
              <span className="font-black tracking-wide text-xs">{lang === "bn" ? "মেনু" : "Menu"}</span>
            </button>
          </div>

          {/* Row 2: Lowered controls for comfortable mobile display (Table dropdown, Mode, Currency, Balance) */}
          <div className="flex items-center justify-between gap-1.5 w-full pt-1.5 border-t border-white/5">
            {/* Table Dropdown Switcher */}
            <div ref={dropdownRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setTableDropdownOpen((prev) => !prev)}
                aria-expanded={tableDropdownOpen}
                className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-gradient-to-r from-neutral-900 via-[#161d2e] to-neutral-900 border border-amber-500/60 hover:border-amber-400 text-xs font-black text-amber-300 shadow-md active:scale-95 transition-all shrink-0 whitespace-nowrap cursor-pointer"
              >
                <span className="text-sm">{currentTable.icon}</span>
                <span className="font-extrabold tracking-wide text-white">{currentTable.name}</span>
                <ChevronDown className="w-3 h-3 text-amber-400 shrink-0" />
              </button>

              {tableDropdownOpen && (
                <div className="absolute left-0 top-full mt-2 w-72 bg-[#0F131C] border border-amber-500/50 rounded-2xl shadow-2xl shadow-black/95 py-2.5 z-[100] backdrop-blur-xl ring-1 ring-white/10 overflow-hidden divide-y divide-white/10">
                  <div className="px-4 py-2 text-[10px] font-bold text-neutral-400 uppercase tracking-wider flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-neutral-200">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      {lang === "bn" ? "টেবিল নির্বাচন ও সীমা" : "Select Table & Limits"}
                    </span>
                  </div>
                  <div className="p-2 space-y-1.5">
                    {tableOptions.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          onSelectTable(t.id);
                          setTableDropdownOpen(false);
                        }}
                        className={`w-full text-left p-3 rounded-xl text-xs font-bold transition-all flex flex-col gap-1.5 border cursor-pointer ${
                          selectedTable === t.id
                            ? "bg-amber-500/20 border-amber-500/60 shadow-lg text-amber-200"
                            : "border-neutral-800/80 bg-neutral-900/80 hover:bg-neutral-800 hover:border-amber-500/30 text-neutral-300"
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <div className="flex items-center gap-2">
                            <span className="text-base">{t.icon}</span>
                            <span className="text-white font-extrabold text-xs sm:text-sm">{t.name}</span>
                          </div>
                          <span className="text-emerald-400 font-mono text-[10px] font-bold">{t.realActiveCount} Active</span>
                        </div>
                        <div className="flex items-center justify-between w-full pt-1 border-t border-white/5 text-[10px]">
                          <span className="text-neutral-400">Limits:</span>
                          <span className="text-amber-300 font-mono font-bold">{t.minBetFormatted} - {t.maxBetFormatted}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Controls Pack: Mode Switch, Currency and Wallet balance */}
            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 ml-auto">
              {/* Mode Switch (Real vs Demo) */}
              <button
                onClick={onToggleBalanceType}
                className="flex px-1.5 sm:px-2 py-1.5 rounded-xl text-[9px] sm:text-xs font-bold uppercase border border-amber-500/30 bg-[#161B26] hover:bg-[#202736] text-amber-300 shrink-0 transition-colors whitespace-nowrap cursor-pointer active:scale-95"
                title="Click to toggle Real vs Demo mode"
              >
                {user.balanceType === "real" ? "🟢 Real" : "🟣 Demo"}
              </button>

              {/* Currency Selector Button */}
              {onOpenCurrencySelector && (
                <button
                  onClick={onOpenCurrencySelector}
                  className="flex items-center gap-1 px-1.5 sm:px-2 py-1.5 rounded-xl border border-amber-500/30 hover:border-amber-400 bg-[#161B26] hover:bg-[#202736] text-neutral-200 hover:text-white transition-all shadow-md group shrink-0 cursor-pointer active:scale-95 whitespace-nowrap"
                  title={`Display Currency: ${activeCurrencyConfig.name} (${activeCurrencyConfig.code})`}
                >
                  <span className="text-sm leading-none shrink-0">
                    {activeCurrencyConfig.flag}
                  </span>
                  <span className="text-[10px] font-black text-amber-300 font-mono">
                    {activeCurrencyConfig.code}
                  </span>
                </button>
              )}

              {/* Cash Wallet Button */}
              <button
                onClick={onOpenWallet}
                className="flex items-center gap-1 bg-[#161B26] hover:bg-[#202736] border border-amber-500/40 hover:border-amber-400 px-2 py-1.5 rounded-xl transition-all shadow-md group shrink-0 cursor-pointer whitespace-nowrap active:scale-95 text-[11px] font-black text-amber-300 font-mono"
              >
                <Wallet className="w-3.5 h-3.5 text-amber-400" />
                <span>
                  {formatCurrency(currentBalance, {
                    currencyCode: activeCurrencyCode,
                    convertFromBase: true,
                  })}
                </span>
              </button>
            </div>
          </div>
        </div>
      </header>
    </>
  );
};

export default Navbar;
