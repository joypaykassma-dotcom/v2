import React, { useState, useEffect } from "react";
import { UserWallet, TableRound, RoadmapItem, HighLoadTelemetry } from "./types";
import { LoginScreen } from "./components/LoginScreen";
import { Navbar } from "./components/Navbar";
import { GameTable } from "./components/GameTable";
import { P2PLobby } from "./components/P2PLobby";
import { Leaderboard } from "./components/Leaderboard";
import { WalletModal } from "./components/WalletModal";
import { ProvablyFairModal } from "./components/ProvablyFairModal";
import { RoadmapModal } from "./components/RoadmapModal";
import { AdminDashboard } from "./components/AdminDashboard";
import { AdminLogin } from "./components/AdminLogin";
import { AdminModal } from "./components/AdminModal"; // Kept if needed elsewhere, but plan to remove usage
import { UserProfileModal } from "./components/UserProfileModal";
import { SiteLiquidityModal } from "./components/SiteLiquidityModal";
import { RegulatoryFooter } from "./components/RegulatoryFooter";
import { UserBetHistoryModal } from "./components/UserBetHistoryModal";
import { GameRulesModal } from "./components/GameRulesModal";
import { TransparencyCharterModal } from "./components/TransparencyCharterModal";
import { ReferralModal } from "./components/ReferralModal";
import { SideNavDrawer } from "./components/SideNavDrawer";
import { ActiveOnlineUsersModal } from "./components/ActiveOnlineUsersModal";
import { AutoLogoutTimer } from "./components/AutoLogoutTimer";
import { GlobalShortcuts } from "./components/GlobalShortcuts";
import { MobileBottomNav } from "./components/MobileBottomNav";
import { CurrencySelectorModal } from "./components/CurrencySelectorModal";
import { sound } from "./utils/audio";
import { getStoredCurrencyCode, setStoredCurrencyCode } from "./utils/currency";

export default function App() {
  const [user, setUser] = useState<UserWallet | null>(null);
  const [activeTab, setActiveTab] = useState<"game" | "p2p" | "leaderboard">("game");
  const [selectedTable, setSelectedTable] = useState<"express" | "classic" | "vip">("classic");
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(true);
  const [lang, setLang] = useState<"bn" | "en">("bn");
  const [telemetry, setTelemetry] = useState<HighLoadTelemetry | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState<string>(getStoredCurrencyCode());
  const [isCurrencySelectorOpen, setIsCurrencySelectorOpen] = useState<boolean>(false);

  // Modals & Overlays state
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const [isOnlineUsersOpen, setIsOnlineUsersOpen] = useState<boolean>(false);
  const [showRegulatoryFooter, setShowRegulatoryFooter] = useState<boolean>(false);
  const [isWalletOpen, setIsWalletOpen] = useState<boolean>(false);
  const [isProfileOpen, setIsProfileOpen] = useState<boolean>(false);
  const [isProvablyFairOpen, setIsProvablyFairOpen] = useState<boolean>(false);
  const [isRoadmapOpen, setIsRoadmapOpen] = useState<boolean>(false);
  const [isMerchantOpen, setIsMerchantOpen] = useState<boolean>(false);
  const [isLiquidityOpen, setIsLiquidityOpen] = useState<boolean>(false);
  const [isBetHistoryOpen, setIsBetHistoryOpen] = useState<boolean>(false);
  const [isGameRulesOpen, setIsGameRulesOpen] = useState<boolean>(false);
  const [isTransparencyOpen, setIsTransparencyOpen] = useState<boolean>(false);
  const [transparencyTab, setTransparencyTab] = useState<"charter" | "comparison" | "proofOfReserves" | "liveLedger" | "publicUsers">("charter");
  const [isReferralOpen, setIsReferralOpen] = useState<boolean>(false);

  // Active round reference for Provably Fair modal
  const [activeRound, setActiveRound] = useState<TableRound | null>(null);
  const [tableRoadmap, setTableRoadmap] = useState<RoadmapItem[]>([]);

  // Telemetry periodic fetch for high-load state
  useEffect(() => {
    const fetchTelemetry = async () => {
      try {
        const res = await fetch("/api/system/telemetry");
        if (res.ok) {
          const data = await res.json();
          setTelemetry(data);
        }
      } catch {
        // Fallback default high-load values
      }
    };
    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 6000);
    return () => clearInterval(interval);
  }, []);

  // Listen for custom currency changes across the app
  useEffect(() => {
    const handleCurrencyChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ code: string }>;
      if (customEvent.detail?.code) {
        setSelectedCurrency(customEvent.detail.code);
      }
    };
    window.addEventListener("currency-change", handleCurrencyChange);
    return () => window.removeEventListener("currency-change", handleCurrencyChange);
  }, []);

  // Check localStorage for saved user session on mount
  useEffect(() => {
    const savedUserId = localStorage.getItem("dt_user_id");
    const savedUsername = localStorage.getItem("dt_username");
    if (savedUserId && savedUsername) {
      fetchUser(savedUserId, savedUsername);
    }
  }, []);

  // Admin Route Auto-Detect Listener (domain.com/admin support)
  useEffect(() => {
    const checkAdminRoute = () => {
      const path = window.location.pathname;
      const hash = window.location.hash;
      if (path === "/admin" || path.endsWith("/admin") || hash === "#/admin" || hash === "#admin") {
        // Redirect to /admin route if needed
      }
    };
    checkAdminRoute();
    window.addEventListener("popstate", checkAdminRoute);
    window.addEventListener("hashchange", checkAdminRoute);
    return () => {
      window.removeEventListener("popstate", checkAdminRoute);
      window.removeEventListener("hashchange", checkAdminRoute);
    };
  }, [user]);

  // Real-time balance and user state polling loop (every 2.5s)
  useEffect(() => {
    if (!user?.userId) return;
    const interval = setInterval(() => {
      fetchUser(user.userId, user.username);
    }, 2500);
    return () => clearInterval(interval);
  }, [user?.userId, user?.username]);

  const fetchUser = async (userId: string, username: string) => {
    if (!userId || userId === "undefined" || userId.trim() === "") {
      handleLogout();
      return;
    }
    try {
      const res = await fetch(`/api/wallet/${encodeURIComponent(userId)}?username=${encodeURIComponent(username)}`);
      if (!res.ok) {
        throw new Error(`HTTP status error: ${res.status}`);
      }
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error("Response is not JSON format");
      }
      const data = await res.json();
      if (data && data.userId) {
        setUser(data);
        localStorage.setItem("dt_user_id", userId);
        localStorage.setItem("dt_username", username);
      } else {
        throw new Error("Invalid user profile payload");
      }
    } catch (e) {
      console.warn("User profile sync notice:", e);
      // Only clear session if user is not loaded into memory yet
      if (!user) {
        handleLogout();
      }
    }
  };

  const handleLoginSuccess = (loggedInUser: UserWallet) => {
    setUser(loggedInUser);
    localStorage.setItem("dt_user_id", loggedInUser.userId);
    localStorage.setItem("dt_username", loggedInUser.username);
  };

  const handleLogout = () => {
    localStorage.removeItem("dt_user_id");
    localStorage.removeItem("dt_username");
    setUser(null);
  };

  const handleToggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    sound.sfxEnabled = next;
  };

  const handleToggleVoice = () => {
    const next = !voiceEnabled;
    setVoiceEnabled(next);
    sound.voiceEnabled = next;
  };

  const handleToggleBalanceType = async () => {
    if (!user) return;
    const targetType: "demo" | "real" = user.balanceType === "real" ? "demo" : "real";
    
    // 1. Instant optimistic UI update
    setUser((prev) => (prev ? { ...prev, balanceType: targetType } : null));
    sound.playButtonClick();

    try {
      const res = await fetch(`/api/wallet/${user.userId}/toggle-balance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ balanceType: targetType }),
      });
      const data = await res.json();
      
      // 2. Explicit state check to ensure UI reflects target balance mode regardless of latency
      if (data.success && data.user) {
        setUser((prev) => {
          const resolvedType = (data.user.balanceType || targetType) as "demo" | "real";
          if (!prev) return { ...data.user, balanceType: resolvedType };
          return {
            ...data.user,
            balanceType: resolvedType,
          };
        });
      } else {
        // Fallback: reinforce optimistic target balance mode
        setUser((prev) => (prev ? { ...prev, balanceType: targetType } : null));
      }
    } catch (e) {
      console.error("Failed to toggle balance type on server:", e);
      // Retain optimistic balance mode on transient network error
      setUser((prev) => (prev ? { ...prev, balanceType: targetType } : null));
    }
  };

  const handleOpenRoadmap = async () => {
    try {
      const res = await fetch(`/api/tables/${selectedTable}/roadmap`);
      const data = await res.json();
      setTableRoadmap(data);
    } catch (e) {
      console.error(e);
    }
    setIsRoadmapOpen(true);
  };

  const handleOpenProvablyFair = async () => {
    try {
      const res = await fetch("/api/tables");
      const tables = await res.json();
      const match = tables.find((t: { config: { slug: string } }) => t.config.slug === selectedTable);
      if (match) setActiveRound(match.currentRound);
    } catch (e) {
      console.error(e);
    }
    setIsProvablyFairOpen(true);
  };

  const handleCloseAllModals = () => {
    setIsWalletOpen(false);
    setIsProfileOpen(false);
    setIsProvablyFairOpen(false);
    setIsRoadmapOpen(false);
    setIsMerchantOpen(false);
    setIsLiquidityOpen(false);
    setIsBetHistoryOpen(false);
    setIsGameRulesOpen(false);
    setIsTransparencyOpen(false);
    setIsReferralOpen(false);
    setIsMenuOpen(false);
    setIsOnlineUsersOpen(false);
  };

  // Updated admin route handler
  const path = window.location.pathname;
  const hash = window.location.hash;
  const isAdminRoute = path.startsWith("/admin") || hash.includes("#/admin") || hash.includes("#admin");

  if (isAdminRoute) {
    if (path === "/admin/login" || hash.includes("#/admin/login")) {
      return <AdminLogin onLoginSuccess={() => window.location.href = "/admin"} />;
    }
    return <AdminDashboard />;
  }

  if (!user) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen bg-[#07090e] text-neutral-100 flex flex-col font-sans selection:bg-amber-500 selection:text-neutral-950 overflow-x-hidden w-full relative">
      <div className="w-full flex-1 flex flex-col relative pb-24 md:pb-8">
        {/* Inactivity Security Auto-Logout (30 mins) */}
        <AutoLogoutTimer onLogout={handleLogout} timeoutMinutes={30} warningMinutes={2} />

        {/* Global Keyboard Shortcut Listener */}
        <GlobalShortcuts
          onOpenWallet={() => setIsWalletOpen(true)}
          onOpenLeaderboard={() => setActiveTab("leaderboard")}
          onOpenGame={() => setActiveTab("game")}
          onOpenP2P={() => setActiveTab("p2p")}
          onOpenMenu={() => setIsMenuOpen(true)}
          onCloseModals={handleCloseAllModals}
        />

        <Navbar
          user={user}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          selectedTable={selectedTable}
          onSelectTable={setSelectedTable}
          soundEnabled={soundEnabled}
          onToggleSound={handleToggleSound}
          voiceEnabled={voiceEnabled}
          onToggleVoice={handleToggleVoice}
          onOpenWallet={() => setIsWalletOpen(true)}
          onOpenProvablyFair={handleOpenProvablyFair}
          onOpenRoadmap={handleOpenRoadmap}
          onOpenMerchant={() => setIsMerchantOpen(true)}
          onOpenSiteLiquidity={() => setIsLiquidityOpen(true)}
          onOpenBetHistory={() => setIsBetHistoryOpen(true)}
          onOpenRules={() => setIsGameRulesOpen(true)}
          onOpenTransparency={() => {
            setTransparencyTab("charter");
            setIsTransparencyOpen(true);
          }}
          onOpenReferral={() => setIsReferralOpen(true)}
          onOpenCurrencySelector={() => setIsCurrencySelectorOpen(true)}
          selectedCurrency={selectedCurrency}
          onOpenMenu={() => setIsMenuOpen(true)}
          onOpenOnlineUsers={() => setIsOnlineUsersOpen(true)}
          onLogout={handleLogout}
          onToggleBalanceType={handleToggleBalanceType}
          lang={lang}
          onToggleLang={() => setLang((l) => (l === "bn" ? "en" : "bn"))}
          telemetryPlayerCount={telemetry?.totalActivePlayers ?? 1}
          tablePlayerCounts={telemetry?.tableActivePlayers}
        />

        <main className="flex-1 max-w-7xl w-full mx-auto px-2 sm:px-4 lg:px-8 py-2 sm:py-4 pb-24 md:pb-8 relative">
        {activeTab === "game" && (
          <GameTable
            user={user}
            selectedTableSlug={selectedTable}
            onUpdateWallet={setUser}
            onOpenProvablyFair={handleOpenProvablyFair}
            onOpenRoadmap={handleOpenRoadmap}
            onOpenBetHistory={() => setIsBetHistoryOpen(true)}
            onOpenRules={() => setIsGameRulesOpen(true)}
            onOpenProfile={() => setIsProfileOpen(true)}
            onToggleBalanceType={handleToggleBalanceType}
            onNavigateToP2P={() => setActiveTab("p2p")}
          />
        )}
        {activeTab === "p2p" && <P2PLobby user={user} onUpdateWallet={setUser} />}
        {activeTab === "leaderboard" && (
          <Leaderboard
            onOpenLiquidity={() => setIsLiquidityOpen(true)}
            currentUser={user}
          />
        )}
      </main>

      {/* Render Regulatory Footer on all views */}
      <RegulatoryFooter
        lang={lang}
        telemetry={telemetry}
        onOpenProvablyFair={handleOpenProvablyFair}
        onOpenLiquidity={() => setIsLiquidityOpen(true)}
        onOpenTransparency={() => setIsTransparencyOpen(true)}
        onOpenRules={() => setIsGameRulesOpen(true)}
        onOpenReferral={() => setIsReferralOpen(true)}
      />

      {/* Side Navigation Menu Drawer */}
      <SideNavDrawer
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        user={user}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        lang={lang}
        onToggleLang={() => setLang((l) => (l === "bn" ? "en" : "bn"))}
        soundEnabled={soundEnabled}
        onToggleSound={handleToggleSound}
        voiceEnabled={voiceEnabled}
        onToggleVoice={handleToggleVoice}
        onOpenWallet={() => {
          setIsMenuOpen(false);
          setIsWalletOpen(true);
        }}
        onOpenProfile={() => {
          setIsMenuOpen(false);
          setIsProfileOpen(true);
        }}
        onOpenProvablyFair={() => {
          setIsMenuOpen(false);
          handleOpenProvablyFair();
        }}
        onOpenRoadmap={() => {
          setIsMenuOpen(false);
          handleOpenRoadmap();
        }}
        onOpenRules={() => {
          setIsMenuOpen(false);
          setIsGameRulesOpen(true);
        }}
        onOpenTransparency={() => {
          setIsMenuOpen(false);
          setTransparencyTab("charter");
          setIsTransparencyOpen(true);
        }}
        onOpenPublicUsers={() => {
          setIsMenuOpen(false);
          setTransparencyTab("publicUsers");
          setIsTransparencyOpen(true);
        }}
        onOpenBetHistory={() => {
          setIsMenuOpen(false);
          setIsBetHistoryOpen(true);
        }}
        onOpenSiteLiquidity={() => {
          setIsMenuOpen(false);
          setIsLiquidityOpen(true);
        }}
        onOpenReferral={() => {
          setIsMenuOpen(false);
          setIsReferralOpen(true);
        }}
        onOpenCurrencySelector={() => {
          setIsMenuOpen(false);
          setIsCurrencySelectorOpen(true);
        }}
        selectedCurrency={selectedCurrency}
        onOpenMerchant={() => {
          setIsMenuOpen(false);
          setIsMerchantOpen(true);
        }}
        onToggleRegulatoryFooter={() => setShowRegulatoryFooter((prev) => !prev)}
        showRegulatoryFooter={showRegulatoryFooter}
        onToggleBalanceType={handleToggleBalanceType}
        onLogout={() => {
          setIsMenuOpen(false);
          handleLogout();
        }}
      />

      {/* Online Active Users Transparency Modal */}
      {isOnlineUsersOpen && (
        <ActiveOnlineUsersModal
          isOpen={isOnlineUsersOpen}
          onClose={() => setIsOnlineUsersOpen(false)}
          onlineCount={telemetry?.totalActivePlayers || 284592}
          lang={lang}
        />
      )}

      {/* MODALS */}
      {isReferralOpen && (
        <ReferralModal
          isOpen={isReferralOpen}
          onClose={() => setIsReferralOpen(false)}
          currentUser={user}
          onUpdateUser={setUser}
        />
      )}

      {isBetHistoryOpen && (
        <UserBetHistoryModal
          user={user}
          isOpen={isBetHistoryOpen}
          onClose={() => setIsBetHistoryOpen(false)}
          lang={lang}
        />
      )}

      {isGameRulesOpen && (
        <GameRulesModal
          isOpen={isGameRulesOpen}
          onClose={() => setIsGameRulesOpen(false)}
          lang={lang}
        />
      )}

      {isTransparencyOpen && (
        <TransparencyCharterModal
          isOpen={isTransparencyOpen}
          onClose={() => setIsTransparencyOpen(false)}
          lang={lang}
          onOpenProvablyFair={handleOpenProvablyFair}
          onOpenLiquidity={() => setIsLiquidityOpen(true)}
          initialTab={transparencyTab}
        />
      )}

      {isLiquidityOpen && (
        <SiteLiquidityModal
          isOpen={isLiquidityOpen}
          onClose={() => setIsLiquidityOpen(false)}
          currentUserId={user.userId}
        />
      )}

      {isProfileOpen && (
        <UserProfileModal
          user={user}
          onClose={() => setIsProfileOpen(false)}
          onOpenWallet={() => {
            setIsProfileOpen(false);
            setIsWalletOpen(true);
          }}
          onUpdateWallet={setUser}
          onOpenReferral={() => setIsReferralOpen(true)}
        />
      )}

      {isWalletOpen && (
        <WalletModal
          user={user}
          onClose={() => setIsWalletOpen(false)}
          onUpdateWallet={setUser}
          onOpenProfile={() => setIsProfileOpen(true)}
          onToggleBalanceType={handleToggleBalanceType}
        />
      )}

      {isProvablyFairOpen && (
        <ProvablyFairModal
          currentRound={activeRound}
          onClose={() => setIsProvablyFairOpen(false)}
        />
      )}

      {isRoadmapOpen && (
        <RoadmapModal
          tableName={selectedTable.toUpperCase()}
          roadmap={tableRoadmap}
          onClose={() => setIsRoadmapOpen(false)}
        />
      )}

      {isCurrencySelectorOpen && (
        <CurrencySelectorModal
          selectedCurrency={selectedCurrency}
          onSelectCurrency={(code) => {
            setSelectedCurrency(code);
            setStoredCurrencyCode(code);
          }}
          onClose={() => setIsCurrencySelectorOpen(false)}
          baseBalance={user?.balance || 50000}
        />
      )}

      {/* Mobile Fixed Bottom Navigation Bar */}
      <MobileBottomNav
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenWallet={() => setIsWalletOpen(true)}
        user={user}
        selectedCurrency={selectedCurrency}
      />
    </div>
  </div>
  );
}
