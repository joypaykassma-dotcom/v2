import React, { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  RotateCcw,
  Zap,
  Flame,
  Volume2,
  VolumeX,
  Mic,
  MicOff,
  Radio,
  ShieldCheck,
  TrendingUp,
  Users,
  CheckCircle2,
  BookOpen,
  Clock,
  Scale,
  Award,
  User,
  Check,
  Plus,
  Minus,
  RefreshCw,
  X,
  AlertCircle,
  HelpCircle,
  SlidersHorizontal,
  Swords,
} from "lucide-react";
import { UserWallet, TableRound, RoadmapItem, LiveBetRecord } from "../types";
import { motion, AnimatePresence } from "framer-motion";
import { PlayingCard as PlayingCardComponent } from "./PlayingCard";
import { useSoundManager } from "../utils/useSoundManager";
import { useActiveCurrency, formatCurrency } from "../utils/currency";
import { LiveChat } from "./LiveChat";
import { LiveBetFeed } from "./LiveBetFeed";
import { LiveAction } from "./LiveAction";

interface GameTableProps {
  user: UserWallet;
  selectedTableSlug: "express" | "classic" | "vip";
  onUpdateWallet: (updatedUser: UserWallet) => void;
  onOpenProvablyFair: () => void;
  onOpenRoadmap: () => void;
  onOpenBetHistory?: () => void;
  onOpenRules?: () => void;
  onOpenProfile?: () => void;
  onToggleBalanceType?: () => void;
  onNavigateToP2P?: () => void;
}

export const GameTable: React.FC<GameTableProps> = ({
  user,
  selectedTableSlug,
  onUpdateWallet,
  onOpenProvablyFair,
  onOpenRoadmap,
  onOpenBetHistory,
  onOpenRules,
  onOpenProfile,
  onToggleBalanceType,
  onNavigateToP2P,
}) => {
  const soundManager = useSoundManager();

  // Table Limits & Chip Configuration per Table
  const tableConfigs: Record<
    "express" | "classic" | "vip",
    {
      minBet: number;
      maxBet: number;
      chips: number[];
      quickAddIncrements: number[];
      step: number;
      speedLabel: string;
      name: string;
    }
  > = {
    express: {
      minBet: 1,
      maxBet: 1000,
      chips: [1, 5, 10, 25, 50, 100, 250, 500],
      quickAddIncrements: [1, 5, 10, 50, 100],
      step: 1,
      speedLabel: "15s Speed",
      name: "Express Speed Arena",
    },
    classic: {
      minBet: 1,
      maxBet: 10000,
      chips: [1, 10, 25, 50, 100, 250, 500, 1000, 2500],
      quickAddIncrements: [1, 10, 50, 100, 500, 1000],
      step: 10,
      speedLabel: "30s Standard",
      name: "Classic High Table",
    },
    vip: {
      minBet: 1,
      maxBet: 100000,
      chips: [1, 100, 250, 500, 1000, 2500, 5000, 10000, 25000],
      quickAddIncrements: [1, 100, 500, 1000, 5000, 10000],
      step: 100,
      speedLabel: "30s VIP",
      name: "VIP Diamond Lounge",
    },
  };

  const activeCurrency = useActiveCurrency();
  const baseLimits = tableConfigs[selectedTableSlug] || tableConfigs.express;
  
  // Dynamically calculate limits so the minimum bet is exactly 1 BDT / 1 INR / 1 USD depending on active rate!
  const activeLimits = {
    ...baseLimits,
    minBet: 1 / activeCurrency.rateFromBase,
    chips: [
      1 / activeCurrency.rateFromBase,
      5 / activeCurrency.rateFromBase,
      10 / activeCurrency.rateFromBase,
      50 / activeCurrency.rateFromBase,
      100 / activeCurrency.rateFromBase,
      500 / activeCurrency.rateFromBase,
      1000 / activeCurrency.rateFromBase,
      5000 / activeCurrency.rateFromBase,
    ].filter(c => c >= 1 / activeCurrency.rateFromBase)
  };

  const formatAmt = (amt: number | null | undefined, compact = false) =>
    formatCurrency(amt, { currencyCode: activeCurrency.code, convertFromBase: true, compact });

  // Streamlined Betting state (Side -> Amount -> Place)
  const [selectedSide, setSelectedSide] = useState<"DRAGON" | "TIGER" | null>(null);
  const [selectedAmount, setSelectedAmount] = useState<number>(activeLimits.minBet);
  const [customAmountInput, setCustomAmountInput] = useState<string>("");
  const [showCustomInput, setShowCustomInput] = useState<boolean>(false);

  // Staged side bets for legacy chip-stack clicks
  const [dragonBet, setDragonBet] = useState<number>(0);
  const [tigerBet, setTigerBet] = useState<number>(0);
  const [lastPlacedBet, setLastPlacedBet] = useState<{ side: "DRAGON" | "TIGER"; amount: number } | null>(null);
  
  // Pro Auto Bet Engine 2.0 State
  type AutoBetStrategy = "FLAT" | "MARTINGALE" | "ANTI_MARTINGALE" | "ALTERNATE" | "STREAK_CHASER";

  const [autoBetConfig, setAutoBetConfig] = useState<{
    isActive: boolean;
    strategy: AutoBetStrategy;
    side: "DRAGON" | "TIGER";
    baseAmount: number;
    currentStake: number;
    totalRounds: number; // 5, 10, 20, 50, 100, 9999
    roundsRemaining: number;
    roundsCompleted: number;
    totalWagered: number;
    totalProfitLoss: number;
    winsCount: number;
    lossesCount: number;
    currentStreak: number; // positive = win streak, negative = loss streak
    stopOnWin: boolean;
    stopOnLoss: boolean;
    stopProfitTarget: number; // 0 = off, else target profit amount
    stopLossLimit: number; // 0 = off, else max loss limit amount
    maxStakeCap: number; // Max stake cap for Martingale safety
  }>({
    isActive: false,
    strategy: "FLAT",
    side: "DRAGON",
    baseAmount: activeLimits.minBet,
    currentStake: activeLimits.minBet,
    totalRounds: 10,
    roundsRemaining: 10,
    roundsCompleted: 0,
    totalWagered: 0,
    totalProfitLoss: 0,
    winsCount: 0,
    lossesCount: 0,
    currentStreak: 0,
    stopOnWin: false,
    stopOnLoss: false,
    stopProfitTarget: 0,
    stopLossLimit: 0,
    maxStakeCap: activeLimits.maxBet,
  });

  const [showAutoBetModal, setShowAutoBetModal] = useState<boolean>(false);
  const autoBetProcessedRoundRef = useRef<number | null>(null);
  const autoBetPrevRoundRef = useRef<TableRound | null>(null);

  const [activeConfirmedBet, setActiveConfirmedBet] = useState<{
    id?: string;
    side: "DRAGON" | "TIGER";
    amount: number;
  } | null>(null);

  // UI helpers & Sheets
  const [showQuickGuide, setShowQuickGuide] = useState<boolean>(false);
  const [showRulesSheet, setShowRulesSheet] = useState<boolean>(false);
  const [showTrustBar, setShowTrustBar] = useState<boolean>(true);
  const [showProfileCard, setShowProfileCard] = useState<boolean>(true);
  const [showQuickNav, setShowQuickNav] = useState<boolean>(true);
  const [demoResetLoading, setDemoResetLoading] = useState<boolean>(false);
  const [cancelingBet, setCancelingBet] = useState<boolean>(false);

  // Live Table Round State from Server
  const [currentRound, setCurrentRound] = useState<TableRound | null>(null);
  const [roadmap, setRoadmap] = useState<RoadmapItem[]>([]);
  const [currentRoundBets, setCurrentRoundBets] = useState<LiveBetRecord[]>([]);
  const [recentSettledBets, setRecentSettledBets] = useState<LiveBetRecord[]>([]);
  const [dealerCommentary, setDealerCommentary] = useState<string>(
    "Welcome to the P2P Dragon Tiger Arena. Choose Dragon or Tiger to play!"
  );
  const [sidebarTab, setSidebarTab] = useState<"liveAction" | "chat" | "roadmap" | "guide">("liveAction");
  const [tieRefundBanner, setTieRefundBanner] = useState<{ amount: number; roundNumber: number } | null>(null);
  const [streakCelebration, setStreakCelebration] = useState<{ streak: number; roundNumber: number } | null>(null);
  const [showWinCelebration, setShowWinCelebration] = useState<boolean>(false);

  const activeBalance = user.balanceType === "real" ? user.balance : user.demoBalance;

  // Sync default amount when switching table
  useEffect(() => {
    if (selectedAmount < activeLimits.minBet || selectedAmount > activeLimits.maxBet) {
      setSelectedAmount(activeLimits.minBet);
      setCustomAmountInput(String(Math.round(activeLimits.minBet * activeCurrency.rateFromBase)));
    }
  }, [selectedTableSlug, activeLimits.minBet, activeLimits.maxBet, activeCurrency.rateFromBase]);

  // Check Onboarding Tutorial status
  useEffect(() => {
    const seen = localStorage.getItem("dt_tutorial_seen");
    if (!seen) {
      setShowQuickGuide(true);
    }
  }, []);

  const handleDismissTutorial = () => {
    setShowQuickGuide(false);
    localStorage.setItem("dt_tutorial_seen", "true");
  };

  // Pro Auto Bet Engine Automation Loop
  useEffect(() => {
    if (!currentRound) return;

    // 1. Auto Bet Execution during BETTING status
    if (
      autoBetConfig.isActive &&
      currentRound.status === "BETTING" &&
      currentRound.secondsRemaining > 2 &&
      autoBetProcessedRoundRef.current !== currentRound.roundNumber
    ) {
      const stakeToUse = autoBetConfig.currentStake;

      if (autoBetConfig.roundsRemaining > 0 && activeBalance >= stakeToUse) {
        autoBetProcessedRoundRef.current = currentRound.roundNumber;
        executeDirectBet(autoBetConfig.side, stakeToUse);

        setAutoBetConfig((prev) => {
          const nextRemaining = prev.roundsRemaining === 9999 ? 9999 : prev.roundsRemaining - 1;
          const isDone = nextRemaining <= 0;
          return {
            ...prev,
            roundsRemaining: nextRemaining,
            roundsCompleted: prev.roundsCompleted + 1,
            totalWagered: prev.totalWagered + stakeToUse,
            isActive: !isDone,
          };
        });
      } else {
        // Stop if balance is insufficient or rounds finished
        setAutoBetConfig((prev) => ({ ...prev, isActive: false }));
      }
    }

    // 2. Strategy Calculation & Stop Condition Checks when round settles
    if (
      autoBetConfig.isActive &&
      (currentRound.status === "SETTLING" || currentRound.status === "COMPLETED") &&
      currentRound.result &&
      autoBetPrevRoundRef.current?.roundNumber !== currentRound.roundNumber
    ) {
      autoBetPrevRoundRef.current = currentRound;
      const result = currentRound.result;
      const isWin = result === autoBetConfig.side;
      const isLoss = result !== "TIE" && result !== autoBetConfig.side;
      const isTie = result === "TIE";

      setAutoBetConfig((prev) => {
        let nextSide = prev.side;
        let nextStake = prev.baseAmount;
        let pnlDelta = 0;
        let newWins = prev.winsCount;
        let newLosses = prev.lossesCount;
        let newStreak = prev.currentStreak;

        if (isWin) {
          pnlDelta = prev.currentStake; // 1:1 payout net win
          newWins += 1;
          newStreak = prev.currentStreak > 0 ? prev.currentStreak + 1 : 1;

          // Strategy logic after Win
          if (prev.strategy === "FLAT") {
            nextStake = prev.baseAmount;
          } else if (prev.strategy === "MARTINGALE") {
            // Reset to base amount on win!
            nextStake = prev.baseAmount;
          } else if (prev.strategy === "ANTI_MARTINGALE") {
            // Double stake on win!
            nextStake = Math.min(prev.maxStakeCap, prev.currentStake * 2);
          } else if (prev.strategy === "ALTERNATE") {
            nextSide = prev.side === "DRAGON" ? "TIGER" : "DRAGON";
            nextStake = prev.baseAmount;
          } else if (prev.strategy === "STREAK_CHASER") {
            nextSide = result === "DRAGON" || result === "TIGER" ? result : prev.side;
            nextStake = prev.baseAmount;
          }
        } else if (isLoss) {
          pnlDelta = -prev.currentStake;
          newLosses += 1;
          newStreak = prev.currentStreak < 0 ? prev.currentStreak - 1 : -1;

          // Strategy logic after Loss
          if (prev.strategy === "FLAT") {
            nextStake = prev.baseAmount;
          } else if (prev.strategy === "MARTINGALE") {
            // Double stake on loss!
            nextStake = Math.min(prev.maxStakeCap, prev.currentStake * 2);
          } else if (prev.strategy === "ANTI_MARTINGALE") {
            // Reset to base amount on loss!
            nextStake = prev.baseAmount;
          } else if (prev.strategy === "ALTERNATE") {
            nextSide = prev.side === "DRAGON" ? "TIGER" : "DRAGON";
            nextStake = prev.baseAmount;
          } else if (prev.strategy === "STREAK_CHASER") {
            nextSide = result === "DRAGON" || result === "TIGER" ? result : prev.side;
            nextStake = prev.baseAmount;
          }
        } else if (isTie) {
          // Tie refunds stake or holds
          nextStake = prev.currentStake;
        }

        const newPnl = prev.totalProfitLoss + pnlDelta;

        // Check stop rules
        let shouldStop = false;
        if (isWin && prev.stopOnWin) shouldStop = true;
        if (isLoss && prev.stopOnLoss) shouldStop = true;
        if (prev.stopProfitTarget > 0 && newPnl >= prev.stopProfitTarget) shouldStop = true;
        if (prev.stopLossLimit > 0 && newPnl <= -prev.stopLossLimit) shouldStop = true;

        return {
          ...prev,
          side: nextSide,
          currentStake: nextStake,
          totalProfitLoss: newPnl,
          winsCount: newWins,
          lossesCount: newLosses,
          currentStreak: newStreak,
          isActive: !shouldStop && prev.isActive,
        };
      });
    }
  }, [currentRound, autoBetConfig, activeBalance]);

  // Fetch initial roadmap, round info, and transparent live bets
  useEffect(() => {
    const fetchTableData = async () => {
      try {
        const safeFetchJson = async (url: string) => {
          try {
            const res = await fetch(url);
            if (!res.ok) return null;
            const contentType = res.headers.get("content-type");
            if (!contentType || !contentType.includes("application/json")) return null;
            return await res.json();
          } catch {
            return null;
          }
        };

        const [tablesData, roadData, betsData] = await Promise.all([
          safeFetchJson("/api/tables"),
          safeFetchJson(`/api/tables/${selectedTableSlug}/roadmap`),
          safeFetchJson(`/api/tables/${selectedTableSlug}/bets`),
        ]);

        if (Array.isArray(tablesData)) {
          const match = tablesData.find((t: { config: { slug: string } }) => t.config.slug === selectedTableSlug);
          if (match) {
            setCurrentRound(match.currentRound);
          }
        }
        if (Array.isArray(roadData)) {
          setRoadmap(roadData);
        }
        if (betsData) {
          if (Array.isArray(betsData.currentRoundBets)) {
            setCurrentRoundBets(betsData.currentRoundBets);
          }
          if (Array.isArray(betsData.recentSettledBets)) {
            setRecentSettledBets(betsData.recentSettledBets);
          }
        }
      } catch (e) {
        console.error("Error fetching table data:", e);
      }
    };

    fetchTableData();
  }, [selectedTableSlug]);

  // WebSocket Live Subscription
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}`);

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "TIMER_TICK" && data.tableSlug === selectedTableSlug) {
          setCurrentRound((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              secondsRemaining: data.secondsRemaining,
              dragonPool: data.dragonPool,
              tigerPool: data.tigerPool,
              matchedAmount: data.matchedAmount,
            };
          });
          if (data.secondsRemaining === 5) {
            soundManager.playLastBets();
          }
          if (data.secondsRemaining <= 5 && data.secondsRemaining > 0) {
            soundManager.playTick(data.secondsRemaining);
          }
        } else if (data.type === "ROUND_PHASE" && data.tableSlug === selectedTableSlug) {
          setCurrentRound((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              status: data.status,
              matchedAmount: data.matchedAmount,
              dragonPool: data.dragonPool !== undefined ? data.dragonPool : prev.dragonPool,
              tigerPool: data.tigerPool !== undefined ? data.tigerPool : prev.tigerPool,
            };
          });
          if (data.status === "MATCHING" || data.status === "DEALING") {
            soundManager.playBetsClosed();
            const dPool = data.dragonPool || 0;
            const tPool = data.tigerPool || 0;
            const mAmount = data.matchedAmount || 0;
            const returnedTotal = Math.max(0, dPool + tPool - mAmount * 2);
            soundManager.announceMatchingPools(dPool, tPool, mAmount, returnedTotal);
            // Instantly refresh wallet upon matching so unmatched refunds appear immediately
            fetch(`/api/wallet/${user.userId}`)
              .then((r) => r.json())
              .then((updated) => onUpdateWallet(updated))
              .catch(() => {});
          }
        } else if (data.type === "ROUND_DEALING" && data.tableSlug === selectedTableSlug) {
          soundManager.triggerCardFlip();
          setCurrentRound((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              status: "DEALING",
              dragonCard: data.dragonCard,
              tigerCard: data.tigerCard,
              result: data.result,
            };
          });
        } else if (data.type === "NEW_BET" && data.tableSlug === selectedTableSlug) {
          if (data.bet) {
            setCurrentRoundBets((prev) => {
              if (prev.some((b) => b.id === data.bet.id)) return prev;
              return [data.bet, ...prev].slice(0, 60);
            });
          }
        } else if (data.type === "BET_CANCELLED" && data.tableSlug === selectedTableSlug) {
          setCurrentRoundBets((prev) => prev.filter((b) => b.id !== data.betId));
          if (activeConfirmedBet?.id === data.betId) {
            setActiveConfirmedBet(null);
          }
        } else if (data.type === "ROUND_RESULT" && data.tableSlug === selectedTableSlug) {
          setCurrentRound(data.round);
          setRoadmap(data.roadmap);
          if (Array.isArray(data.settledBets)) {
            setRecentSettledBets((prev) => [...data.settledBets, ...prev].slice(0, 80));
          }

          const winner = data.round.result;
          if (winner) {
            const dRank = data.round.dragonCard?.display || "Card";
            const tRank = data.round.tigerCard?.display || "Card";
            let payout = 0;
            let tieRefund = 0;

            if (activeConfirmedBet) {
              if (activeConfirmedBet.side === winner) {
                payout =
                  winner === "TIE"
                    ? Math.floor(activeConfirmedBet.amount * 8)
                    : Math.floor(activeConfirmedBet.amount * 1.9);
                setShowWinCelebration(true);
                setTimeout(() => setShowWinCelebration(false), 4000);
              } else if (
                winner === "TIE" &&
                (activeConfirmedBet.side === "DRAGON" || activeConfirmedBet.side === "TIGER")
              ) {
                tieRefund = 0;
                setTieRefundBanner({ amount: activeConfirmedBet.amount, roundNumber: data.round.roundNumber });
              }
            }

            soundManager.announceDetailedCardsAndResult(winner, dRank, tRank, payout, tieRefund);

            if (activeConfirmedBet) {
              if (activeConfirmedBet.side === winner) {
                soundManager.triggerWinningState(payout);
              } else if (
                winner === "TIE" &&
                (activeConfirmedBet.side === "DRAGON" || activeConfirmedBet.side === "TIGER")
              ) {
                soundManager.triggerCoinsClinking();
                soundManager.announceTieRefund(tieRefund);
              } else {
                soundManager.triggerLosingState(activeConfirmedBet.amount);
              }
            } else {
              soundManager.triggerCoinsClinking();
            }
          }

          fetch(`/api/wallet/${user.userId}`)
            .then((r) => r.json())
            .then((updated) => {
              onUpdateWallet(updated);
              if (
                updated?.stats?.currentStreak &&
                updated.stats.currentStreak >= 2 &&
                activeConfirmedBet?.side === winner
              ) {
                setStreakCelebration({ streak: updated.stats.currentStreak, roundNumber: data.round.roundNumber });
                soundManager.announceWinStreak(updated.stats.currentStreak);
              }
            })
            .catch(() => {});

          fetch("/api/ai-dealer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              lastWinner: data.round.result,
              tableSlug: selectedTableSlug,
            }),
          })
            .then((r) => r.json())
            .then((d) => {
              if (d.commentary) setDealerCommentary(d.commentary);
            })
            .catch(() => {});
        } else if (data.type === "NEW_ROUND" && data.tableSlug === selectedTableSlug) {
          setCurrentRound(data.round);
          setCurrentRoundBets([]);
          soundManager.triggerRoundInitiation();
          setActiveConfirmedBet(null);
          setTieRefundBanner(null);
          setStreakCelebration(null);
          setShowWinCelebration(false);

          setDragonBet(0);
          setTigerBet(0);
        }
      } catch (e) {
        console.error(e);
      }
    };

    return () => socket.close();
  }, [selectedTableSlug, user.userId, activeConfirmedBet]);

  // Stepper and Chip Selection Handlers
  const handleSelectSide = (side: "DRAGON" | "TIGER") => {
    soundManager.playChip(1.2);
    setSelectedSide(side);
  };

  const handleChipSelect = (amt: number) => {
    soundManager.playChip(1.2);
    setSelectedAmount(amt);
    setCustomAmountInput(String(Math.round(amt * activeCurrency.rateFromBase)));
    setShowCustomInput(false);
  };

  const handleAdjustAmount = (delta: number) => {
    soundManager.playChip(1.0);
    setSelectedAmount((prev) => {
      const next = Math.max(activeLimits.minBet, Math.min(activeLimits.maxBet, prev + (delta / activeCurrency.rateFromBase)));
      setCustomAmountInput(String(Math.round(next * activeCurrency.rateFromBase)));
      return next;
    });
  };

  const handleToggleCustomInput = () => {
    if (!showCustomInput) {
      setCustomAmountInput(String(Math.round(selectedAmount * activeCurrency.rateFromBase)));
    }
    setShowCustomInput(!showCustomInput);
  };

  const handleAddCustomAmount = (increment: number) => {
    soundManager.playChip(1.1);
    const current = Number(customAmountInput) || 0;
    const next = Math.min(Math.round(activeLimits.maxBet * activeCurrency.rateFromBase), current + increment);
    setCustomAmountInput(String(next));
    setSelectedAmount(next / activeCurrency.rateFromBase);
  };

  const handleKeypadTap = (action: string) => {
    soundManager.playChip(1.0);
    if (action === "CLEAR") {
      setCustomAmountInput("");
      setSelectedAmount(0);
    } else if (action === "BACKSPACE") {
      const next = customAmountInput.slice(0, -1);
      setCustomAmountInput(next);
      setSelectedAmount((Number(next) || 0) / activeCurrency.rateFromBase);
    } else {
      const next = (customAmountInput + action).replace(/^0+(?=\d)/, "");
      setCustomAmountInput(next);
      setSelectedAmount((Number(next) || 0) / activeCurrency.rateFromBase);
    }
  };

  const handleCustomInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "");
    setCustomAmountInput(raw);
    if (raw !== "") {
      const parsed = Number(raw);
      if (!isNaN(parsed)) {
        setSelectedAmount(parsed / activeCurrency.rateFromBase);
      }
    } else {
      setSelectedAmount(0);
    }
  };

  // Direct 1-Tap Bet Execution
  const executeDirectBet = async (side: "DRAGON" | "TIGER", amount: number) => {
    if (!user || !user.userId) {
      alert("Every player must be logged in to place a bet. Please log in.");
      return;
    }
    if (amount <= 0) return;
    if (amount < activeLimits.minBet) {
      alert(`Minimum bet for this table is ${formatAmt(activeLimits.minBet)}.`);
      return;
    }
    if (amount > activeLimits.maxBet) {
      alert(`Maximum bet for this table is ${formatAmt(activeLimits.maxBet)}.`);
      return;
    }
    if (activeBalance < amount) {
      alert(`Your balance is ${formatAmt(activeBalance)}, so ${formatAmt(amount)} cannot be placed.`);
      return;
    }

    try {
      const res = await fetch("/api/game/bet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.userId,
          tableSlug: selectedTableSlug,
          side: side.toLowerCase(),
          amount: amount,
          balanceType: user.balanceType,
        }),
      });
      const data = await res.json();
      if (data.success) {
        soundManager.triggerCoinsClinking();
        setLastPlacedBet({ side, amount });
        setActiveConfirmedBet({
          id: data.bet?.id,
          side: side,
          amount: amount,
        });
        soundManager.announceBetAmount(amount, side);
        if (data.bet) {
          setCurrentRoundBets((prev) => [data.bet, ...prev.filter((b) => b.id !== data.bet.id)]);
        }
        fetch(`/api/wallet/${user.userId}`)
          .then((r) => r.json())
          .then((updated) => onUpdateWallet(updated));
      } else {
        alert(data.error || "Failed to confirm bet");
      }
    } catch {
      alert("Connection interrupted. Please verify your connection.");
    }
  };

  // Cancel Active Bet (1-Tap Refund)
  const handleCancelActiveBet = async () => {
    if (!activeConfirmedBet || cancelingBet) return;
    setCancelingBet(true);
    try {
      const res = await fetch("/api/game/cancel-bet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.userId,
          tableSlug: selectedTableSlug,
          betId: activeConfirmedBet.id,
        }),
      });
      const data = await res.json();
      if (data.success) {
        soundManager.playButtonClick();
        setActiveConfirmedBet(null);
        fetch(`/api/wallet/${user.userId}`)
          .then((r) => r.json())
          .then((updated) => onUpdateWallet(updated));
      } else {
        alert(data.error || "Could not cancel bet");
      }
    } catch {
      alert("Failed to cancel bet.");
    } finally {
      setCancelingBet(false);
    }
  };

  // 1-Tap Demo Balance Reset
  const handleResetDemoBalance = async () => {
    if (demoResetLoading) return;
    setDemoResetLoading(true);
    try {
      const res = await fetch(`/api/wallet/${user.userId}/reset-demo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (data.success && data.user) {
        soundManager.triggerCoinsClinking();
        onUpdateWallet(data.user);
      }
    } catch {
      alert("Failed to reset demo balance.");
    } finally {
      setDemoResetLoading(false);
    }
  };

  // Quick Action Buttons
  const handleFollowBet = (side: "dragon" | "tiger" | "tie", amount: number) => {
    if (side === "tie") {
      alert("Tie-তে বাজি ধরা যায় না। শুধুমাত্র Dragon বা Tiger বেছে নিন।");
      return;
    }
    const targetSide = side.toUpperCase() as "DRAGON" | "TIGER";
    setSelectedSide(targetSide);
    const clampedAmt = Math.max(activeLimits.minBet, Math.min(activeLimits.maxBet, amount));
    setSelectedAmount(clampedAmt);
    executeDirectBet(targetSide, clampedAmt);
  };

  const handleDoubleBet = () => {
    soundManager.playChipStack();
    const doubled = selectedAmount * 2;
    if (doubled > activeLimits.maxBet) {
      alert(`Cannot exceed table maximum limit of ৳${activeLimits.maxBet.toLocaleString()}.`);
      return;
    }
    if (activeBalance < doubled) {
      alert("Insufficient balance to double bet.");
      return;
    }
    setSelectedAmount(doubled);
  };

  const handleRepeatBet = () => {
    if (!lastPlacedBet) return;
    if (activeBalance < lastPlacedBet.amount) {
      alert("Insufficient balance to repeat previous bet.");
      return;
    }
    soundManager.playChipStack();
    setSelectedSide(lastPlacedBet.side);
    setSelectedAmount(lastPlacedBet.amount);
    executeDirectBet(lastPlacedBet.side, lastPlacedBet.amount);
  };

  // Timer visualization and Human-friendly Round Phase Labels
  const maxTimer = currentRound?.totalDuration || 30;
  const timeLeft = currentRound?.secondsRemaining ?? maxTimer;
  const strokeDash = 264;
  const strokeDashoffset = strokeDash - (strokeDash * timeLeft) / maxTimer;

  const getPhaseDisplay = () => {
    if (!currentRound) return { label: "WAITING...", color: "text-neutral-400" };
    if (currentRound.status === "BETTING") {
      if (timeLeft <= 5) {
        return { label: `5 SECONDS LEFT (${timeLeft}s)`, color: "text-red-400 animate-pulse" };
      }
      return { label: `BETTING OPEN (${timeLeft}s)`, color: "text-emerald-400" };
    }
    if (currentRound.status === "MATCHING") {
      return { label: "BETTING CLOSED · MATCHING", color: "text-amber-400" };
    }
    if (currentRound.status === "DEALING") {
      return { label: "REVEALING CARDS", color: "text-blue-400 animate-pulse" };
    }
    if (currentRound.status === "SETTLING") {
      return { label: "CALCULATING RESULT", color: "text-purple-400" };
    }
    return { label: currentRound.status, color: "text-neutral-400" };
  };

  const phaseInfo = getPhaseDisplay();

  // Matched calculation for active bet
  const currentDragonPool = currentRound?.dragonPool || 0;
  const currentTigerPool = currentRound?.tigerPool || 0;
  const currentMatchedPool = currentRound?.matchedAmount || 0;

  const userActiveSidePool =
    activeConfirmedBet?.side === "DRAGON" ? currentDragonPool : currentTigerPool;
  const userOpposingSidePool =
    activeConfirmedBet?.side === "DRAGON" ? currentTigerPool : currentDragonPool;

  let userMatchedPortion = 0;
  let userWaitingPortion = 0;
  let matchPercentage = 100;

  if (activeConfirmedBet) {
    if (userActiveSidePool <= userOpposingSidePool) {
      userMatchedPortion = activeConfirmedBet.amount;
      userWaitingPortion = 0;
      matchPercentage = 100;
    } else {
      const matchRatio = userActiveSidePool > 0 ? userOpposingSidePool / userActiveSidePool : 1;
      userMatchedPortion = Math.floor(activeConfirmedBet.amount * matchRatio);
      userWaitingPortion = activeConfirmedBet.amount - userMatchedPortion;
      matchPercentage = Math.round(matchRatio * 100);
    }
  }

  // Validity checks for Place Bet button
  const isValidAmount =
    selectedAmount >= activeLimits.minBet && selectedAmount <= activeLimits.maxBet;
  const hasSufficientBalance = activeBalance >= selectedAmount;
  const isBettingOpen = currentRound?.status === "BETTING";
  const canPlaceBet = selectedSide && isValidAmount && hasSufficientBalance && isBettingOpen;

  return (
    <div className="space-y-3 sm:space-y-4 max-w-7xl mx-auto w-full relative">
      {/* Floating Coins / Particle Celebration Overlay */}
      <AnimatePresence>
        {showWinCelebration && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 pointer-events-none z-50 overflow-hidden flex items-center justify-center"
          >
            {[...Array(18)].map((_, i) => (
              <motion.div
                key={i}
                initial={{
                  y: 120,
                  x: (Math.random() - 0.5) * 350,
                  scale: 0.4,
                  opacity: 1,
                  rotate: 0,
                }}
                animate={{
                  y: -280 - Math.random() * 180,
                  x: (Math.random() - 0.5) * 550,
                  scale: [0.4, 1.3, 0.9],
                  opacity: [1, 1, 0],
                  rotate: Math.random() * 360,
                }}
                transition={{
                  duration: 2 + Math.random() * 1.5,
                  ease: "easeOut",
                  delay: Math.random() * 0.4,
                }}
                className="absolute text-2xl sm:text-3xl font-black text-amber-400 drop-shadow-[0_0_12px_rgba(251,191,36,0.9)]"
              >
                🪙
              </motion.div>
            ))}
            <motion.div
              initial={{ scale: 0.5, opacity: 0, y: 20 }}
              animate={{ scale: [0.5, 1.1, 1], opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0 }}
              className="px-6 sm:px-10 py-3 sm:py-5 bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600 text-neutral-950 font-black text-xl sm:text-3xl rounded-2xl shadow-[0_0_60px_rgba(251,191,36,0.7)] border-2 border-amber-200 animate-bounce flex items-center gap-3"
            >
              <span>🎉 রাউন্ড জয়ী! দুর্দান্ত জয়! 🎉</span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Arena Grid Layout */}

      {/* Expandable Trust & Rules Drawer */}
      <AnimatePresence>
        {showRulesSheet && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden bg-[#0F131D] border border-amber-500/40 rounded-2xl p-3.5 sm:p-4 text-xs space-y-3 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-white/5 pb-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-400" />
                <span className="font-black text-white text-sm">P2P Dragon Tiger Transparent Rules</span>
              </div>
              <button
                onClick={() => setShowRulesSheet(false)}
                className="text-neutral-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-neutral-300">
              <div className="bg-neutral-900/90 p-3 rounded-xl border border-neutral-800 space-y-1">
                <span className="text-amber-400 font-bold flex items-center gap-1.5">
                  <span>🤝</span> 1. Peer-to-Peer Matching
                </span>
                <p className="text-[11px] leading-relaxed text-neutral-400">
                  Player bets against player. Only the matched volume is put in play. Any unmatched funds are automatically refunded to your wallet when betting closes.
                </p>
              </div>

              <div className="bg-neutral-900/90 p-3 rounded-xl border border-neutral-800 space-y-1">
                <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                  <span>💰</span> 2. 1.9x Payout (5% Fee)
                </span>
                <p className="text-[11px] leading-relaxed text-neutral-400">
                  Winning side receives 1.9x their matched stake (net 90% profit after standard 5% platform board commission).
                </p>
              </div>

              <div className="bg-neutral-900/90 p-3 rounded-xl border border-red-500/30 space-y-1">
                <span className="text-red-400 font-bold flex items-center gap-1.5">
                  <span>⚖️</span> 3. Tie Rule Disclosure
                </span>
                <p className="text-[11px] leading-relaxed text-neutral-400">
                  If both cards have the exact same rank (e.g. 7 vs 7), matched bets on both Dragon and Tiger lose (bajeapto). Any unmatched amount is 100% refunded.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Main Arena (3 cols) */}
        <div className="lg:col-span-3 space-y-3 sm:space-y-4">
          {/* 3-Step Interactive Tutorial for Demo-First Onboarding */}
          <AnimatePresence>
            {showQuickGuide && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="bg-gradient-to-r from-purple-950/40 via-neutral-900/95 to-blue-950/40 border border-purple-500/40 rounded-2xl p-3 sm:p-4 shadow-xl relative overflow-hidden"
              >
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-xl bg-purple-500/20 text-purple-300 flex items-center justify-center font-black text-xs border border-purple-500/30">
                      <Sparkles className="w-4 h-4 text-purple-400" />
                    </div>
                    <div>
                      <span className="text-xs sm:text-sm font-black text-white">
                        ১০–১৫ সেকেন্ডে ডেমো গেম খেলুন (3-Step Quick Play)
                      </span>
                      <p className="text-[10px] text-purple-300">
                        ঝুঁকি ছাড়া সম্পূর্ণ ফ্রিতে ডেমো মোডে প্র্যাকটিস করুন।
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={handleDismissTutorial}
                    className="text-neutral-400 hover:text-white text-xs font-bold flex items-center gap-1 px-2.5 py-1 rounded-xl bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 transition-all cursor-pointer"
                  >
                    <span>Skip / বুঝেছি</span>
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-2.5 text-xs">
                  <div
                    className={`p-2.5 rounded-xl border transition-all ${
                      !selectedSide
                        ? "bg-purple-500/20 border-purple-400 shadow-md ring-1 ring-purple-400/50"
                        : "bg-neutral-950/70 border-neutral-800 text-neutral-400"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-bold text-white mb-1">
                      <span className="w-5 h-5 rounded-full bg-purple-500 text-white flex items-center justify-center text-[10px] font-black">
                        1
                      </span>
                      <span className="text-purple-300">Choose Side</span>
                    </div>
                    <p className="text-[11px] text-neutral-300 leading-snug">
                      Choose <strong>🐉 DRAGON</strong> or <strong>🐯 TIGER</strong>. (King is 13, Ace is 1).
                    </p>
                  </div>

                  <div
                    className={`p-2.5 rounded-xl border transition-all ${
                      selectedSide && !activeConfirmedBet
                        ? "bg-amber-500/20 border-amber-400 shadow-md ring-1 ring-amber-400/50"
                        : "bg-neutral-950/70 border-neutral-800 text-neutral-400"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-bold text-white mb-1">
                      <span className="w-5 h-5 rounded-full bg-amber-500 text-neutral-950 flex items-center justify-center text-[10px] font-black">
                        2
                      </span>
                      <span className="text-amber-300">Choose Amount</span>
                    </div>
                    <p className="text-[11px] text-neutral-300 leading-snug">
                      Select chip ({formatAmt(activeLimits.chips[0])}, {formatAmt(activeLimits.chips[1])}...) or adjust with <strong>[+]</strong> / <strong>[−]</strong>.
                    </p>
                  </div>

                  <div
                    className={`p-2.5 rounded-xl border transition-all ${
                      selectedSide && !activeConfirmedBet
                        ? "bg-emerald-500/25 border-emerald-400 shadow-md ring-1 ring-emerald-400 animate-pulse"
                        : "bg-neutral-950/70 border-neutral-800 text-neutral-400"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-bold text-white mb-1">
                      <span className="w-5 h-5 rounded-full bg-emerald-500 text-neutral-950 flex items-center justify-center text-[10px] font-black">
                        3
                      </span>
                      <span className="text-emerald-300">Place Bet</span>
                    </div>
                    <p className="text-[11px] text-emerald-300 font-medium leading-snug">
                      Tap <strong>'PLACE BET'</strong> before timer ends!
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Card Table Felt Canvas */}
          <div className="relative bg-gradient-to-b from-[#0d1524] via-[#09101c] to-[#040811] border-2 border-amber-500/40 rounded-2xl sm:rounded-3xl p-3 sm:p-5 lg:p-6 shadow-2xl overflow-hidden flex flex-col justify-between min-h-[410px]">
            {/* Header Strip inside Felt: Table limits & live status */}
            <div className="flex items-center justify-between gap-2 pb-2 mb-1 border-b border-white/5 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black tracking-wider text-amber-400 uppercase bg-amber-500/15 px-2.5 py-1 rounded-xl border border-amber-500/30">
                  {activeLimits.name}
                </span>
                <span className="text-[11px] font-mono text-neutral-400 bg-neutral-900/80 px-2 py-0.5 rounded-lg border border-neutral-800">
                  #{currentRound?.roundNumber || "1001"}
                </span>
              </div>

              {/* SPECIFIC MIN BET & MAX BET LIMITS DIRECT DISPLAY IN TABLE CANVAS */}
              <div className="flex items-center gap-2 bg-neutral-950/90 px-3 py-1 rounded-xl border border-amber-500/40 shadow-sm text-xs font-mono">
                <span className="text-neutral-400 text-[10px] uppercase font-bold">Limits:</span>
                <span className="text-amber-400 font-black">Min {formatAmt(activeLimits.minBet)}</span>
                <span className="text-neutral-600 font-bold">·</span>
                <span className="text-emerald-400 font-black">Max {formatAmt(activeLimits.maxBet)}</span>
                <span className="text-neutral-600 font-bold">·</span>
                <span className="text-neutral-300 text-[10px] font-sans">{activeLimits.speedLabel}</span>
              </div>
            </div>

            {/* Circular Countdown Timer & Dynamic Human-Friendly Phase Transitions */}
            <div className="flex flex-col items-center justify-center my-2">
              <motion.div
                animate={
                  currentRound?.status === "BETTING" && timeLeft <= 5
                    ? { scale: [1, 1.08, 1], transition: { repeat: Infinity, duration: 0.6 } }
                    : { scale: 1 }
                }
                className="relative w-18 h-18 sm:w-22 sm:h-22 flex items-center justify-center"
              >
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 96 96">
                  <circle cx="48" cy="48" r="42" stroke="#1E293B" strokeWidth="6" fill="transparent" />
                  <circle
                    cx="48"
                    cy="48"
                    r="42"
                    stroke={timeLeft <= 5 ? "#EF4444" : timeLeft <= 10 ? "#F59E0B" : "#10B981"}
                    strokeWidth="6"
                    strokeDasharray="264"
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    fill="transparent"
                    className="transition-all duration-1000 ease-linear"
                  />
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span
                    className={`text-xl sm:text-2xl font-black ${
                      timeLeft <= 5 ? "text-red-400 animate-pulse" : "text-white"
                    }`}
                  >
                    {currentRound?.status === "BETTING" ? timeLeft : "0"}
                  </span>
                  <span className="text-[8px] sm:text-[9px] uppercase font-bold tracking-wider text-neutral-400">
                    {currentRound?.status || "WAITING"}
                  </span>
                </div>
              </motion.div>

              {/* Human-Friendly Phase Label */}
              <div className="mt-1 text-center">
                <span className={`text-xs sm:text-sm font-black tracking-wide ${phaseInfo.color}`}>
                  {phaseInfo.label}
                </span>
              </div>
            </div>

            {/* Dragon & Tiger Card Zones (Selectable side in 1-tap) */}
            <div className="grid grid-cols-2 gap-3 sm:gap-6 my-2 relative">
              {/* DRAGON SIDE CARD ZONE */}
              <motion.div
                onClick={() => handleSelectSide("DRAGON")}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className={`cursor-pointer group relative rounded-2xl p-3 sm:p-5 border-2 transition-all flex flex-col items-center justify-between min-h-[160px] sm:min-h-[185px] ${
                  selectedSide === "DRAGON"
                    ? "bg-blue-600/35 border-blue-400 shadow-xl shadow-blue-500/50 ring-2 ring-blue-400"
                    : currentRound?.result === "DRAGON"
                    ? "bg-blue-600/25 border-blue-400"
                    : "bg-blue-950/20 border-blue-600/40 hover:border-blue-400 hover:bg-blue-950/40"
                }`}
              >
                {/* Header: Name, Return, Selected Badge */}
                <div className="w-full flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="font-black text-blue-400 text-sm sm:text-base tracking-wider uppercase">
                      🐉 DRAGON
                    </span>
                    <span className="text-[11px] text-blue-300 font-medium">(ড্রাগন)</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-blue-300 font-bold bg-blue-500/20 px-2 py-0.5 rounded-lg text-[10px] sm:text-xs border border-blue-500/30">
                      1.9x
                    </span>
                    {selectedSide === "DRAGON" && (
                      <span className="w-5 h-5 rounded-full bg-blue-500 text-white flex items-center justify-center">
                        <Check className="w-3.5 h-3.5" />
                      </span>
                    )}
                  </div>
                </div>

                {/* Card Display */}
                <div className="my-2">
                  {currentRound?.dragonCard ? (
                    <PlayingCardComponent
                      card={currentRound.dragonCard}
                      side="DRAGON"
                      isWinner={currentRound.result === "DRAGON"}
                    />
                  ) : (
                    <div className="w-16 h-22 sm:w-18 sm:h-26 rounded-xl border-2 border-dashed border-blue-500/40 bg-blue-950/40 flex flex-col items-center justify-center text-blue-400/80 font-mono text-xs">
                      <span className="font-bold text-xs">DRAGON</span>
                      <span className="text-[10px] text-blue-300/70 mt-0.5">Card 1</span>
                    </div>
                  )}
                </div>

                {/* Pool Volume */}
                <div className="w-full text-center">
                  <div className="text-[10px] sm:text-xs text-neutral-400 flex items-center justify-center gap-1">
                    <span>Pool:</span>
                    <span className="text-white font-mono font-bold">
                      {formatAmt(currentRound?.dragonPool || 0)}
                    </span>
                  </div>
                </div>
              </motion.div>

              {/* TIGER SIDE CARD ZONE */}
              <motion.div
                onClick={() => handleSelectSide("TIGER")}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className={`cursor-pointer group relative rounded-2xl p-3 sm:p-5 border-2 transition-all flex flex-col items-center justify-between min-h-[160px] sm:min-h-[185px] ${
                  selectedSide === "TIGER"
                    ? "bg-red-600/35 border-red-400 shadow-xl shadow-red-500/50 ring-2 ring-red-400"
                    : currentRound?.result === "TIGER"
                    ? "bg-red-600/25 border-red-400"
                    : "bg-red-950/20 border-red-600/40 hover:border-red-400 hover:bg-red-950/40"
                }`}
              >
                {/* Header: Name, Return, Selected Badge */}
                <div className="w-full flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="font-black text-red-400 text-sm sm:text-base tracking-wider uppercase">
                      🐯 TIGER
                    </span>
                    <span className="text-[11px] text-red-300 font-medium">(টাইগার)</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-red-300 font-bold bg-red-500/20 px-2 py-0.5 rounded-lg text-[10px] sm:text-xs border border-red-500/30">
                      1.9x
                    </span>
                    {selectedSide === "TIGER" && (
                      <span className="w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center">
                        <Check className="w-3.5 h-3.5" />
                      </span>
                    )}
                  </div>
                </div>

                {/* Card Display */}
                <div className="my-2">
                  {currentRound?.tigerCard ? (
                    <PlayingCardComponent
                      card={currentRound.tigerCard}
                      side="TIGER"
                      isWinner={currentRound.result === "TIGER"}
                    />
                  ) : (
                    <div className="w-16 h-22 sm:w-18 sm:h-26 rounded-xl border-2 border-dashed border-red-500/40 bg-red-950/40 flex flex-col items-center justify-center text-red-400/80 font-mono text-xs">
                      <span className="font-bold text-xs">TIGER</span>
                      <span className="text-[10px] text-red-300/70 mt-0.5">Card 2</span>
                    </div>
                  )}
                </div>

                {/* Pool Volume */}
                <div className="w-full text-center">
                  <div className="text-[10px] sm:text-xs text-neutral-400 flex items-center justify-center gap-1">
                    <span>Pool:</span>
                    <span className="text-white font-mono font-bold">
                      {formatAmt(currentRound?.tigerPool || 0)}
                    </span>
                  </div>
                </div>
              </motion.div>
            </div>

            {/* Tie Outcome & 100% Loss Rule Notice */}
            <div className="rounded-xl p-2 bg-neutral-950/80 border border-neutral-800 text-[11px] flex items-center justify-between px-3 text-neutral-400">
              <span className="flex items-center gap-1.5 font-bold text-red-400">
                <Scale className="w-3.5 h-3.5" />
                TIE OUTCOME:
              </span>
              <span>উভয় কার্ড সমান হলে টাই হয় এবং উভয়ের বাজি বাজেয়াপ্ত (Loss) হয়।</span>
            </div>
          </div>

          {/* ACTIVE BET & P2P MATCHING STATUS COMPONENT (Progress & 1-Tap Cancel) */}
          {activeConfirmedBet && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-[#111622] border-2 border-amber-500/50 rounded-2xl p-3.5 sm:p-4 shadow-xl space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="font-black text-white text-xs sm:text-sm">
                    Your {activeConfirmedBet.side} Bet: {formatAmt(activeConfirmedBet.amount)}
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                      user.balanceType === "real"
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                        : "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                    }`}
                  >
                    {user.balanceType}
                  </span>
                </div>

                {isBettingOpen && (
                  <button
                    onClick={handleCancelActiveBet}
                    disabled={cancelingBet}
                    className="text-[11px] font-bold text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 px-2.5 py-1 rounded-xl transition-all cursor-pointer"
                  >
                    {cancelingBet ? "Canceling..." : "Cancel Bet (রিফান্ড)"}
                  </button>
                )}
              </div>

              {/* Progress Bar & Breakdown */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-emerald-400 font-bold">
                    Matched (In-Play): {formatAmt(userMatchedPortion)}
                  </span>
                  <span className="text-neutral-400">
                    Waiting: {formatAmt(userWaitingPortion)}
                  </span>
                </div>

                <div className="w-full bg-neutral-900 h-2.5 rounded-full overflow-hidden border border-neutral-800">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 to-emerald-400 transition-all duration-500"
                    style={{ width: `${matchPercentage}%` }}
                  />
                </div>

                <div className="text-[10px] text-neutral-400 flex items-center justify-between">
                  <span>
                    {matchPercentage === 100
                      ? "✅ বাজি ১০০% ম্যাচড হয়ে গেছে (সম্পূর্ণ টাকা খেলছে)"
                      : `⚡ ${matchPercentage}% ম্যাচড হয়েছে — বাকি টাকা রাউন্ড শেষে রিফান্ড হবে`}
                  </span>
                  <span className="font-mono text-amber-400">{matchPercentage}%</span>
                </div>
              </div>
            </motion.div>
          )}

          {/* STREAMLINED STICKY BETTING AREA (3-Step: Side -> Amount -> Place Bet Button) */}
          <div className="sticky bottom-[62px] md:bottom-3 z-30 bg-[#0A0E18]/95 border-2 border-amber-500/50 rounded-2xl sm:rounded-3xl p-3 sm:p-4 space-y-3 shadow-2xl backdrop-blur-xl ring-1 ring-amber-500/30 my-3">
            {/* Real vs Demo Balance Indicator + Demo Refill Button */}
            <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-neutral-800 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={onToggleBalanceType}
                  title="Click to switch between Real and Demo mode"
                  className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase flex items-center gap-1.5 shadow-md active:scale-95 transition-all cursor-pointer ${
                    user.balanceType === "real"
                      ? "bg-amber-500 text-neutral-950 ring-2 ring-amber-400/80 hover:bg-amber-400"
                      : "bg-purple-600 text-white ring-2 ring-purple-400/80 hover:bg-purple-500"
                  }`}
                >
                  <span>{user.balanceType === "real" ? "🟡 REAL MONEY" : "🟣 DEMO ACCOUNT"}</span>
                  <span className="text-[10px] bg-black/30 px-1.5 py-0.5 rounded font-mono text-white">⇄ Switch</span>
                </button>
                <span className="text-xs font-mono font-bold text-white">
                  Available: {formatAmt(activeBalance)}
                </span>
              </div>

              {user.balanceType === "demo" && (
                <button
                  type="button"
                  onClick={handleResetDemoBalance}
                  disabled={demoResetLoading}
                  className="text-[11px] font-bold text-purple-300 hover:text-white bg-purple-950/60 hover:bg-purple-900 border border-purple-500/40 px-2.5 py-1 rounded-xl flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${demoResetLoading ? "animate-spin" : ""}`} />
                  <span>Reset Demo (৳10,000)</span>
                </button>
              )}
            </div>

            {/* Pro Auto Bet Active Status Banner with Session Analytics */}
            {autoBetConfig.isActive && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-gradient-to-r from-cyan-950/95 via-neutral-900 to-cyan-950/95 border-2 border-cyan-500/70 rounded-2xl p-3 flex flex-col sm:flex-row items-center justify-between gap-2 shadow-2xl ring-2 ring-cyan-500/25"
              >
                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center text-cyan-300 font-bold shrink-0 shadow-inner">
                    🤖
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-xs font-black text-cyan-300 flex items-center gap-2 flex-wrap">
                      <span>AUTO BET ENGINE</span>
                      <span className="px-2 py-0.5 bg-cyan-500/20 border border-cyan-400/40 text-cyan-200 text-[10px] rounded font-mono font-bold">
                        Rounds: {autoBetConfig.roundsCompleted + 1} / {autoBetConfig.totalRounds === 9999 ? '∞' : autoBetConfig.totalRounds}
                      </span>
                      <span className="px-2 py-0.5 bg-amber-500/20 border border-amber-400/40 text-amber-300 text-[10px] rounded font-mono font-bold uppercase">
                        Mode: {autoBetConfig.strategy}
                      </span>
                    </div>

                    <div className="text-[11px] text-neutral-300 font-mono flex items-center gap-2 flex-wrap">
                      <span>Side: <strong className={autoBetConfig.side === "DRAGON" ? "text-blue-400" : "text-red-400"}>{autoBetConfig.side}</strong></span>
                      <span>Next Stake: <strong className="text-amber-400">{formatAmt(autoBetConfig.currentStake)}</strong></span>
                      <span className="text-neutral-500">|</span>
                      <span>Record: <strong className="text-emerald-400">W:{autoBetConfig.winsCount}</strong> / <strong className="text-rose-400">L:{autoBetConfig.lossesCount}</strong></span>
                      <span className="text-neutral-500">|</span>
                      <span>
                        P/L:{" "}
                        <strong className={autoBetConfig.totalProfitLoss >= 0 ? "text-emerald-400 font-black" : "text-rose-400 font-black"}>
                          {autoBetConfig.totalProfitLoss >= 0 ? "+" : ""}{formatAmt(autoBetConfig.totalProfitLoss)}
                        </strong>
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setAutoBetConfig((prev) => ({ ...prev, isActive: false }));
                    soundManager.playButtonClick();
                  }}
                  className="w-full sm:w-auto px-4 py-2 rounded-xl bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 text-white font-black text-xs uppercase shadow-lg shadow-rose-600/30 active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-1.5 shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>STOP AUTO</span>
                </button>
              </motion.div>
            )}

            {/* Step 1: Side Selector Pills */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-bold text-neutral-400 uppercase tracking-wider">
                <span>Step 1: Choose Side</span>
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playButtonClick();
                    setShowAutoBetModal(true);
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold flex items-center gap-1 transition-all cursor-pointer border ${
                    autoBetConfig.isActive
                      ? "bg-cyan-500 text-neutral-950 border-cyan-300 shadow-sm shadow-cyan-500/50"
                      : "bg-neutral-900 text-cyan-400 border-neutral-800 hover:border-cyan-500/50 hover:bg-neutral-850"
                  }`}
                >
                  <span>🤖 Auto Bet</span>
                  {autoBetConfig.isActive && <span className="w-2 h-2 rounded-full bg-neutral-950 animate-ping" />}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleSelectSide("DRAGON")}
                  className={`py-2.5 px-3 rounded-xl font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition-all border ${
                    selectedSide === "DRAGON"
                      ? "bg-blue-600 text-white border-blue-400 shadow-lg shadow-blue-500/40 ring-2 ring-blue-400"
                      : "bg-neutral-900 text-blue-300 border-neutral-800 hover:border-blue-500/50"
                  }`}
                >
                  <span>🐉 DRAGON (ড্রাগন)</span>
                  {selectedSide === "DRAGON" && <Check className="w-4 h-4 text-white" />}
                </button>

                <button
                  onClick={() => handleSelectSide("TIGER")}
                  className={`py-2.5 px-3 rounded-xl font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition-all border ${
                    selectedSide === "TIGER"
                      ? "bg-red-600 text-white border-red-400 shadow-lg shadow-red-500/40 ring-2 ring-red-400"
                      : "bg-neutral-900 text-red-300 border-neutral-800 hover:border-red-500/50"
                  }`}
                >
                  <span>🐯 TIGER (টাইগার)</span>
                  {selectedSide === "TIGER" && <Check className="w-4 h-4 text-white" />}
                </button>
              </div>
            </div>

            {/* Step 2: Responsive Smart Chips Grid (Room & Currency Tailored) */}
            <div className="space-y-2.5 pt-2 border-t border-neutral-800/80">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-white uppercase tracking-wider text-[11px] flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                    <span>Smart Chips ({activeLimits.name.split(" ")[0]})</span>
                  </span>
                  <span className="text-[10px] text-amber-400 font-mono bg-neutral-900 border border-neutral-800 px-2 py-0.5 rounded-md font-bold">
                    {activeCurrency.symbol} {activeCurrency.code}
                  </span>
                </div>

                <span className="text-amber-400/90 font-mono font-bold text-[11px]">
                  Min {formatAmt(activeLimits.minBet)} · Max {formatAmt(activeLimits.maxBet)}
                </span>
              </div>

              {/* 1-Tap Incremental Action Bar (MIN, 1/2, 2X, MAX, +Inc) */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                <button
                  type="button"
                  onClick={() => handleChipSelect(activeLimits.minBet)}
                  className="px-2.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-[10px] font-mono font-bold text-amber-400 border border-neutral-800 hover:border-amber-500/50 active:scale-95 transition-all cursor-pointer shrink-0"
                >
                  MIN ({formatAmt(activeLimits.minBet, true)})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playChip(1.0);
                    const half = Math.max(activeLimits.minBet, Math.floor(selectedAmount / 2));
                    setSelectedAmount(half);
                    setCustomAmountInput(String(half));
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-[10px] font-mono font-bold text-neutral-300 border border-neutral-800 hover:border-amber-500/50 active:scale-95 transition-all cursor-pointer shrink-0"
                >
                  1/2
                </button>
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playChip(1.1);
                    const double = Math.min(activeLimits.maxBet, selectedAmount * 2);
                    setSelectedAmount(double);
                    setCustomAmountInput(String(double));
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-[10px] font-mono font-bold text-amber-400 border border-neutral-800 hover:border-amber-500/50 active:scale-95 transition-all cursor-pointer shrink-0"
                >
                  2X
                </button>
                {activeLimits.quickAddIncrements.map((inc) => (
                  <button
                    key={inc}
                    type="button"
                    onClick={() => handleAddCustomAmount(inc)}
                    className="px-2.5 py-1.5 rounded-lg bg-neutral-900/90 hover:bg-neutral-800 text-[10px] font-mono font-bold text-amber-300 border border-neutral-800 hover:border-amber-500/50 active:scale-95 transition-all cursor-pointer shrink-0"
                  >
                    +{formatAmt(inc, true)}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playChip(1.2);
                    const max = Math.min(activeLimits.maxBet, activeBalance);
                    setSelectedAmount(max);
                    setCustomAmountInput(String(max));
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 text-neutral-950 font-mono text-[10px] font-black shadow-sm active:scale-95 transition-all cursor-pointer shrink-0"
                >
                  MAX ({formatAmt(Math.min(activeLimits.maxBet, activeBalance), true)})
                </button>
              </div>

              {/* Smart Chips Grid: 4 cols on mobile, 8 cols on desktop */}
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5 sm:gap-2">
                {activeLimits.chips.map((c) => {
                  const isSelected = selectedAmount === c && !showCustomInput;
                  const isMin = c === activeLimits.minBet;

                  return (
                    <motion.button
                      key={c}
                      whileHover={{ scale: 1.04 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => handleChipSelect(c)}
                      className={`relative py-2.5 px-1 rounded-xl font-mono font-black text-xs border transition-all flex flex-col items-center justify-center cursor-pointer shadow-sm ${
                        isSelected
                          ? "bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400 text-neutral-950 border-amber-300 shadow-lg shadow-amber-500/30 scale-105 ring-2 ring-amber-300/50 z-10 font-black"
                          : isMin
                          ? "bg-neutral-900/90 border-amber-500/60 text-amber-300 hover:border-amber-400 hover:bg-neutral-850"
                          : "bg-neutral-900/80 border-neutral-800/90 text-neutral-200 hover:border-neutral-600 hover:bg-neutral-850"
                      }`}
                    >
                      {isMin && (
                        <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 px-1.5 py-0.2 bg-amber-500 text-neutral-950 text-[8px] font-black rounded uppercase font-mono shadow-sm tracking-wider">
                          MIN
                        </span>
                      )}
                      <span className="tabular-nums text-xs sm:text-sm">
                        {formatAmt(c, false)}
                      </span>
                    </motion.button>
                  );
                })}
              </div>

              {/* Active Amount Display & Numpad Drawer Toggle */}
              <div className="flex items-center gap-2 pt-1">
                <div className="flex-1 bg-neutral-950/90 border border-neutral-800 rounded-xl px-3 py-2 flex items-center justify-between shadow-inner">
                  <span className="text-[11px] text-neutral-400 font-bold uppercase tracking-wider">Active Bet:</span>
                  <div className="flex items-center gap-2">
                    <span className="text-amber-400 font-black font-mono text-sm sm:text-base">
                      {formatAmt(selectedAmount)}
                    </span>
                    <span className="text-[10px] text-emerald-400 font-mono font-bold">
                      (Payout: {formatAmt(Math.floor(selectedAmount * 1.9))})
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleToggleCustomInput}
                  title="Custom Numpad Keypad"
                  className={`px-3 py-2 rounded-xl border text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    showCustomInput
                      ? "bg-amber-500 text-neutral-950 border-amber-400 font-extrabold shadow-md"
                      : "bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-white hover:border-neutral-700"
                  }`}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span className="text-[11px]">Numpad</span>
                </button>
              </div>

              {/* Custom Numeric Input Dropdown (Super Easy To Use with Dynamic Table Presets & Direct Bet Buttons) */}
              {showCustomInput && (() => {
                const parsedVal = Number(customAmountInput);
                const isEmpty = customAmountInput.trim() === "";
                const isBelowMin = !isEmpty && parsedVal < activeLimits.minBet;
                const isExceedingMax = !isEmpty && parsedVal > activeLimits.maxBet;
                const isExceedingBalance = !isEmpty && parsedVal > activeBalance;
                const isErrorState = isBelowMin || isExceedingMax || isExceedingBalance;

                return (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.98 }}
                    className="p-3.5 rounded-2xl bg-[#080C16] border border-amber-500/45 space-y-3.5 shadow-2xl backdrop-blur-xl ring-1 ring-amber-500/30"
                  >
                    {/* Simplified Header */}
                    <div className="flex items-center justify-between text-[11px] font-bold">
                      <span className="text-neutral-200 flex items-center gap-1.5">
                        <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400" />
                        <span>কাস্টম বাজি (Custom Bet Input)</span>
                      </span>
                      <span className="text-amber-400 font-mono text-[10px] sm:text-[11px]">
                        Limits: {formatAmt(activeLimits.minBet)} - {formatAmt(activeLimits.maxBet)}
                      </span>
                    </div>

                    {/* Highly Refined Minimalist Tactile Input Bar */}
                    <div className="flex items-center gap-2">
                      {/* Decrement Button */}
                      <button
                        type="button"
                        onClick={() => {
                          const step = selectedTableSlug === "express" ? 5 : selectedTableSlug === "classic" ? 50 : 500;
                          const cur = Number(customAmountInput) || activeLimits.minBet;
                          const nextVal = Math.max(activeLimits.minBet, cur - step);
                          setCustomAmountInput(String(nextVal));
                          setSelectedAmount(nextVal);
                          soundManager.playChip(0.9);
                        }}
                        className="px-3 py-2.5 rounded-xl bg-neutral-900 border border-neutral-800 hover:border-amber-500/40 text-neutral-400 hover:text-white text-xs font-mono font-black active:scale-95 transition-all cursor-pointer shrink-0"
                        title="Decrease bet value"
                      >
                        -{selectedTableSlug === "express" ? 5 : selectedTableSlug === "classic" ? 50 : 500}
                      </button>

                      {/* Native-friendly Input Center with nested micro-controls */}
                      <div className="relative flex-1 flex items-center">
                        <span className="absolute left-3 text-amber-400 font-mono font-black text-xs select-none">
                          {activeCurrency.symbol}
                        </span>

                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={customAmountInput}
                          onChange={handleCustomInputChange}
                          placeholder="বাজির পরিমাণ লিখুন"
                          className={`w-full bg-neutral-950 rounded-xl pl-8 pr-28 py-2.5 text-xs sm:text-sm text-white font-mono font-black placeholder:text-neutral-600 transition-all focus:outline-none shadow-inner ${
                            isErrorState
                              ? "border-2 border-rose-500 ring-2 ring-rose-500/30 text-rose-200 bg-rose-950/20"
                              : "border border-neutral-700/80 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20"
                          }`}
                          autoFocus
                        />

                        {/* Nest modifier pills inside input field */}
                        <div className="absolute right-1.5 flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              const halfVal = Math.max(activeLimits.minBet, Math.floor(selectedAmount / 2));
                              setCustomAmountInput(String(halfVal));
                              setSelectedAmount(halfVal);
                              soundManager.playChip(1.0);
                            }}
                            className="px-1.5 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-[9px] font-mono font-bold text-neutral-300 border border-neutral-800 active:scale-95 transition-all cursor-pointer"
                            title="Half Amount"
                          >
                            1/2
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const doubleVal = Math.min(activeLimits.maxBet, Math.max(activeLimits.minBet, selectedAmount * 2));
                              setCustomAmountInput(String(doubleVal));
                              setSelectedAmount(doubleVal);
                              soundManager.playChip(1.1);
                            }}
                            className="px-1.5 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-[9px] font-mono font-bold text-amber-400 border border-neutral-800 active:scale-95 transition-all cursor-pointer"
                            title="Double Amount"
                          >
                            2X
                          </button>
                        </div>
                      </div>

                      {/* Increment Button */}
                      <button
                        type="button"
                        onClick={() => {
                          const step = selectedTableSlug === "express" ? 5 : selectedTableSlug === "classic" ? 50 : 500;
                          const cur = Number(customAmountInput) || 0;
                          const nextVal = Math.min(activeLimits.maxBet, cur + step);
                          setCustomAmountInput(String(nextVal));
                          setSelectedAmount(nextVal);
                          soundManager.playChip(1.2);
                        }}
                        className="px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 hover:border-amber-400 text-amber-300 hover:text-white text-xs font-mono font-black active:scale-95 transition-all cursor-pointer shrink-0"
                        title="Increase bet value"
                      >
                        +{selectedTableSlug === "express" ? 5 : selectedTableSlug === "classic" ? 50 : 500}
                      </button>

                      {/* MAX Button */}
                      <button
                        type="button"
                        onClick={() => {
                          const maxVal = Math.min(activeLimits.maxBet, activeBalance);
                          setCustomAmountInput(String(maxVal));
                          setSelectedAmount(maxVal);
                          soundManager.playChip(1.3);
                        }}
                        className="px-3 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:brightness-110 text-neutral-950 text-xs font-mono font-black shadow-md active:scale-95 transition-all cursor-pointer shrink-0"
                        title="Set Maximum Allowed Bet"
                      >
                        MAX
                      </button>
                    </div>

                    {/* Status & Validation Message Section */}
                    <div className="space-y-2 pt-1 border-t border-neutral-800/80">
                      <div className="text-[11px] font-mono flex items-center justify-between">
                        {isBelowMin ? (
                          <span className="text-rose-400 font-bold flex items-center gap-1">
                            ⚠️ Min bet is {formatAmt(activeLimits.minBet)}
                          </span>
                        ) : isExceedingMax ? (
                          <span className="text-rose-400 font-bold flex items-center gap-1">
                            ⚠️ Max limit is {formatAmt(activeLimits.maxBet)}
                          </span>
                        ) : isExceedingBalance ? (
                          <span className="text-rose-400 font-bold flex items-center gap-1">
                            ⚠️ Exceeds balance ({formatAmt(activeBalance)})
                          </span>
                        ) : !isEmpty && parsedVal > 0 ? (
                          <span className="text-emerald-400 font-bold flex items-center gap-1">
                            ✓ Potential Payout: {formatAmt(Math.floor(parsedVal * 1.9))}
                          </span>
                        ) : (
                          <span className="text-neutral-400 font-medium">
                            কিবোর্ড থেকে পরিমাণ লিখুন অথবা - / + বাটন ব্যবহার করুন
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={() => setShowCustomInput(false)}
                          className="text-[10px] text-neutral-400 hover:text-white underline font-mono cursor-pointer"
                        >
                          Close Panel ✕
                        </button>
                      </div>

                      {/* Direct 1-Tap Bet Buttons inside Drawer */}
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (!isErrorState && parsedVal >= activeLimits.minBet) {
                              setSelectedSide("DRAGON");
                              executeDirectBet("DRAGON", parsedVal);
                              setShowCustomInput(false);
                            }
                          }}
                          disabled={isErrorState || isEmpty || parsedVal < activeLimits.minBet || !isBettingOpen}
                          className={`py-2.5 px-3 rounded-xl font-black text-xs uppercase tracking-wider transition-all shadow-md active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer ${
                            isErrorState || isEmpty || parsedVal < activeLimits.minBet || !isBettingOpen
                              ? "bg-neutral-800 text-neutral-500 border border-neutral-700 cursor-not-allowed"
                              : "bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white border border-blue-400/50 shadow-blue-500/20"
                          }`}
                        >
                          <span>🐲 BET DRAGON ({formatAmt(parsedVal || 0)})</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            if (!isErrorState && parsedVal >= activeLimits.minBet) {
                              setSelectedSide("TIGER");
                              executeDirectBet("TIGER", parsedVal);
                              setShowCustomInput(false);
                            }
                          }}
                          disabled={isErrorState || isEmpty || parsedVal < activeLimits.minBet || !isBettingOpen}
                          className={`py-2.5 px-3 rounded-xl font-black text-xs uppercase tracking-wider transition-all shadow-md active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer ${
                            isErrorState || isEmpty || parsedVal < activeLimits.minBet || !isBettingOpen
                              ? "bg-neutral-800 text-neutral-500 border border-neutral-700 cursor-not-allowed"
                              : "bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white border border-red-400/50 shadow-red-500/20"
                          }`}
                        >
                          <span>🐯 BET TIGER ({formatAmt(parsedVal || 0)})</span>
                        </button>
                      </div>
                    </div>
                  </motion.div>
                );
              })()}
            </div>

            {/* Step 3: Action & Place Bet Button */}
            <div className="pt-2 border-t border-neutral-800/80 space-y-2">
              {/* PRIMARY ACTION BUTTON (Explicit Action Label) */}
              <motion.button
                whileHover={{ scale: canPlaceBet ? 1.015 : 1 }}
                whileTap={{ scale: canPlaceBet ? 0.985 : 1 }}
                onClick={() => {
                  if (selectedSide && isValidAmount) {
                    executeDirectBet(selectedSide, selectedAmount);
                  }
                }}
                disabled={!canPlaceBet}
                className={`w-full min-h-[52px] sm:min-h-[56px] py-3 px-4 rounded-xl font-black text-sm sm:text-base shadow-xl transition-all flex flex-col items-center justify-center ${
                  canPlaceBet
                    ? selectedSide === "DRAGON"
                      ? "bg-gradient-to-r from-blue-500 via-blue-600 to-blue-500 text-white shadow-blue-500/40 ring-2 ring-blue-400 animate-pulse"
                      : "bg-gradient-to-r from-red-500 via-red-600 to-red-500 text-white shadow-red-500/40 ring-2 ring-red-400 animate-pulse"
                    : "bg-neutral-900 text-neutral-500 border border-neutral-800 cursor-not-allowed"
                }`}
              >
                <span>
                  {!selectedSide
                    ? "CHOOSE DRAGON OR TIGER TO BET"
                    : !isBettingOpen
                    ? "BETTING CLOSED · PLEASE WAIT"
                    : !hasSufficientBalance
                    ? "INSUFFICIENT BALANCE"
                    : !isValidAmount
                    ? `ENTER ${formatAmt(activeLimits.minBet)} - ${formatAmt(activeLimits.maxBet)}`
                    : `PLACE ${formatAmt(selectedAmount)} ON ${selectedSide}`}
                </span>
                {selectedSide && isValidAmount && hasSufficientBalance && (
                  <span className="text-[10px] font-mono font-normal text-white/90">
                    Return: {formatAmt(Math.floor(selectedAmount * 1.9))} · Available: {formatAmt(activeBalance)}
                  </span>
                )}
              </motion.button>

              {/* Auxiliary Safe Bet Controls (Repeat, 2x Double) */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleRepeatBet}
                  disabled={!lastPlacedBet || !isBettingOpen}
                  className="py-2 px-3 rounded-xl bg-neutral-900 hover:bg-neutral-800 disabled:opacity-40 text-neutral-300 border border-neutral-800 text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                  <span>
                    {lastPlacedBet ? `Repeat (${formatAmt(lastPlacedBet.amount)} ${lastPlacedBet.side})` : "Repeat Last"}
                  </span>
                </button>

                <button
                  onClick={handleDoubleBet}
                  disabled={selectedAmount * 2 > activeLimits.maxBet || activeBalance < selectedAmount * 2 || !isBettingOpen}
                  className="py-2 px-3 rounded-xl bg-neutral-900 hover:bg-neutral-800 disabled:opacity-40 text-neutral-300 border border-neutral-800 text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <Zap className="w-3.5 h-3.5 text-yellow-400" />
                  <span>2x Double ({formatAmt(selectedAmount * 2)})</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Secondary Drawer / Sidebar (1 col): Live Action Feed, Chat, Guide, Trend */}
        <div className="space-y-3">


          {/* Sidebar Tab Selector */}
          <div className="flex items-center gap-1 bg-neutral-950 p-1 rounded-xl border border-neutral-800 text-xs">
            <button
              onClick={() => setSidebarTab("liveAction")}
              className={`flex-1 py-1.5 rounded-lg font-bold transition-all ${
                sidebarTab === "liveAction" ? "bg-amber-500 text-neutral-950" : "text-neutral-400 hover:text-white"
              }`}
            >
              Action
            </button>
            <button
              onClick={() => setSidebarTab("chat")}
              className={`flex-1 py-1.5 rounded-lg font-bold transition-all ${
                sidebarTab === "chat" ? "bg-amber-500 text-neutral-950" : "text-neutral-400 hover:text-white"
              }`}
            >
              Chat
            </button>
            <button
              onClick={() => setSidebarTab("roadmap")}
              className={`flex-1 py-1.5 rounded-lg font-bold transition-all ${
                sidebarTab === "roadmap" ? "bg-amber-500 text-neutral-950" : "text-neutral-400 hover:text-white"
              }`}
            >
              Roadmap
            </button>
          </div>

          {/* Sidebar Tab Content */}
          <AnimatePresence mode="wait">
            {sidebarTab === "liveAction" && (
              <motion.div
                key="liveAction"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
              >
                <LiveAction
                  currentRoundBets={currentRoundBets}
                  currentUser={user}
                  roundNumber={currentRound?.roundNumber}
                  onFollowBet={handleFollowBet}
                />
              </motion.div>
            )}

            {sidebarTab === "chat" && (
              <motion.div
                key="chat"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
              >
                <LiveChat username={user.username} />
              </motion.div>
            )}

            {sidebarTab === "roadmap" && (
              <motion.div
                key="roadmap"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
                className="bg-neutral-950 border border-neutral-800 rounded-2xl p-4 space-y-3 shadow-xl"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-bold text-white uppercase tracking-wider">Shoe Trend Ticker</span>
                  </div>
                  <button onClick={onOpenRoadmap} className="text-[10px] text-amber-400 hover:underline font-semibold">
                    Full Roadmap
                  </button>
                </div>

                <div className="grid grid-cols-5 gap-1.5">
                  {roadmap.slice(0, 25).map((r, i) => (
                    <div
                      key={i}
                      className={`h-8 rounded-lg flex items-center justify-center text-[10px] font-black border ${
                        r.result === "DRAGON"
                          ? "bg-blue-600/30 text-blue-400 border-blue-500/40"
                          : r.result === "TIGER"
                          ? "bg-red-600/30 text-red-400 border-red-500/40"
                          : "bg-emerald-600/30 text-emerald-400 border-emerald-500/40"
                      }`}
                    >
                      {r.result.charAt(0)}
                    </div>
                  ))}
                </div>

                {/* Table Limits Summary in Sidebar */}
                <div className="pt-2 border-t border-neutral-800 space-y-1.5 text-xs">
                  <div className="text-[10px] text-neutral-500 uppercase font-semibold">Table Parameters</div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Min Bet:</span>
                    <span className="text-white font-bold">{formatAmt(activeLimits.minBet)}</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Max Bet:</span>
                    <span className="text-white font-bold">{formatAmt(activeLimits.maxBet)}</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Speed:</span>
                    <span className="text-amber-400 font-bold">{activeLimits.speedLabel}</span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Live Bet Transparency & Real-Time History Feed */}
      <LiveBetFeed
        currentRoundBets={currentRoundBets}
        recentSettledBets={recentSettledBets}
        currentUser={user}
        roundNumber={currentRound?.roundNumber}
      />

      {/* Auto Bet Setup Modal */}
      <AnimatePresence>
        {showAutoBetModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="bg-[#0A0E18] border border-cyan-500/40 rounded-3xl p-4 sm:p-5 max-w-md w-full max-h-[85vh] sm:max-h-[90vh] overflow-y-auto space-y-4 shadow-2xl ring-1 ring-cyan-500/20 my-auto"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                    <Sparkles className="w-5 h-5 animate-spin" style={{ animationDuration: '4s' }} />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-white flex items-center gap-2">
                      <span>🤖 Auto Bet Engine</span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono">
                        অটো বাজি
                      </span>
                    </h3>
                    <p className="text-[11px] text-neutral-400">Automate consecutive bets hands-free</p>
                  </div>
                </div>

                <button
                  onClick={() => setShowAutoBetModal(false)}
                  className="p-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* 1. Strategy Selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-neutral-300 uppercase tracking-wider block">
                  1. Betting Strategy (কৌশল নির্বাচন):
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-[11px]">
                  {[
                    { id: "FLAT", name: "FLAT BET", desc: "Same stake every round" },
                    { id: "MARTINGALE", name: "MARTINGALE", desc: "2X stake on Loss (রিকাভারি)" },
                    { id: "ANTI_MARTINGALE", name: "ANTI-MARTINGALE", desc: "2X stake on Win (জয়ের ধারা)" },
                    { id: "ALTERNATE", name: "ALTERNATE", desc: "Switch Dragon ↔ Tiger" },
                    { id: "STREAK_CHASER", name: "STREAK CHASER", desc: "Follow winner side" },
                  ].map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => setAutoBetConfig((p) => ({ ...p, strategy: st.id as AutoBetStrategy }))}
                      className={`p-2 rounded-xl text-left border transition-all cursor-pointer flex flex-col justify-between ${
                        autoBetConfig.strategy === st.id
                          ? "bg-cyan-950/80 border-cyan-400 text-white ring-1 ring-cyan-400/50 shadow-md"
                          : "bg-neutral-900/90 text-neutral-400 border-neutral-800 hover:border-neutral-700 hover:text-neutral-200"
                      }`}
                    >
                      <span className="font-extrabold text-[11px] text-cyan-300">{st.name}</span>
                      <span className="text-[9px] text-neutral-400 leading-tight mt-0.5">{st.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 2. Target Side */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-neutral-300 uppercase tracking-wider block">
                  2. Starting Side (শুরুর পক্ষ):
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAutoBetConfig((p) => ({ ...p, side: "DRAGON" }))}
                    className={`py-2 px-3 rounded-xl font-black text-xs flex items-center justify-center gap-2 border transition-all cursor-pointer ${
                      autoBetConfig.side === "DRAGON"
                        ? "bg-blue-600 text-white border-blue-400 ring-2 ring-blue-400/60 shadow-lg shadow-blue-500/30"
                        : "bg-neutral-900 text-blue-300 border-neutral-800 hover:border-blue-500/50"
                    }`}
                  >
                    <span>🐉 DRAGON</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAutoBetConfig((p) => ({ ...p, side: "TIGER" }))}
                    className={`py-2 px-3 rounded-xl font-black text-xs flex items-center justify-center gap-2 border transition-all cursor-pointer ${
                      autoBetConfig.side === "TIGER"
                        ? "bg-red-600 text-white border-red-400 ring-2 ring-red-400/60 shadow-lg shadow-red-500/30"
                        : "bg-neutral-900 text-red-300 border-neutral-800 hover:border-red-500/50"
                    }`}
                  >
                    <span>🐯 TIGER</span>
                  </button>
                </div>
              </div>

              {/* 3. Base Stake Amount */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-bold text-neutral-300 uppercase tracking-wider">
                  <span>3. Base Stake per Round:</span>
                  <span className="text-amber-400 font-mono font-bold">{formatAmt(autoBetConfig.baseAmount)}</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {activeLimits.chips.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setAutoBetConfig((p) => ({ ...p, baseAmount: c, currentStake: c }))}
                      className={`py-1.5 rounded-xl font-mono font-black text-xs border transition-all cursor-pointer ${
                        autoBetConfig.baseAmount === c
                          ? "bg-amber-400 text-neutral-950 border-amber-300 shadow-md font-black"
                          : "bg-neutral-900 text-neutral-300 border-neutral-800 hover:border-amber-500/40"
                      }`}
                    >
                      {formatAmt(c, true)}
                    </button>
                  ))}
                </div>
              </div>

              {/* 4. Number of Rounds */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-neutral-300 uppercase tracking-wider block">
                  4. Total Rounds (মোট রাউন্ড):
                </label>
                <div className="grid grid-cols-6 gap-1 font-mono font-black text-xs">
                  {[5, 10, 20, 50, 100, 9999].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setAutoBetConfig((p) => ({ ...p, totalRounds: r, roundsRemaining: r }))}
                      className={`py-1.5 rounded-xl border transition-all cursor-pointer ${
                        autoBetConfig.totalRounds === r
                          ? "bg-cyan-500 text-neutral-950 border-cyan-300 font-extrabold shadow-md"
                          : "bg-neutral-900 text-neutral-300 border-neutral-800 hover:border-cyan-500/40"
                      }`}
                    >
                      {r === 9999 ? "∞" : r}
                    </button>
                  ))}
                </div>
              </div>

              {/* 5. Profit Target & Stop Loss Rules */}
              <div className="space-y-2 pt-2 border-t border-neutral-800 text-xs">
                <label className="font-bold text-neutral-300 uppercase tracking-wider block">
                  5. Profit & Risk Safeguards (প্রফিট ও রিস্ক কন্ট্রোল):
                </label>

                {/* Take Profit Preset Buttons */}
                <div className="space-y-1">
                  <span className="text-[10px] text-emerald-400 font-bold block">
                    Take Profit Target (প্রফিট টার্গেট পৌঁছালে বন্ধ):
                  </span>
                  <div className="grid grid-cols-4 gap-1 font-mono text-[11px]">
                    {[0, 100, 500, 1000].map((tp) => (
                      <button
                        key={tp}
                        type="button"
                        onClick={() => setAutoBetConfig((p) => ({ ...p, stopProfitTarget: tp }))}
                        className={`py-1 rounded-lg border transition-all cursor-pointer ${
                          autoBetConfig.stopProfitTarget === tp
                            ? "bg-emerald-500 text-neutral-950 font-black border-emerald-300 shadow-sm"
                            : "bg-neutral-900 text-emerald-300 border-neutral-800 hover:border-emerald-500/40"
                        }`}
                      >
                        {tp === 0 ? "Off" : `+${formatAmt(tp, true)}`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Stop Loss Preset Buttons */}
                <div className="space-y-1">
                  <span className="text-[10px] text-rose-400 font-bold block">
                    Stop Loss Limit (লসের সীমা স্পর্শ করলে বন্ধ):
                  </span>
                  <div className="grid grid-cols-4 gap-1 font-mono text-[11px]">
                    {[0, 100, 500, 1000].map((sl) => (
                      <button
                        key={sl}
                        type="button"
                        onClick={() => setAutoBetConfig((p) => ({ ...p, stopLossLimit: sl }))}
                        className={`py-1 rounded-lg border transition-all cursor-pointer ${
                          autoBetConfig.stopLossLimit === sl
                            ? "bg-rose-500 text-white font-black border-rose-300 shadow-sm"
                            : "bg-neutral-900 text-rose-300 border-neutral-800 hover:border-rose-500/40"
                        }`}
                      >
                        {sl === 0 ? "Off" : `-${formatAmt(sl, true)}`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Toggle Rules */}
                <div className="grid grid-cols-2 gap-1.5 pt-1">
                  <label className="flex items-center justify-between p-2 rounded-xl bg-neutral-900/90 border border-neutral-800 cursor-pointer">
                    <span className="text-neutral-300 text-[10px] font-semibold">Stop 1st Win</span>
                    <input
                      type="checkbox"
                      checked={autoBetConfig.stopOnWin}
                      onChange={(e) => setAutoBetConfig((p) => ({ ...p, stopOnWin: e.target.checked }))}
                      className="w-3.5 h-3.5 rounded border-neutral-700 text-cyan-500 focus:ring-cyan-400"
                    />
                  </label>

                  <label className="flex items-center justify-between p-2 rounded-xl bg-neutral-900/90 border border-neutral-800 cursor-pointer">
                    <span className="text-neutral-300 text-[10px] font-semibold">Stop 1st Loss</span>
                    <input
                      type="checkbox"
                      checked={autoBetConfig.stopOnLoss}
                      onChange={(e) => setAutoBetConfig((p) => ({ ...p, stopOnLoss: e.target.checked }))}
                      className="w-3.5 h-3.5 rounded border-neutral-700 text-cyan-500 focus:ring-cyan-400"
                    />
                  </label>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowAutoBetModal(false)}
                  className="flex-1 py-2.5 rounded-2xl bg-neutral-900 hover:bg-neutral-800 text-neutral-400 font-bold text-xs uppercase cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playButtonClick();
                    setAutoBetConfig((p) => ({
                      ...p,
                      isActive: true,
                      roundsRemaining: p.totalRounds,
                      roundsCompleted: 0,
                      totalWagered: 0,
                      totalProfitLoss: 0,
                      winsCount: 0,
                      lossesCount: 0,
                      currentStreak: 0,
                      currentStake: p.baseAmount,
                    }));
                    setShowAutoBetModal(false);
                  }}
                  className="flex-1 py-2.5 rounded-2xl bg-gradient-to-r from-cyan-500 via-cyan-400 to-cyan-500 hover:brightness-110 text-neutral-950 font-black text-xs uppercase tracking-wider shadow-lg shadow-cyan-500/20 active:scale-95 transition-all cursor-pointer"
                >
                  🚀 LAUNCH ENGINE
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
