import React from "react";
import { Swords, Trophy, Wallet, Gamepad2 } from "lucide-react";
import { UserWallet } from "../types";
import { sound } from "../utils/audio";
import { formatCurrency, getStoredCurrencyCode } from "../utils/currency";

interface MobileBottomNavProps {
  activeTab: "game" | "p2p" | "leaderboard";
  setActiveTab: (tab: "game" | "p2p" | "leaderboard") => void;
  onOpenWallet: () => void;
  user: UserWallet;
  openRoomsCount?: number;
  selectedCurrency?: string;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeTab,
  setActiveTab,
  onOpenWallet,
  user,
  openRoomsCount = 0,
  selectedCurrency,
}) => {
  const activeCurrencyCode = selectedCurrency || getStoredCurrencyCode();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0c0f17]/95 backdrop-blur-xl border-t border-amber-500/25 px-2 py-1.5 flex items-center justify-around safe-area-pb shadow-2xl">
      {/* 1. Game Table */}
      <button
        type="button"
        onClick={() => {
          sound.playButtonClick();
          setActiveTab("game");
        }}
        className={`flex-1 py-1 flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer ${
          activeTab === "game"
            ? "text-amber-400 font-black scale-105"
            : "text-neutral-400 hover:text-white"
        }`}
      >
        <Gamepad2 className={`w-5 h-5 ${activeTab === "game" ? "stroke-[2.5]" : "stroke-[1.75]"}`} />
        <span className="text-[10px] tracking-tight">Game</span>
      </button>

      {/* 2. P2P Lobby */}
      <button
        type="button"
        onClick={() => {
          sound.playButtonClick();
          setActiveTab("p2p");
        }}
        className={`flex-1 py-1 flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer relative ${
          activeTab === "p2p"
            ? "text-amber-400 font-black scale-105"
            : "text-neutral-400 hover:text-white"
        }`}
      >
        <div className="relative">
          <Swords className={`w-5 h-5 ${activeTab === "p2p" ? "stroke-[2.5]" : "stroke-[1.75]"}`} />
          {openRoomsCount > 0 && (
            <span className="absolute -top-1 -right-2 px-1 py-0.2 bg-red-500 text-white rounded-full text-[9px] font-mono font-bold leading-none animate-pulse">
              {openRoomsCount}
            </span>
          )}
        </div>
        <span className="text-[10px] tracking-tight">1v1 P2P</span>
      </button>

      {/* 3. Leaderboard */}
      <button
        type="button"
        onClick={() => {
          sound.playButtonClick();
          setActiveTab("leaderboard");
        }}
        className={`flex-1 py-1 flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer ${
          activeTab === "leaderboard"
            ? "text-amber-400 font-black scale-105"
            : "text-neutral-400 hover:text-white"
        }`}
      >
        <Trophy className={`w-5 h-5 ${activeTab === "leaderboard" ? "stroke-[2.5]" : "stroke-[1.75]"}`} />
        <span className="text-[10px] tracking-tight">Leaders</span>
      </button>

      {/* 4. Wallet */}
      <button
        type="button"
        onClick={() => {
          sound.playButtonClick();
          onOpenWallet();
        }}
        className="flex-1 py-1 flex flex-col items-center justify-center gap-0.5 text-neutral-400 hover:text-amber-300 transition-all cursor-pointer active:scale-95"
      >
        <Wallet className="w-5 h-5 text-emerald-400" />
        <span className="text-[10px] tracking-tight font-mono text-emerald-400 font-bold">
          {formatCurrency(user.balance, {
            currencyCode: activeCurrencyCode,
            convertFromBase: true,
          })}
        </span>
      </button>
    </nav>
  );
};
