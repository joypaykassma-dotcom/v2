import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import crypto from "crypto";
import { TableRound, TableConfig, PlayingCard, RoadmapItem, UserWallet, P2PRoom, UserStats, TablePerformance, SidePerformance, LiveBetRecord, SiteLiquidityData, UserBalanceRecord, UserBetHistoryItem, UserBetHistoryResponse, UserCosmetics, PlayerReport, CapacityTrendPoint } from "./src/types";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

// Redirect clean /admin to hash routing /#/admin to avoid server-side 404 (Cannot GET /admin)
app.get("/admin", (req, res) => {
  res.redirect("/#/admin");
});

const PORT = 3000;

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

// ============================================================================
// PROVABLY FAIR SYSTEM (HMAC-SHA512 + MODULO BIAS PREVENTION)
// ============================================================================
function generateServerSeed(): string {
  return crypto.randomBytes(32).toString("hex");
}

function hashServerSeed(seed: string): string {
  return crypto.createHash("sha256").update(seed).digest("hex");
}

function extractCardFromHmac(hmacHex: string, startChunk: number): { card: PlayingCard; nextChunk: number } {
  const displayValues = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const suits = ["♥", "♦", "♣", "♠"];

  for (let i = startChunk; i < 16; i++) {
    const chunk = hmacHex.substring(i * 8, (i + 1) * 8);
    const decimal = parseInt(chunk, 16);

    // Modulo bias rejection: 2^32 - (2^32 % 52) = 4294967292
    if (decimal >= 4294967292) {
      continue;
    }

    const cardIndex = decimal % 52;
    const value = (cardIndex % 13) + 1; // 1 to 13
    const suitIndex = Math.floor(cardIndex / 13); // 0 to 3
    const rank = displayValues[value - 1];
    const suit = suits[suitIndex];

    return {
      card: {
        rank,
        suit,
        value,
        display: `${rank}${suit}`,
      },
      nextChunk: i + 1,
    };
  }

  // Fallback if all 16 chunks exhausted
  return {
    card: { rank: "K", suit: "♠", value: 13, display: "K♠" },
    nextChunk: 16,
  };
}

function deriveCards(serverSeed: string, clientSeed: string, nonce: number): {
  dragonCard: PlayingCard;
  tigerCard: PlayingCard;
  result: "DRAGON" | "TIGER" | "TIE";
  hmac: string;
} {
  const hmacInput = `${clientSeed}:${nonce}`;
  const hmac = crypto.createHmac("sha512", serverSeed).update(hmacInput).digest("hex");

  const dragon = extractCardFromHmac(hmac, 0);
  const tiger = extractCardFromHmac(hmac, dragon.nextChunk);

  let result: "DRAGON" | "TIGER" | "TIE" = "TIE";
  if (dragon.card.value > tiger.card.value) {
    result = "DRAGON";
  } else if (tiger.card.value > dragon.card.value) {
    result = "TIGER";
  } else {
    result = "TIE";
  }

  return {
    dragonCard: dragon.card,
    tigerCard: tiger.card,
    result,
    hmac,
  };
}

// ============================================================================
// SYSTEM LEDGER & METRICS
// ============================================================================
interface SystemMetrics {
  todayMatchedVolume: number;
  todayCommission: number;
  todayTieRevenue: number;
  totalRoundsPlayed: number;
  activeDeposits: number;
  activeWithdrawals: number;
}

const metrics: SystemMetrics = {
  todayMatchedVolume: 0,
  todayCommission: 0,
  todayTieRevenue: 0,
  totalRoundsPlayed: 0,
  activeDeposits: 0,
  activeWithdrawals: 0,
};

// ============================================================================
// IN-MEMORY DATA STORAGE & USER CREDENTIALS
// ============================================================================
interface UserCredential {
  userId: string;
  username: string;
  passwordHash: string;
  salt: string;
}

const userCredentials: Record<string, UserCredential> = {};

const mockUsers: Record<string, UserWallet> = {};

const userBetHistories: Record<string, UserBetHistoryItem[]> = {};

function getOrSeedUserBetHistory(userId: string, _username = "Player"): UserBetHistoryItem[] {
  if (!userBetHistories[userId]) {
    userBetHistories[userId] = [];
  }
  return userBetHistories[userId];
}

// ----------------------------------------------------
// P2P REFERRAL & AFFILIATE REVSHARE ENGINE
// ----------------------------------------------------
interface ReferredFriend {
  userId: string;
  username: string;
  joinedAt: string;
  totalWagered: number;
  commissionEarned: number;
  activeStatus: "ACTIVE" | "INACTIVE";
}

interface UserReferralState {
  referralCode: string;
  referralLink: string;
  referredBy?: string;
  tier: "Bronze" | "Silver" | "Gold" | "Diamond";
  tierRevSharePct: number; // 20, 30, 40, 50
  totalReferredCount: number;
  totalTurnoverGenerated: number;
  totalCommissionEarned: number;
  unclaimedCommission: number;
  friends: ReferredFriend[];
}

const userReferralData: Record<string, UserReferralState> = {};
const referralCodeToUser: Record<string, string> = {}; // code -> userId
const userReferrerMap: Record<string, string> = {}; // refereeUserId -> referrerUserId

function getReferralTier(friendCount: number): { tier: "Bronze" | "Silver" | "Gold" | "Diamond"; pct: number } {
  if (friendCount >= 50) return { tier: "Diamond", pct: 50 };
  if (friendCount >= 16) return { tier: "Gold", pct: 40 };
  if (friendCount >= 6) return { tier: "Silver", pct: 30 };
  return { tier: "Bronze", pct: 20 };
}

function ensureReferralData(userId: string, username = "Player"): UserReferralState {
  if (userReferralData[userId]) {
    const data = userReferralData[userId];
    const { tier, pct } = getReferralTier(data.friends.length);
    data.tier = tier;
    data.tierRevSharePct = pct;
    data.totalReferredCount = data.friends.length;
    return data;
  }

  const cleanName = username.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 5) || "VIP";
  const suffix = userId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(-3) || "777";
  const refCode = `APEX_${cleanName}_${suffix}`;

  const state: UserReferralState = {
    referralCode: refCode,
    referralLink: `https://ais-dev-ex4rhtu7nip7irtnlwcmzm-93731786335.asia-east1.run.app?ref=${refCode}`,
    referredBy: undefined,
    tier: "Bronze",
    tierRevSharePct: 20,
    totalReferredCount: 0,
    totalTurnoverGenerated: 0,
    totalCommissionEarned: 0,
    unclaimedCommission: 0,
    friends: [],
  };

  userReferralData[userId] = state;
  referralCodeToUser[refCode] = userId;
  return state;
}

function ensureUserStats(user: UserWallet): UserStats {
  if (user.stats && user.stats.totalHandsPlayed === user.gamesPlayed) {
    return user.stats;
  }

  const handsPlayed = Math.max(user.gamesPlayed, 0);
  if (user.stats) {
    user.stats.totalHandsPlayed = handsPlayed;
    user.stats.winRate =
      handsPlayed > 0
        ? Number(((user.stats.handsWon / handsPlayed) * 100).toFixed(1))
        : 0;
    return user.stats;
  }

  user.stats = {
    totalHandsPlayed: 0,
    handsWon: 0,
    handsLost: 0,
    handsTied: 0,
    winRate: 0,
    biggestWin: 0,
    currentStreak: 0,
    bestStreak: 0,
    tableBreakdown: {
      express: {
        slug: "express",
        tableName: "Express Speed Arena",
        handsPlayed: 0,
        handsWon: 0,
        handsLost: 0,
        winRate: 0,
        totalWagered: 0,
        profit: 0,
      },
      classic: {
        slug: "classic",
        tableName: "Classic High Table",
        handsPlayed: 0,
        handsWon: 0,
        handsLost: 0,
        winRate: 0,
        totalWagered: 0,
        profit: 0,
      },
      vip: {
        slug: "vip",
        tableName: "VIP Diamond Lounge",
        handsPlayed: 0,
        handsWon: 0,
        handsLost: 0,
        winRate: 0,
        totalWagered: 0,
        profit: 0,
      },
    },
    sideBreakdown: {
      dragon: { hands: 0, wins: 0, winRate: 0 },
      tiger: { hands: 0, wins: 0, winRate: 0 },
      tie: { hands: 0, wins: 0, winRate: 0 },
    },
    favoriteTable: "Classic High Table",
    favoriteSide: "Dragon",
  };

  return user.stats;
}

function ensureUserCosmetics(user: UserWallet): UserCosmetics {
  if (!user.cosmetics) {
    user.cosmetics = {
      equippedFrame: "Newcomer",
      equippedCardBack: "Classic",
      equippedTableTheme: "Midnight",
      equippedTitle: "Rookie",
      eloRating: 1000,
      eloTier: "Bronze",
      unlockedFrames: ["Newcomer"],
      unlockedCardBacks: ["Classic"],
      unlockedThemes: ["Midnight"],
      unlockedTitles: ["Rookie"],
      unlockedBadges: [],
      loginStreakDays: 1,
      spectatorFameScore: 0,
    };
  }

  const c = user.cosmetics;
  const hands = user.gamesPlayed || 0;
  const wins = user.stats?.handsWon || 0;
  const elo = c.eloRating || 1000;

  // Evaluate ELO Tier
  if (elo >= 2500) c.eloTier = "Master";
  else if (elo >= 2100) c.eloTier = "Diamond";
  else if (elo >= 1800) c.eloTier = "Platinum";
  else if (elo >= 1500) c.eloTier = "Gold";
  else if (elo >= 1200) c.eloTier = "Silver";
  else c.eloTier = "Bronze";

  // Evaluate Avatar Frames Unlocks
  if (hands >= 10 && !c.unlockedFrames.includes("10 Hands")) c.unlockedFrames.push("10 Hands");
  if (hands >= 50 && !c.unlockedFrames.includes("50 Hands")) c.unlockedFrames.push("50 Hands");
  if (wins >= 100 && !c.unlockedFrames.includes("100 Wins")) c.unlockedFrames.push("100 Wins");
  if (c.eloTier === "Diamond" || c.eloTier === "Master") {
    if (!c.unlockedFrames.includes("Diamond")) c.unlockedFrames.push("Diamond");
  }

  // Evaluate Card Back Skins Unlocks
  if (hands >= 200 && !c.unlockedCardBacks.includes("Gold Dragon")) c.unlockedCardBacks.push("Gold Dragon");
  if (wins >= 50 && !c.unlockedCardBacks.includes("Fire Tiger")) c.unlockedCardBacks.push("Fire Tiger");
  if (["Gold", "Platinum", "Diamond", "Master"].includes(c.eloTier) && !c.unlockedCardBacks.includes("Neon")) c.unlockedCardBacks.push("Neon");
  if (["Platinum", "Diamond", "Master"].includes(c.eloTier) && !c.unlockedCardBacks.includes("Royal")) c.unlockedCardBacks.push("Royal");
  if (["Diamond", "Master"].includes(c.eloTier) && !c.unlockedCardBacks.includes("Galaxy")) c.unlockedCardBacks.push("Galaxy");
  if (c.eloTier === "Master" && !c.unlockedCardBacks.includes("Master")) c.unlockedCardBacks.push("Master");

  // Evaluate Table Themes Unlocks
  if (hands >= 100 && !c.unlockedThemes.includes("Casino Red")) c.unlockedThemes.push("Casino Red");
  if (["Silver", "Gold", "Platinum", "Diamond", "Master"].includes(c.eloTier) && !c.unlockedThemes.includes("Emerald")) c.unlockedThemes.push("Emerald");
  if (["Gold", "Platinum", "Diamond", "Master"].includes(c.eloTier) && !c.unlockedThemes.includes("Royal Purple")) c.unlockedThemes.push("Royal Purple");
  if (["Diamond", "Master"].includes(c.eloTier) && !c.unlockedThemes.includes("Championship")) c.unlockedThemes.push("Championship");

  // Evaluate Profile Titles Unlocks
  if (hands >= 10 && !c.unlockedTitles.includes("Player")) c.unlockedTitles.push("Player");
  if (hands >= 25 && !c.unlockedTitles.includes("Competitor")) c.unlockedTitles.push("Competitor");
  if (hands >= 50 && !c.unlockedTitles.includes("Challenger")) c.unlockedTitles.push("Challenger");
  if (hands >= 100 && !c.unlockedTitles.includes("Veteran")) c.unlockedTitles.push("Veteran");
  if (hands >= 250 && !c.unlockedTitles.includes("Elite")) c.unlockedTitles.push("Elite");
  if (hands >= 500 && !c.unlockedTitles.includes("Legend")) c.unlockedTitles.push("Legend");
  if (hands >= 1000 && !c.unlockedTitles.includes("Master")) c.unlockedTitles.push("Master");

  // Evaluate Achievement Badges
  if (wins >= 1 && !c.unlockedBadges.includes("First Blood")) c.unlockedBadges.push("First Blood");
  if ((user.stats?.currentStreak || 0) >= 10 && !c.unlockedBadges.includes("Unstoppable")) c.unlockedBadges.push("Unstoppable");
  if (hands >= 500 && !c.unlockedBadges.includes("Marathon")) c.unlockedBadges.push("Marathon");

  return c;
}

function recordSettledBetOnUserStats(
  user: UserWallet,
  bet: LiveBetRecord,
  isTie: boolean,
  winningSide: "DRAGON" | "TIGER" | "TIE",
  tableSlug: "express" | "classic" | "vip",
  tableName: string,
  profitOrLoss: number,
  isWin: boolean
) {
  const stats = ensureUserStats(user);
  stats.totalHandsPlayed += 1;

  if (!stats.tableBreakdown[tableSlug]) {
    stats.tableBreakdown[tableSlug] = {
      slug: tableSlug,
      tableName,
      handsPlayed: 0,
      handsWon: 0,
      handsLost: 0,
      winRate: 0,
      totalWagered: 0,
      profit: 0,
    };
  }
  const tbl = stats.tableBreakdown[tableSlug];
  tbl.handsPlayed += 1;
  tbl.totalWagered += bet.amount;

  const sideKey = (bet.side.toLowerCase()) as "dragon" | "tiger" | "tie";
  if (stats.sideBreakdown[sideKey]) {
    stats.sideBreakdown[sideKey].hands += 1;
  }

  if (isWin) {
    stats.handsWon += 1;
    tbl.handsWon += 1;
    tbl.profit += profitOrLoss;
    if (stats.sideBreakdown[sideKey]) stats.sideBreakdown[sideKey].wins += 1;
    stats.currentStreak = stats.currentStreak >= 0 ? stats.currentStreak + 1 : 1;
    if (stats.currentStreak > stats.bestStreak) stats.bestStreak = stats.currentStreak;
    if (profitOrLoss > stats.biggestWin) stats.biggestWin = profitOrLoss;
  } else if (isTie && bet.side !== "TIE") {
    stats.handsTied += 1;
    tbl.profit -= profitOrLoss;
    // Tie with 50% refund protects/preserves player's active win streak!
  } else {
    stats.handsLost += 1;
    tbl.handsLost += 1;
    tbl.profit -= bet.amount;
    stats.currentStreak = 0;
  }

  stats.winRate = Number(((stats.handsWon / Math.max(stats.totalHandsPlayed, 1)) * 100).toFixed(1));
  tbl.winRate = Number(((tbl.handsWon / Math.max(tbl.handsPlayed, 1)) * 100).toFixed(1));
  if (stats.sideBreakdown[sideKey] && stats.sideBreakdown[sideKey].hands > 0) {
    stats.sideBreakdown[sideKey].winRate = Number(
      ((stats.sideBreakdown[sideKey].wins / stats.sideBreakdown[sideKey].hands) * 100).toFixed(1)
    );
  }
}

const activeRooms: P2PRoom[] = [];

// ============================================================================
// STATEFUL MULTIPLAYER 1v1 DUEL GAME ENGINE
// ============================================================================
interface ActiveDuel {
  id: string; // roomId
  status: "ROLE_COIN_FLIP" | "PEEK_CARDS" | "BETTING" | "SHOWDOWN" | "SETTLED";
  tier: "Express" | "Classic" | "VIP";
  creatorId: string;
  creatorName: string;
  creatorRole: "DRAGON" | "TIGER";
  creatorCard: PlayingCard;
  creatorBet: number;
  creatorAction?: string;
  creatorPeeked: boolean;
  creatorElo: number;
  
  acceptorId: string;
  acceptorName: string;
  acceptorRole: "DRAGON" | "TIGER";
  acceptorCard: PlayingCard;
  acceptorBet: number;
  acceptorAction?: string;
  acceptorPeeked: boolean;
  acceptorElo: number;
  
  currentPot: number;
  currentRaise: number;
  bettingRound: number; // 1, 2, 3
  turnUser: "DRAGON" | "TIGER";
  secondsRemaining: number;
  raisesCount: number; // max 3
  winnerRole?: "DRAGON" | "TIGER" | "TIE";
  foldWinnerRole?: "DRAGON" | "TIGER";
  netProfitCreator?: number;
  netProfitAcceptor?: number;
  lastUpdated: number;
}

const activeDuels: Record<string, ActiveDuel> = {};
const p2pRoomsHistory: P2PRoom[] = [];

// ============================================================================
// MULTI-TABLE GAME ENGINE (EXPRESS, CLASSIC, VIP)
// ============================================================================
interface TableRuntime {
  config: TableConfig;
  currentRound: TableRound;
  secretServerSeed: string;
  roadmap: RoadmapItem[];
  playerBets: LiveBetRecord[];
  recentSettledBets: LiveBetRecord[];
}

const tableConfigs: Record<string, TableConfig> = {
  express: {
    id: "tbl_express",
    slug: "express",
    name: "Express Speed Arena",
    type: "Express",
    minBet: 0.00001,
    maxBet: 1000,
    bettingDuration: 15,
    playersOnline: 0,
    commissionRate: 0.05,
  },
  classic: {
    id: "tbl_classic",
    slug: "classic",
    name: "Classic High Table",
    type: "Classic",
    minBet: 0.00001,
    maxBet: 10000,
    bettingDuration: 30,
    playersOnline: 0,
    commissionRate: 0.05,
  },
  vip: {
    id: "tbl_vip",
    slug: "vip",
    name: "VIP Diamond Lounge",
    type: "VIP",
    minBet: 0.00001,
    maxBet: 100000,
    bettingDuration: 30,
    playersOnline: 0,
    commissionRate: 0.05,
  },
};

function generateInitialRoadmap(count = 35): RoadmapItem[] {
  const items: RoadmapItem[] = [];
  const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const suits = ["♥", "♦", "♣", "♠"];

  for (let i = 1; i <= count; i++) {
    const dVal = Math.floor(Math.random() * 13) + 1;
    const tVal = Math.floor(Math.random() * 13) + 1;
    let result: "DRAGON" | "TIGER" | "TIE" = "TIE";
    if (dVal > tVal) result = "DRAGON";
    else if (tVal > dVal) result = "TIGER";

    items.push({
      roundNumber: 1000 + i,
      result,
      dragonCard: { rank: ranks[dVal - 1], suit: suits[Math.floor(Math.random() * 4)], value: dVal, display: `${ranks[dVal - 1]}${suits[0]}` },
      tigerCard: { rank: ranks[tVal - 1], suit: suits[Math.floor(Math.random() * 4)], value: tVal, display: `${ranks[tVal - 1]}${suits[1]}` },
      timestamp: new Date(Date.now() - (count - i) * 35000).toISOString(),
    });
  }
  return items;
}

const tables: Record<string, TableRuntime> = {};

Object.entries(tableConfigs).forEach(([slug, cfg]) => {
  const serverSeed = generateServerSeed();
  const seedHash = hashServerSeed(serverSeed);
  const clientSeed = "dragon_tiger_btc_block_894102";

  tables[slug] = {
    config: cfg,
    secretServerSeed: serverSeed,
    roadmap: generateInitialRoadmap(45),
    playerBets: [],
    recentSettledBets: [],
    currentRound: {
      roundId: `rnd_${slug}_1001`,
      roundNumber: 1001,
      tableSlug: slug as "express" | "classic" | "vip",
      tableName: cfg.name,
      status: "BETTING",
      secondsRemaining: cfg.bettingDuration,
      totalDuration: cfg.bettingDuration,
      dragonPool: 0,
      tigerPool: 0,
      matchedAmount: 0,
      dragonPlayers: 0,
      tigerPlayers: 0,
      serverSeedHash: seedHash,
      clientSeed: clientSeed,
      nonce: 1001,
    },
  };
});

function broadcast(data: Record<string, unknown>) {
  const message = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Table Tick Engine (1-second heartbeat)
setInterval(() => {
  Object.entries(tables).forEach(([slug, tbl]) => {
    const round = tbl.currentRound;

    if (round.status === "BETTING") {
      if (round.secondsRemaining > 0) {
        round.secondsRemaining -= 1;

        broadcast({
          type: "TIMER_TICK",
          tableSlug: slug,
          secondsRemaining: round.secondsRemaining,
          dragonPool: round.dragonPool,
          tigerPool: round.tigerPool,
          matchedAmount: round.matchedAmount,
        });
      } else {
        // Transition: BETTING -> MATCHING -> DEALING
        round.status = "MATCHING";
        const dragonTotal = round.dragonPool;
        const tigerTotal = round.tigerPool;
        const matchedTotal = Math.min(dragonTotal, tigerTotal);
        round.matchedAmount = matchedTotal;

        // P2P Match Ratios for Dragon & Tiger pools
        const dragonMatchRatio = dragonTotal > 0 ? Math.min(1, matchedTotal / dragonTotal) : 0;
        const tigerMatchRatio = tigerTotal > 0 ? Math.min(1, matchedTotal / tigerTotal) : 0;

        // Perform instant refund for any unmatched stakes
        tbl.playerBets.forEach((bet) => {
          let matchRatio = 1;
          if (bet.side === "DRAGON") matchRatio = dragonMatchRatio;
          else if (bet.side === "TIGER") matchRatio = tigerMatchRatio;
          else matchRatio = 1;

          const matchedPart = Math.floor(bet.amount * matchRatio);
          const unmatchedPart = bet.amount - matchedPart;

          (bet as any).matchedAmount = matchedPart;
          (bet as any).unmatchedAmount = unmatchedPart;

          if (unmatchedPart > 0) {
            bet.returnedAmount = (bet.returnedAmount || 0) + unmatchedPart;
            bet.tkReturnStatus = "RETURNED_REFUND";

            // Sync with detailed user bet history
            const userHist = userBetHistories[bet.userId];
            if (userHist) {
              const histItem = userHist.find((h) => h.id === bet.id);
              if (histItem) {
                histItem.matchedAmount = matchedPart;
                histItem.unmatchedAmount = unmatchedPart;
                histItem.returnedAmount = (histItem.returnedAmount || 0) + unmatchedPart;
                histItem.tkReturnStatus = "RETURNED_REFUND";
              }
            }

            const user = mockUsers[bet.userId];
            if (user) {
              if (bet.balanceType === "real") {
                user.balance += unmatchedPart;
              } else {
                user.demoBalance += unmatchedPart;
              }
              user.transactions.unshift({
                id: `tx_unmatched_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                type: "refund",
                amount: unmatchedPart,
                timestamp: new Date().toISOString(),
                description: `P2P Unmatched Refund: ৳${unmatchedPart.toLocaleString()} returned to wallet (${tbl.config.name} Round #${round.roundNumber})`,
              });
            }
          }
        });

        broadcast({
          type: "ROUND_PHASE",
          tableSlug: slug,
          status: "MATCHING",
          matchedAmount: round.matchedAmount,
          dragonPool: round.dragonPool,
          tigerPool: round.tigerPool,
        });

        setTimeout(() => {
          round.status = "DEALING";
          const derived = deriveCards(tbl.secretServerSeed, round.clientSeed, round.nonce);
          round.dragonCard = derived.dragonCard;
          round.tigerCard = derived.tigerCard;
          round.result = derived.result;

          broadcast({
            type: "ROUND_DEALING",
            tableSlug: slug,
            dragonCard: round.dragonCard,
            tigerCard: round.tigerCard,
            result: round.result,
          });

          // Settling phase (after 3s card animation)
          setTimeout(() => {
            round.status = "SETTLING";
            round.serverSeed = tbl.secretServerSeed; // REVEAL SEED ONLY NOW

            // Financial settlement per mathematical proof
            const matchedM = round.matchedAmount;
            if (round.result === "TIE") {
              // 100% Tie Capture Rule: Matched pool is locked 100% as company profit (Loss for Dragon & Tiger bettors)
              round.tieRevenue = matchedM * 2;
              round.commission = 0;
              metrics.todayTieRevenue += round.tieRevenue;
            } else {
              round.commission = matchedM * 2 * 0.05; // 5% commission of 2M pool
              round.tieRevenue = 0;
              metrics.todayCommission += round.commission;
            }
            metrics.todayMatchedVolume += matchedM;
            metrics.totalRoundsPlayed += 1;

            // Settle all player bets transparently on the matched portion
            tbl.playerBets.forEach((bet) => {
              const matchedStake = (bet as any).matchedAmount !== undefined ? (bet as any).matchedAmount : bet.amount;
              const isTie = round.result === "TIE";

              if (matchedStake <= 0) {
                bet.status = "REFUNDED";
                bet.payout = 0;
                bet.tkReturnStatus = "RETURNED_REFUND";
                return;
              }

              if (isTie) {
                if (bet.side === "TIE") {
                  bet.status = "WON";
                  bet.payout = matchedStake * 8;
                  bet.tkReturnStatus = "RETURNED_WIN";
                  bet.returnedAmount = (bet.returnedAmount || 0) + bet.payout;
                } else {
                  // Tie (টাই) রুলস অনুযায়ী উভয় পক্ষের সমস্ত প্লেয়ারের টাকা বাজেয়াপ্ত (100% Loss)
                  bet.status = "LOST";
                  bet.payout = 0;
                  bet.tkReturnStatus = "NO_RETURN";
                  bet.returnedAmount = 0;
                }
              } else if (bet.side === round.result) {
                bet.status = "WON";
                bet.payout = Math.floor(matchedStake * 1.9);
                bet.tkReturnStatus = "RETURNED_WIN";
                bet.returnedAmount = (bet.returnedAmount || 0) + bet.payout;
              } else {
                bet.status = "LOST";
                bet.payout = 0;
                bet.tkReturnStatus = (bet.returnedAmount && bet.returnedAmount > 0) ? "RETURNED_REFUND" : "NO_RETURN";
              }

              // Sync with user's permanent bet history
              const userHist = userBetHistories[bet.userId];
              if (userHist) {
                const histItem = userHist.find((h) => h.id === bet.id);
                if (histItem) {
                  histItem.status = bet.status as any;
                  histItem.payout = bet.payout || 0;
                  histItem.returnedAmount = bet.returnedAmount || 0;
                  histItem.tkReturnStatus = bet.tkReturnStatus as any;
                  histItem.netPnL = (bet.returnedAmount || 0) - bet.amount;
                  histItem.dragonCard = round.dragonCard;
                  histItem.tigerCard = round.tigerCard;
                  histItem.result = round.result;
                  histItem.serverSeed = round.serverSeed;
                }
              }

              // Update user wallet and transactions if registered user
              const user = mockUsers[bet.userId];
              if (user && matchedStake > 0) {
                if (isTie) {
                  if (bet.side === "TIE") {
                    const profit = matchedStake * 7;
                    const totalCredited = matchedStake * 8;
                    if (bet.balanceType === "real") user.balance += totalCredited;
                    else user.demoBalance += totalCredited;
                    user.totalWon += profit;
                    recordSettledBetOnUserStats(user, bet, true, "TIE", slug as any, tbl.config.name, profit, true);
                    user.transactions.unshift({
                      id: `tx_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                      type: "win",
                      amount: totalCredited,
                      timestamp: new Date().toISOString(),
                      description: `Tie 8x Win on ${tbl.config.name} Round #${round.roundNumber}`,
                    });
                  } else {
                    // Dragon / Tiger 100% loss on Tie to company ledger
                    user.totalLost += matchedStake;
                    recordSettledBetOnUserStats(user, bet, true, "TIE", slug as any, tbl.config.name, matchedStake, false);
                    user.transactions.unshift({
                      id: `tx_tie_loss_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                      type: "loss",
                      amount: matchedStake,
                      timestamp: new Date().toISOString(),
                      description: `Tie 100% Bajeapto Loss: ৳${matchedStake.toLocaleString()} lost to Company Ledger on ${tbl.config.name} Round #${round.roundNumber}`,
                    });
                  }
                } else if (bet.side === round.result) {
                  const payout = Math.floor(matchedStake * 1.9);
                  const profit = Math.floor(matchedStake * 0.9);
                  if (bet.balanceType === "real") {
                    user.balance += payout;
                  } else {
                    user.demoBalance += payout;
                  }
                  user.totalWon += profit;
                  recordSettledBetOnUserStats(user, bet, false, round.result as any, slug as any, tbl.config.name, profit, true);
                  user.transactions.unshift({
                    id: `tx_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                    type: "win",
                    amount: payout,
                    timestamp: new Date().toISOString(),
                    description: `Won 1.9x on ${tbl.config.name} Round #${round.roundNumber}`,
                  });
                } else {
                  user.totalLost += matchedStake;
                  recordSettledBetOnUserStats(user, bet, false, round.result as any, slug as any, tbl.config.name, matchedStake, false);
                  user.transactions.unshift({
                    id: `tx_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                    type: "loss",
                    amount: matchedStake,
                    timestamp: new Date().toISOString(),
                    description: `Loss on ${tbl.config.name} Round #${round.roundNumber}`,
                  });
                }
              }

              // Referral Affiliate Social Tracking (Zero-Cost Prestige Model)
              if (matchedStake > 0) {
                const referrerId = userReferrerMap[bet.userId];
                if (referrerId && mockUsers[referrerId]) {
                  const referrerUser = mockUsers[referrerId];
                  const referrerData = ensureReferralData(referrerId, referrerUser?.username);
                  referrerData.totalTurnoverGenerated += matchedStake;

                  let friendEntry = referrerData.friends.find((f) => f.userId === bet.userId);
                  if (!friendEntry) {
                    friendEntry = {
                      userId: bet.userId,
                      username: bet.username,
                      joinedAt: new Date().toISOString(),
                      totalWagered: 0,
                      commissionEarned: 0,
                      activeStatus: "ACTIVE",
                    };
                    referrerData.friends.unshift(friendEntry);
                    referrerData.totalReferredCount = referrerData.friends.length;
                    const { tier, pct } = getReferralTier(referrerData.friends.length);
                    referrerData.tier = tier;
                    referrerData.tierRevSharePct = pct;
                  }
                  friendEntry.totalWagered += matchedStake;
                  friendEntry.activeStatus = "ACTIVE";

                  // Unlock zero-cost prestige titles and badges based on referrals
                  const refCosmetics = ensureUserCosmetics(referrerUser);
                  if (!refCosmetics.unlockedBadges.includes("Social Star")) {
                    refCosmetics.unlockedBadges.push("Social Star");
                  }
                  if (referrerData.friends.length >= 5 && !refCosmetics.unlockedTitles.includes("Ambassador")) {
                    refCosmetics.unlockedTitles.push("Ambassador");
                  }
                }
              }

              // Archive to transparent table history
              tbl.recentSettledBets.unshift({ ...bet });
            });

            tbl.recentSettledBets = tbl.recentSettledBets.slice(0, 60);

            // Add to roadmap
            if (round.result && round.dragonCard && round.tigerCard) {
              tbl.roadmap.unshift({
                roundNumber: round.roundNumber,
                result: round.result,
                dragonCard: round.dragonCard,
                tigerCard: round.tigerCard,
                timestamp: new Date().toISOString(),
              });
              if (tbl.roadmap.length > 80) tbl.roadmap.pop();
            }

            round.status = "COMPLETED";

            broadcast({
              type: "ROUND_RESULT",
              tableSlug: slug,
              round: round,
              roadmap: tbl.roadmap.slice(0, 40),
              settledBets: tbl.playerBets,
            });

            // Start next round after 4s
            setTimeout(() => {
              const nextServerSeed = generateServerSeed();
              const nextSeedHash = hashServerSeed(nextServerSeed);
              tbl.secretServerSeed = nextServerSeed;
              tbl.playerBets = [];

              tbl.currentRound = {
                roundId: `rnd_${slug}_${round.roundNumber + 1}`,
                roundNumber: round.roundNumber + 1,
                tableSlug: slug as "express" | "classic" | "vip",
                tableName: tbl.config.name,
                status: "BETTING",
                secondsRemaining: tbl.config.bettingDuration,
                totalDuration: tbl.config.bettingDuration,
                dragonPool: 0,
                tigerPool: 0,
                matchedAmount: 0,
                dragonPlayers: 0,
                tigerPlayers: 0,
                serverSeedHash: nextSeedHash,
                clientSeed: "dragon_tiger_btc_block_894102",
                nonce: round.nonce + 1,
              };

              broadcast({
                type: "NEW_ROUND",
                tableSlug: slug,
                round: tbl.currentRound,
              });
            }, 4000);
          }, 3000);
        }, 1500);
      }
    }
  });
}, 1000);

// ============================================================================
// STATEFUL MULTIPLAYER 1v1 DUEL ENGINE HELPER FUNCTIONS & TICK ENGINE
// ============================================================================
function settleDuelOnFold(duel: ActiveDuel, foldingUserId: string) {
  const isCreator = foldingUserId === duel.creatorId;
  const winnerUserId = isCreator ? duel.acceptorId : duel.creatorId;
  const winnerUser = mockUsers[winnerUserId];
  const loserUser = mockUsers[foldingUserId];
  
  const totalPot = duel.currentPot;
  const companyProfit = Math.round(totalPot * 0.05); // 5% rake
  const winnerPayout = totalPot - companyProfit;
  
  const winnerRole = isCreator ? duel.acceptorRole : duel.creatorRole;
  
  if (winnerUser) {
    winnerUser.balance += winnerPayout;
    winnerUser.totalWon += winnerPayout - (isCreator ? duel.acceptorBet : duel.creatorBet);
    winnerUser.gamesPlayed += 1;
    winnerUser.transactions.unshift({
      id: `tx_duel_win_${Date.now()}`,
      type: "deposit",
      amount: winnerPayout,
      timestamp: new Date().toISOString(),
      description: `1v1 Duel Win (Opponent Folded) on Round #${duel.id}! Payout: ৳${winnerPayout.toLocaleString()} (Pot: ৳${totalPot.toLocaleString()}, House 5%: ৳${companyProfit.toLocaleString()})`,
    });
    
    // Stats win streak
    const stats = ensureUserStats(winnerUser);
    stats.totalHandsPlayed += 1;
    stats.handsWon += 1;
    stats.currentStreak += 1;
    if (stats.currentStreak > stats.bestStreak) stats.bestStreak = stats.currentStreak;
  }
  
  if (loserUser) {
    loserUser.totalLost += isCreator ? duel.creatorBet : duel.acceptorBet;
    loserUser.gamesPlayed += 1;
    loserUser.transactions.unshift({
      id: `tx_duel_loss_${Date.now()}`,
      type: "withdraw",
      amount: isCreator ? duel.creatorBet : duel.acceptorBet,
      timestamp: new Date().toISOString(),
      description: `1v1 Duel Loss (Folded) on Round #${duel.id}. Lost Stake: ৳${(isCreator ? duel.creatorBet : duel.acceptorBet).toLocaleString()}`,
    });
    
    // Stats loss streak
    const stats = ensureUserStats(loserUser);
    stats.totalHandsPlayed += 1;
    stats.handsLost += 1;
    stats.currentStreak = 0;
  }
  
  // Metrics
  metrics.todayMatchedVolume += totalPot;
  metrics.todayCommission += companyProfit;
  metrics.totalRoundsPlayed += 1;
  
  // Public ledger
  recordGlobalTransaction({
    type: "commission",
    username: winnerUser?.username || "Player",
    userId: winnerUserId,
    recipientUsername: loserUser?.username || "Player",
    recipientUserId: foldingUserId,
    amount: companyProfit,
    method: "1v1 Duel fold company commission",
    status: "COMPLETED",
    description: `1v1 Duel Fold: @${winnerUser?.username} wins pot of ৳${totalPot.toLocaleString()} from @${loserUser?.username}`,
  });
  
  // Update room status
  const room = activeRooms.find(r => r.id === duel.id);
  if (room) {
    room.status = "completed";
    room.winner = winnerRole.toLowerCase() as any;
    room.dragonCard = duel.creatorRole === "DRAGON" ? duel.creatorCard : duel.acceptorCard;
    room.tigerCard = duel.creatorRole === "TIGER" ? duel.creatorCard : duel.acceptorCard;
  }
  
  const histRoom = p2pRoomsHistory.find(r => r.id === duel.id);
  if (histRoom) {
    histRoom.status = "completed";
    histRoom.winner = winnerRole.toLowerCase() as any;
    histRoom.acceptorId = duel.acceptorId;
    histRoom.acceptorName = duel.acceptorName;
    histRoom.dragonCard = duel.creatorRole === "DRAGON" ? duel.creatorCard : duel.acceptorCard;
    histRoom.tigerCard = duel.creatorRole === "TIGER" ? duel.creatorCard : duel.acceptorCard;
  }
  
  duel.status = "SETTLED";
  duel.winnerRole = winnerRole;
  duel.foldWinnerRole = winnerRole;
  duel.netProfitCreator = isCreator ? -duel.creatorBet : winnerPayout - duel.creatorBet;
  duel.netProfitAcceptor = !isCreator ? -duel.acceptorBet : winnerPayout - duel.acceptorBet;
  duel.lastUpdated = Date.now();
  
  // Clean up from active map after some time
  setTimeout(() => {
    delete activeDuels[duel.id];
  }, 45000);
}

function settleDuelOnShowdown(duel: ActiveDuel) {
  const dVal = duel.creatorRole === "DRAGON" ? duel.creatorCard.value : duel.acceptorCard.value;
  const tVal = duel.creatorRole === "TIGER" ? duel.creatorCard.value : duel.acceptorCard.value;
  
  let winnerRole: "DRAGON" | "TIGER" | "TIE" = "TIE";
  if (dVal > tVal) winnerRole = "DRAGON";
  else if (tVal > dVal) winnerRole = "TIGER";
  
  const creatorIsWinner = winnerRole === duel.creatorRole;
  const acceptorIsWinner = winnerRole === duel.acceptorRole;
  const isTie = winnerRole === "TIE";
  
  const totalPot = duel.currentPot;
  const companyProfit = isTie ? totalPot : Math.round(totalPot * 0.05);
  const winnerPayout = isTie ? 0 : totalPot - companyProfit;
  
  const creator = mockUsers[duel.creatorId];
  const acceptor = mockUsers[duel.acceptorId];
  
  if (isTie) {
    if (creator) {
      creator.totalLost += duel.creatorBet;
      creator.gamesPlayed += 1;
      creator.transactions.unshift({
        id: `tx_duel_tie_${Date.now()}`,
        type: "loss",
        amount: duel.creatorBet,
        timestamp: new Date().toISOString(),
        description: `1v1 Duel TIE Game! Both cards matched (${duel.creatorCard.rank} vs ${duel.acceptorCard.rank}). Pot forfeited to company profit.`,
      });
      const stats = ensureUserStats(creator);
      stats.totalHandsPlayed += 1;
      stats.handsTied += 1;
      stats.currentStreak = 0;
    }
    if (acceptor) {
      acceptor.totalLost += duel.acceptorBet;
      acceptor.gamesPlayed += 1;
      acceptor.transactions.unshift({
        id: `tx_duel_tie_${Date.now()}`,
        type: "loss",
        amount: duel.acceptorBet,
        timestamp: new Date().toISOString(),
        description: `1v1 Duel TIE Game! Both cards matched (${duel.creatorCard.rank} vs ${duel.acceptorCard.rank}). Pot forfeited to company profit.`,
      });
      const stats = ensureUserStats(acceptor);
      stats.totalHandsPlayed += 1;
      stats.handsTied += 1;
      stats.currentStreak = 0;
    }
    
    metrics.todayMatchedVolume += totalPot;
    metrics.todayTieRevenue += totalPot;
  } else {
    const winnerId = creatorIsWinner ? duel.creatorId : duel.acceptorId;
    const loserId = creatorIsWinner ? duel.acceptorId : duel.creatorId;
    const winnerUser = mockUsers[winnerId];
    const loserUser = mockUsers[loserId];
    const winnerBet = creatorIsWinner ? duel.creatorBet : duel.acceptorBet;
    const loserBet = creatorIsWinner ? duel.acceptorBet : duel.creatorBet;
    
    if (winnerUser) {
      winnerUser.balance += winnerPayout;
      winnerUser.totalWon += winnerPayout - winnerBet;
      winnerUser.gamesPlayed += 1;
      winnerUser.transactions.unshift({
        id: `tx_duel_win_${Date.now()}`,
        type: "deposit",
        amount: winnerPayout,
        timestamp: new Date().toISOString(),
        description: `1v1 Showdown WIN vs @${loserUser?.username || "Player"}! Payout: ৳${winnerPayout.toLocaleString()} (Pot: ৳${totalPot.toLocaleString()}, House 5%: ৳${companyProfit.toLocaleString()})`,
      });
      const stats = ensureUserStats(winnerUser);
      stats.totalHandsPlayed += 1;
      stats.handsWon += 1;
      stats.currentStreak += 1;
      if (stats.currentStreak > stats.bestStreak) stats.bestStreak = stats.currentStreak;
    }
    
    if (loserUser) {
      loserUser.totalLost += loserBet;
      loserUser.gamesPlayed += 1;
      loserUser.transactions.unshift({
        id: `tx_duel_loss_${Date.now()}`,
        type: "withdraw",
        amount: loserBet,
        timestamp: new Date().toISOString(),
        description: `1v1 Showdown Loss vs @${winnerUser?.username || "Player"}. Lost Stake: ৳${loserBet.toLocaleString()}`,
      });
      const stats = ensureUserStats(loserUser);
      stats.totalHandsPlayed += 1;
      stats.handsLost += 1;
      stats.currentStreak = 0;
    }
    
    metrics.todayMatchedVolume += totalPot;
    metrics.todayCommission += companyProfit;
  }
  
  metrics.totalRoundsPlayed += 1;
  
  recordGlobalTransaction({
    type: "commission",
    username: creator?.username || "Player",
    userId: duel.creatorId,
    recipientUsername: acceptor?.username || "Player",
    recipientUserId: duel.acceptorId,
    amount: companyProfit,
    method: isTie ? "1v1 Duel 100% Tie Pot Capture" : "1v1 Showdown company rake",
    status: "COMPLETED",
    description: isTie
      ? `1v1 Showdown TIE: @${creator?.username} vs @${acceptor?.username} (Total Pot: ৳${totalPot.toLocaleString()} captured as 100% Company Profit)`
      : `1v1 Showdown Settled: @${creatorIsWinner ? creator?.username : acceptor?.username} wins pot of ৳${totalPot.toLocaleString()} against @${creatorIsWinner ? acceptor?.username : creator?.username}`,
  });
  
  const room = activeRooms.find(r => r.id === duel.id);
  if (room) {
    room.status = "completed";
    room.winner = winnerRole.toLowerCase() as any;
    room.dragonCard = duel.creatorRole === "DRAGON" ? duel.creatorCard : duel.acceptorCard;
    room.tigerCard = duel.creatorRole === "TIGER" ? duel.creatorCard : duel.acceptorCard;
  }
  
  const histRoom = p2pRoomsHistory.find(r => r.id === duel.id);
  if (histRoom) {
    histRoom.status = "completed";
    histRoom.winner = winnerRole.toLowerCase() as any;
    histRoom.acceptorId = duel.acceptorId;
    histRoom.acceptorName = duel.acceptorName;
    histRoom.dragonCard = duel.creatorRole === "DRAGON" ? duel.creatorCard : duel.acceptorCard;
    histRoom.tigerCard = duel.creatorRole === "TIGER" ? duel.creatorCard : duel.acceptorCard;
  }
  
  duel.status = "SETTLED";
  duel.winnerRole = winnerRole;
  duel.netProfitCreator = creatorIsWinner ? winnerPayout - duel.creatorBet : -duel.creatorBet;
  duel.netProfitAcceptor = acceptorIsWinner ? winnerPayout - duel.acceptorBet : -duel.acceptorBet;
  duel.lastUpdated = Date.now();
  
  setTimeout(() => {
    delete activeDuels[duel.id];
  }, 45000);
}

// Active Duels 1-Second Heartbeat Ticker
setInterval(() => {
  Object.values(activeDuels).forEach((duel) => {
    if (duel.status === "ROLE_COIN_FLIP") {
      const elapsed = Date.now() - duel.lastUpdated;
      if (elapsed >= 2500) {
        duel.status = "PEEK_CARDS";
        duel.secondsRemaining = 20;
        duel.lastUpdated = Date.now();
        broadcast({ type: "DUEL_STATE_CHANGE", roomId: duel.id, status: "PEEK_CARDS" });
      }
    } else if (duel.status === "PEEK_CARDS") {
      const elapsed = Date.now() - duel.lastUpdated;
      if (elapsed >= 20000) {
        duel.creatorPeeked = true;
        duel.acceptorPeeked = true;
        duel.status = "BETTING";
        duel.turnUser = "DRAGON";
        duel.secondsRemaining = 15;
        duel.lastUpdated = Date.now();
        broadcast({ type: "DUEL_STATE_CHANGE", roomId: duel.id, status: "BETTING" });
      }
    } else if (duel.status === "BETTING") {
      if (duel.secondsRemaining > 0) {
        duel.secondsRemaining -= 1;
        broadcast({
          type: "DUEL_TICK",
          roomId: duel.id,
          secondsRemaining: duel.secondsRemaining,
        });
      } else {
        const foldingRole = duel.turnUser;
        const foldingUserId = foldingRole === duel.creatorRole ? duel.creatorId : duel.acceptorId;
        settleDuelOnFold(duel, foldingUserId);
        broadcast({ type: "DUEL_STATE_CHANGE", roomId: duel.id, status: "SETTLED" });
      }
    } else if (duel.status === "SHOWDOWN") {
      const elapsed = Date.now() - duel.lastUpdated;
      if (elapsed >= 3000) {
        settleDuelOnShowdown(duel);
        broadcast({ type: "DUEL_STATE_CHANGE", roomId: duel.id, status: "SETTLED" });
      }
    }
  });
}, 1000);

// ============================================================================
// CHAT & REAL-TIME MULTIPLAYER SYNC
// ============================================================================
interface LiveChatMessage {
  user: string;
  vipTier: string;
  text: string;
  time: string;
}

const chatMessages: LiveChatMessage[] = [];

// ============================================================================
// WEBSOCKET HANDLERS
// ============================================================================
wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "WELCOME", message: "Connected to Dragon Tiger P2P Arena" }));

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message.toString());
      if (data.type === "CHAT") {
        const msg: LiveChatMessage = {
          user: data.user || "Player",
          vipTier: data.vipTier || "Bronze",
          text: data.text || "",
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        chatMessages.push(msg);
        if (chatMessages.length > 100) chatMessages.shift();

        broadcast({
          type: "CHAT_MESSAGE",
          ...msg,
        });
      }
    } catch (e) {
      console.error("WS error:", e);
    }
  });
});

// ============================================================================
// REST API ENDPOINTS
// ============================================================================
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Real-Time Chat REST Endpoints
app.get("/api/chat/messages", (_req, res) => {
  res.json(chatMessages);
});

app.post("/api/chat/send", (req, res) => {
  const { user, vipTier, text } = req.body;
  if (!text || typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "Message cannot be empty" });
  }
  const msg: LiveChatMessage = {
    user: user || "Player",
    vipTier: vipTier || "Bronze",
    text: text.trim(),
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  };
  chatMessages.push(msg);
  if (chatMessages.length > 100) chatMessages.shift();

  broadcast({
    type: "CHAT_MESSAGE",
    ...msg,
  });
  res.json({ success: true, message: msg });
});

// 1. Tables Overview & Current Round
app.get("/api/tables", (_req, res) => {
  const result = Object.values(tables).map((t) => ({
    config: t.config,
    currentRound: t.currentRound,
    recentWinners: t.roadmap.slice(0, 10).map((r) => r.result),
  }));
  res.json(result);
});

app.get("/api/tables/:slug/roadmap", (req, res) => {
  const { slug } = req.params;
  const tbl = tables[slug];
  if (!tbl) return res.status(404).json({ error: "Table not found" });
  res.json(tbl.roadmap);
});

// Live Bet Transparency API - See which user placed how much on which side
app.get("/api/tables/:slug/bets", (req, res) => {
  const { slug } = req.params;
  const tbl = tables[slug];
  if (!tbl) return res.status(404).json({ error: "Table not found" });
  res.json({
    tableSlug: slug,
    roundNumber: tbl.currentRound.roundNumber,
    currentRoundBets: tbl.playerBets,
    recentSettledBets: tbl.recentSettledBets,
  });
});

// 2. Betting API - STRICT AUTHENTICATION ENFORCED
app.post("/api/game/bet", (req, res) => {
  const { userId, tableSlug, side, amount, balanceType = "real" } = req.body;

  // Strict check: Every player MUST be logged in
  if (!userId || typeof userId !== "string" || userId.trim() === "") {
    return res.status(401).json({
      error: "Authentication required. Every player must be logged in to place bets.",
      code: "AUTH_REQUIRED",
    });
  }

  const user = mockUsers[userId];
  if (!user) {
    return res.status(401).json({
      error: "Session expired or user account not found. Please log in again to continue.",
      code: "INVALID_USER",
    });
  }

  const tbl = tables[tableSlug];
  if (!tbl) return res.status(404).json({ error: "Table not found" });
  if (tbl.currentRound.status !== "BETTING") {
    return res.status(400).json({ error: "Betting closed for this round" });
  }

  const normalizedSide = (side || "").toString().toUpperCase();
  if (normalizedSide === "TIE") {
    return res.status(400).json({
      error: "🚫 Tie-তে বাজি ধরা সম্পূর্ণ নিষিদ্ধ। শুধুমাত্র Dragon অথবা Tiger-এ বাজি ধরুন। টাই (Tie) হলে ক্যাসিনো রুলস অনুযায়ী উভয় পক্ষের বাজি বাজেয়াপ্ত (Loss) হবে এবং সম্পূর্ণ টাকা কোম্পানি ফান্ডে যাবে।",
    });
  }

  if (normalizedSide !== "DRAGON" && normalizedSide !== "TIGER") {
    return res.status(400).json({
      error: "Invalid bet side. Only DRAGON or TIGER allowed.",
    });
  }

  // Self-Matching Block: Ensure player cannot bet on both opposing sides
  const opposingSide = normalizedSide === "DRAGON" ? "TIGER" : "DRAGON";
  const hasOpposingBet = tbl.playerBets.some(b => b.userId === userId && b.side === opposingSide && b.balanceType === balanceType);
  if (hasOpposingBet) {
    return res.status(400).json({
      error: "🚫 একই রাউন্ডে ড্রাগন এবং টাইগার উভয় পাশে বাজি ধরা সম্পূর্ণ নিষিদ্ধ (Self-Matching Block)। অনুগ্রহ করে যেকোনো এক পাশে বাজি বজায় রাখুন।"
    });
  }

  const numAmount = Number(amount);
  if (!numAmount || isNaN(numAmount) || numAmount <= 0) {
    return res.status(400).json({ error: "Invalid bet amount" });
  }

  if (numAmount < tbl.config.minBet || numAmount > tbl.config.maxBet) {
    return res.status(400).json({
      error: `Bet amount is outside the allowed limits of this table.`,
    });
  }

  const activeBal = balanceType === "real" ? user.balance : user.demoBalance;
  if (activeBal < numAmount) {
    return res.status(400).json({ error: "Insufficient balance for this bet" });
  }

  // Deduct balance
  if (balanceType === "real") {
    user.balance -= numAmount;
  } else {
    user.demoBalance -= numAmount;
  }
  user.gamesPlayed += 1;

  const userStats = ensureUserStats(user);

  // Create transparent public live bet record
  const betRecord: LiveBetRecord = {
    id: `bet_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    userId: user.userId,
    username: user.username,
    vipTier: "Standard",
    side: side.toUpperCase() as "DRAGON" | "TIGER" | "TIE",
    amount: numAmount,
    balanceType,
    timestamp: new Date().toISOString(),
    roundNumber: tbl.currentRound.roundNumber,
    tableSlug,
    status: "ACTIVE",
    winStreak: Math.max(userStats.currentStreak || 0, 0),
  };

  // Prepend to active table bets
  tbl.playerBets.unshift(betRecord);

  // Sync to user's detailed betting history
  if (!userBetHistories[user.userId]) {
    getOrSeedUserBetHistory(user.userId, user.username);
  }
  userBetHistories[user.userId].unshift({
    id: betRecord.id,
    roundNumber: tbl.currentRound.roundNumber,
    tableSlug,
    tableName: tbl.config.name,
    side: betRecord.side,
    amount: numAmount,
    matchedAmount: numAmount,
    unmatchedAmount: 0,
    returnedAmount: 0,
    tkReturnStatus: "NONE",
    balanceType,
    status: "ACTIVE",
    payout: 0,
    netPnL: 0,
    timestamp: betRecord.timestamp,
    serverSeedHash: tbl.currentRound.serverSeedHash,
  });
  if (userBetHistories[user.userId].length > 80) {
    userBetHistories[user.userId].pop();
  }

  // Update table pool
  if (side.toUpperCase() === "DRAGON") {
    tbl.currentRound.dragonPool += numAmount;
    tbl.currentRound.dragonPlayers += 1;
  } else if (side.toUpperCase() === "TIGER") {
    tbl.currentRound.tigerPool += numAmount;
    tbl.currentRound.tigerPlayers += 1;
  }
  tbl.currentRound.matchedAmount = Math.min(
    tbl.currentRound.dragonPool,
    tbl.currentRound.tigerPool
  );

  // Real-time broadcast transparent live bet to all connected clients
  broadcast({
    type: "NEW_BET",
    tableSlug,
    bet: betRecord,
    dragonPool: tbl.currentRound.dragonPool,
    tigerPool: tbl.currentRound.tigerPool,
    matchedAmount: tbl.currentRound.matchedAmount,
  });

  res.json({
    success: true,
    bet: betRecord,
    newBalance: balanceType === "real" ? user.balance : user.demoBalance,
    round: tbl.currentRound,
  });
});

// Cancel active bet before round betting closes (1-tap refund)
app.post("/api/game/cancel-bet", (req, res) => {
  const { userId, tableSlug, betId } = req.body;
  if (!userId || !tableSlug) {
    return res.status(400).json({ success: false, error: "Missing parameters" });
  }
  const user = mockUsers[userId];
  if (!user) {
    return res.status(404).json({ success: false, error: "User not found" });
  }
  const tbl = tables[tableSlug];
  if (!tbl) {
    return res.status(404).json({ success: false, error: "Table not found" });
  }
  if (tbl.currentRound.status !== "BETTING") {
    return res.status(400).json({ success: false, error: "Cannot cancel bet after betting has closed" });
  }

  const betIndex = tbl.playerBets.findIndex((b) => b.userId === userId && (!betId || b.id === betId));
  if (betIndex === -1) {
    return res.status(404).json({ success: false, error: "No active bet found to cancel" });
  }

  const [canceledBet] = tbl.playerBets.splice(betIndex, 1);
  if (canceledBet) {
    // Refund balance
    if (canceledBet.balanceType === "real") {
      user.balance += canceledBet.amount;
    } else {
      user.demoBalance += canceledBet.amount;
    }

    // Adjust table pool
    if (canceledBet.side === "DRAGON") {
      tbl.currentRound.dragonPool = Math.max(0, tbl.currentRound.dragonPool - canceledBet.amount);
      tbl.currentRound.dragonPlayers = Math.max(0, tbl.currentRound.dragonPlayers - 1);
    } else if (canceledBet.side === "TIGER") {
      tbl.currentRound.tigerPool = Math.max(0, tbl.currentRound.tigerPool - canceledBet.amount);
      tbl.currentRound.tigerPlayers = Math.max(0, tbl.currentRound.tigerPlayers - 1);
    }
    tbl.currentRound.matchedAmount = Math.min(tbl.currentRound.dragonPool, tbl.currentRound.tigerPool);

    // Update in history
    const userHist = userBetHistories[userId];
    if (userHist) {
      const histItem = userHist.find((h) => h.id === canceledBet.id);
      if (histItem) {
        histItem.status = "CANCELLED" as any;
        histItem.tkReturnStatus = "RETURNED_REFUND";
        histItem.returnedAmount = canceledBet.amount;
      }
    }

    // Broadcast updated pools
    broadcast({
      type: "BET_CANCELLED",
      tableSlug,
      betId: canceledBet.id,
      dragonPool: tbl.currentRound.dragonPool,
      tigerPool: tbl.currentRound.tigerPool,
      matchedAmount: tbl.currentRound.matchedAmount,
    });

    return res.json({
      success: true,
      refundedAmount: canceledBet.amount,
      newBalance: canceledBet.balanceType === "real" ? user.balance : user.demoBalance,
      round: tbl.currentRound,
    });
  }

  res.status(400).json({ success: false, error: "Failed to cancel bet" });
});

// Demo Reset Endpoint: 1-tap reload demo balance to ৳10,000
app.post("/api/wallet/:userId/reset-demo", (req, res) => {
  const { userId } = req.params;
  const user = mockUsers[userId];
  if (!user) {
    return res.status(404).json({ success: false, error: "User not found" });
  }

  user.demoBalance = 10000;
  user.transactions.unshift({
    id: `tx_${Date.now()}_demo_refill`,
    type: "faucet",
    amount: 10000,
    timestamp: new Date().toISOString(),
    description: "Refilled Demo Balance to ৳10,000",
  });

  res.json({
    success: true,
    demoBalance: user.demoBalance,
    user,
  });
});

// Toggle Balance Mode Endpoint: Switch between 'real' and 'demo' balance
app.post("/api/wallet/:userId/toggle-balance", (req, res) => {
  const { userId } = req.params;
  const { balanceType } = req.body;
  const user = mockUsers[userId];
  if (!user) {
    return res.status(404).json({ success: false, error: "User not found" });
  }

  if (balanceType === "real" || balanceType === "demo") {
    user.balanceType = balanceType;
  } else {
    user.balanceType = user.balanceType === "real" ? "demo" : "real";
  }

  res.json({
    success: true,
    balanceType: user.balanceType,
    user,
  });
});

// 3. Provably Fair Verification API (Public)
app.post("/api/verify", (req, res) => {
  const { serverSeed, serverSeedHash, clientSeed, nonce } = req.body;
  if (!serverSeed || !clientSeed || nonce === undefined) {
    return res.status(400).json({ error: "Missing verification parameters" });
  }

  const computedHash = hashServerSeed(serverSeed);
  const hashMatches = serverSeedHash ? computedHash.toLowerCase() === serverSeedHash.toLowerCase() : true;

  const result = deriveCards(serverSeed, clientSeed, Number(nonce));

  res.json({
    valid: hashMatches,
    computedServerSeedHash: computedHash,
    hmac: result.hmac,
    dragonCard: result.dragonCard,
    tigerCard: result.tigerCard,
    result: result.result,
    algorithm: "HMAC-SHA512 with modulo bias rejection",
  });
});

// 4. Authentication API (Sign Up & Sign In)
app.post("/api/auth/signup", (req, res) => {
  const { username, password, refCode } = req.body;
  if (!username || typeof username !== "string" || username.trim().length < 3) {
    return res.status(400).json({ success: false, error: "Username must be at least 3 characters" });
  }
  if (!password || typeof password !== "string" || password.length < 4) {
    return res.status(400).json({ success: false, error: "Password must be at least 4 characters" });
  }

  const cleanUsername = username.trim();
  const normalizedUser = cleanUsername.toLowerCase();

  if (userCredentials[normalizedUser]) {
    return res.status(400).json({ success: false, error: "Username already registered. Please sign in." });
  }

  const salt = crypto.randomBytes(8).toString("hex");
  const passwordHash = crypto.createHash("sha256").update(password + salt).digest("hex");
  const userId = `user_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  userCredentials[normalizedUser] = {
    userId,
    username: cleanUsername,
    passwordHash,
    salt,
  };

  const newUser: UserWallet = {
    userId,
    username: cleanUsername,
    balance: 0,
    demoBalance: 10000,
    balanceType: "demo",
    lockedBalance: 0,
    totalWon: 0,
    totalLost: 0,
    gamesPlayed: 0,
    kycStatus: "verified",
    transactions: [
      {
        id: `tx_${Date.now()}_demo_init`,
        type: "faucet",
        amount: 10000,
        timestamp: new Date().toISOString(),
        description: "Welcome Demo Starter Chips (৳10,000)",
      },
    ],
  };

  // Check if invited via referral code
  if (refCode && typeof refCode === "string") {
    const cleanRefCode = refCode.trim().toUpperCase();
    const referrerUserId = referralCodeToUser[cleanRefCode];
    if (referrerUserId && referrerUserId !== userId) {
      userReferrerMap[userId] = referrerUserId;
      const referrerData = ensureReferralData(referrerUserId, mockUsers[referrerUserId]?.username);
      referrerData.friends.unshift({
        userId,
        username: cleanUsername,
        joinedAt: new Date().toISOString(),
        totalWagered: 0,
        commissionEarned: 0,
        activeStatus: "ACTIVE",
      });
      referrerData.totalReferredCount = referrerData.friends.length;
      const { tier, pct } = getReferralTier(referrerData.friends.length);
      referrerData.tier = tier;
      referrerData.tierRevSharePct = pct;
    }
  }

  newUser.referral = ensureReferralData(userId, cleanUsername);
  mockUsers[userId] = newUser;
  res.json({ success: true, user: newUser });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: "Please enter username and password" });
  }

  const normalizedUser = username.trim().toLowerCase();
  const cred = userCredentials[normalizedUser];

  if (!cred) {
    // If not found in explicit credentials, check if user exists in mockUsers (or create demo user with password)
    const existingMock = Object.values(mockUsers).find(
      (u) => u.username.toLowerCase() === normalizedUser
    );
    if (existingMock) {
      // Auto-register credential with this password for convenience
      const salt = crypto.randomBytes(8).toString("hex");
      const passwordHash = crypto.createHash("sha256").update(password + salt).digest("hex");
      userCredentials[normalizedUser] = {
        userId: existingMock.userId,
        username: existingMock.username,
        passwordHash,
        salt,
      };
      existingMock.referral = ensureReferralData(existingMock.userId, existingMock.username);
      return res.json({ success: true, user: existingMock });
    }

    return res.status(401).json({ success: false, error: "Account not found. Please click Sign Up to register." });
  }

  const computedHash = crypto.createHash("sha256").update(password + cred.salt).digest("hex");
  if (computedHash !== cred.passwordHash) {
    return res.status(401).json({ success: false, error: "Incorrect password. Please try again." });
  }

  const user = mockUsers[cred.userId];
  if (!user) {
    return res.status(404).json({ success: false, error: "User profile not found" });
  }

  user.referral = ensureReferralData(user.userId, user.username);
  res.json({ success: true, user });
});

// 5. Wallet API
app.get("/api/wallet/:userId", (req, res) => {
  const { userId } = req.params;
  if (!mockUsers[userId]) {
    mockUsers[userId] = {
      userId,
      username: (req.query.username as string) || `Player_${userId.slice(0, 5)}`,
      balance: 0,
      demoBalance: 0,
      balanceType: "real",
      lockedBalance: 0,
      totalWon: 0,
      totalLost: 0,
      gamesPlayed: 0,
      kycStatus: "none",
      transactions: [],
    };
  }
  ensureUserStats(mockUsers[userId]);
  ensureUserCosmetics(mockUsers[userId]);
  mockUsers[userId].referral = ensureReferralData(userId, mockUsers[userId].username);
  res.json(mockUsers[userId]);
});

// Zero-Cost Cosmetics & Progression Endpoints
app.get("/api/user/cosmetics/:userId", (req, res) => {
  const { userId } = req.params;
  const user = mockUsers[userId];
  if (!user) return res.status(404).json({ error: "User profile not found" });
  const cosmetics = ensureUserCosmetics(user);
  res.json({ success: true, cosmetics });
});

app.post("/api/user/cosmetics/equip", (req, res) => {
  const { userId, type, itemKey } = req.body;
  if (!userId || !mockUsers[userId]) {
    return res.status(401).json({ error: "Authentication required" });
  }
  const user = mockUsers[userId];
  const c = ensureUserCosmetics(user);

  if (type === "frame") {
    if (c.unlockedFrames.includes(itemKey)) c.equippedFrame = itemKey;
    else return res.status(400).json({ error: `Frame '${itemKey}' is locked. Play more hands or reach rank to unlock.` });
  } else if (type === "cardBack") {
    if (c.unlockedCardBacks.includes(itemKey)) c.equippedCardBack = itemKey;
    else return res.status(400).json({ error: `Card back skin '${itemKey}' is locked.` });
  } else if (type === "theme") {
    if (c.unlockedThemes.includes(itemKey)) c.equippedTableTheme = itemKey;
    else return res.status(400).json({ error: `Table theme '${itemKey}' is locked.` });
  } else if (type === "title") {
    if (c.unlockedTitles.includes(itemKey)) c.equippedTitle = itemKey;
    else return res.status(400).json({ error: `Title '${itemKey}' is locked.` });
  }

  res.json({ success: true, cosmetics: c, user });
});

app.post("/api/user/login-streak/:userId", (req, res) => {
  const { userId } = req.params;
  const user = mockUsers[userId];
  if (!user) return res.status(404).json({ error: "User not found" });
  const c = ensureUserCosmetics(user);
  c.loginStreakDays = (c.loginStreakDays || 1) + 1;
  res.json({ success: true, loginStreakDays: c.loginStreakDays, cosmetics: c });
});

// Admin Reset Endpoint: Reset all player balances to 0
app.post("/api/admin/reset-balances", (_req, res) => {
  Object.values(mockUsers).forEach((u) => {
    u.balance = 0;
    u.demoBalance = 0;
    u.lockedBalance = 0;
    u.totalWon = 0;
    u.totalLost = 0;
    u.gamesPlayed = 0;
    u.transactions = [];
  });
  res.json({ success: true, message: "All site user balances reset to 0." });
});

// 5.1 Referral Program Endpoints
app.get("/api/referral/:userId", (req, res) => {
  const { userId } = req.params;
  const user = mockUsers[userId];
  const refData = ensureReferralData(userId, user?.username || "Player");
  res.json({
    success: true,
    data: refData,
  });
});

app.post("/api/referral/claim", (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ success: false, error: "Missing userId" });
  }
  const user = mockUsers[userId];
  if (!user) {
    return res.status(404).json({ success: false, error: "User not found" });
  }
  const refData = ensureReferralData(userId, user.username);
  const cosmetics = ensureUserCosmetics(user);

  // Zero Monetary Cost Policy: Claims unlock prestige title & badges with ₹0 cost to company
  if (!cosmetics.unlockedBadges.includes("Social Star")) {
    cosmetics.unlockedBadges.push("Social Star");
  }
  if (!cosmetics.unlockedTitles.includes("Ambassador")) {
    cosmetics.unlockedTitles.push("Ambassador");
  }
  refData.unclaimedCommission = 0;

  res.json({
    success: true,
    claimedAmount: 0,
    newBalance: user.balance,
    referral: refData,
    user,
    message: "Prestige Ambassador rewards & Social Star badge active!",
  });
});

app.post("/api/referral/apply", (req, res) => {
  const { userId, refCode } = req.body;
  if (!userId || !refCode) {
    return res.status(400).json({ success: false, error: "Missing parameters" });
  }
  const user = mockUsers[userId];
  if (!user) {
    return res.status(404).json({ success: false, error: "User not found" });
  }
  if (userReferrerMap[userId]) {
    return res.status(400).json({ success: false, error: "A referral code is already active on this account." });
  }

  const cleanRefCode = refCode.trim().toUpperCase();
  const referrerUserId = referralCodeToUser[cleanRefCode];
  if (!referrerUserId || referrerUserId === userId) {
    return res.status(400).json({ success: false, error: "Invalid referral code or cannot refer yourself." });
  }

  userReferrerMap[userId] = referrerUserId;
  const referrerData = ensureReferralData(referrerUserId, mockUsers[referrerUserId]?.username);
  referrerData.friends.unshift({
    userId,
    username: user.username,
    joinedAt: new Date().toISOString(),
    totalWagered: 0,
    commissionEarned: 0,
    activeStatus: "ACTIVE",
  });
  referrerData.totalReferredCount = referrerData.friends.length;
  const { tier, pct } = getReferralTier(referrerData.friends.length);
  referrerData.tier = tier;
  referrerData.tierRevSharePct = pct;

  // Zero Monetary Bonus: Unlocks "Social Star" cosmetic badge & title
  const cosmetics = ensureUserCosmetics(user);
  if (!cosmetics.unlockedBadges.includes("Social Star")) {
    cosmetics.unlockedBadges.push("Social Star");
  }
  if (!cosmetics.unlockedTitles.includes("Competitor")) {
    cosmetics.unlockedTitles.push("Competitor");
  }

  res.json({
    success: true,
    unlockedBadge: "Social Star",
    message: `Referral code ${cleanRefCode} active! Unlocked Social Star prestige badge.`,
    user,
  });
});

// Dedicated Personalized Statistics Endpoint across Dragon Tiger tables
app.get("/api/user/stats/:userId", (req, res) => {
  const { userId } = req.params;
  if (!userId) {
    return res.status(400).json({ error: "Missing user ID", code: "INVALID_PARAM" });
  }
  const user = mockUsers[userId];
  if (!user) {
    return res.status(404).json({ error: "User profile not found", code: "USER_NOT_FOUND" });
  }
  const stats = ensureUserStats(user);
  res.json({
    success: true,
    userId: user.userId,
    username: user.username,
    stats,
  });
});

// Comprehensive User Bet History & P&L Endpoint
app.get("/api/wallet/:userId/bets", (req, res) => {
  const { userId } = req.params;
  const user = mockUsers[userId];
  const username = user?.username || (req.query.username as string) || "Player";
  const history = getOrSeedUserBetHistory(userId, username);

  let totalWagered = 0;
  let totalMatched = 0;
  let totalReturned = 0;
  let totalWon = 0;
  let totalLost = 0;
  let winsCount = 0;

  history.forEach((b) => {
    totalWagered += b.amount;
    totalMatched += b.matchedAmount;
    totalReturned += b.returnedAmount;
    if (b.status === "WON") {
      winsCount += 1;
      totalWon += b.payout;
    } else if (b.status === "LOST") {
      totalLost += b.matchedAmount;
    }
  });

  const settledCount = history.filter((b) => b.status === "WON" || b.status === "LOST").length;
  const winRate = settledCount > 0 ? Number(((winsCount / settledCount) * 100).toFixed(1)) : 0;
  const netPnL = (totalWon + totalReturned) - totalWagered;

  const response: UserBetHistoryResponse = {
    userId,
    username,
    totalWagered,
    totalMatched,
    totalReturned,
    totalWon,
    totalLost,
    netPnL,
    winRate,
    totalBetsCount: history.length,
    bets: history,
  };

  res.json(response);
});

app.get("/api/wallet/:userId/history", (req, res) => {
  const { userId } = req.params;
  const user = mockUsers[userId];
  const username = user?.username || (req.query.username as string) || "Player";
  const history = getOrSeedUserBetHistory(userId, username);

  let totalWagered = 0;
  let totalMatched = 0;
  let totalReturned = 0;
  let totalWon = 0;
  let totalLost = 0;
  let winsCount = 0;

  history.forEach((b) => {
    totalWagered += b.amount;
    totalMatched += b.matchedAmount;
    totalReturned += b.returnedAmount;
    if (b.status === "WON") {
      winsCount += 1;
      totalWon += b.payout;
    } else if (b.status === "LOST") {
      totalLost += b.matchedAmount;
    }
  });

  const settledCount = history.filter((b) => b.status === "WON" || b.status === "LOST").length;
  const winRate = settledCount > 0 ? Number(((winsCount / settledCount) * 100).toFixed(1)) : 0;
  const netPnL = (totalWon + totalReturned) - totalWagered;

  const response: UserBetHistoryResponse = {
    userId,
    username,
    totalWagered,
    totalMatched,
    totalReturned,
    totalWon,
    totalLost,
    netPnL,
    winRate,
    totalBetsCount: history.length,
    bets: history,
  };

  res.json(response);
});

// ============================================================================
// GLOBAL PUBLIC FINANCIAL TRANSPARENCY LEDGER
// ============================================================================
export interface GlobalTransaction {
  id: string;
  txHash: string;
  type: "deposit" | "withdraw" | "transfer" | "tie_refund" | "commission";
  username: string;
  userId: string;
  recipientUsername?: string;
  recipientUserId?: string;
  amount: number;
  method: string;
  status: "COMPLETED" | "PROCESSED";
  timestamp: string;
  description: string;
}

const globalTransactions: GlobalTransaction[] = [];

function recordGlobalTransaction(tx: Omit<GlobalTransaction, "id" | "txHash" | "timestamp">) {
  const hexChars = "0123456789abcdef";
  let hash = "0x";
  for (let i = 0; i < 64; i++) {
    hash += hexChars[Math.floor(Math.random() * hexChars.length)];
  }

  const newTx: GlobalTransaction = {
    ...tx,
    id: `gtx_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    txHash: hash,
    timestamp: new Date().toISOString(),
  };

  globalTransactions.unshift(newTx);
  if (globalTransactions.length > 500) {
    globalTransactions.pop();
  }
  return newTx;
}

// 5. Public Financial Transparency Ledger API
app.get("/api/transparency/transactions", (req, res) => {
  const { type, search, limit } = req.query;
  let results = [...globalTransactions];

  if (type && type !== "all") {
    results = results.filter((tx) => tx.type === type);
  }

  if (search && typeof search === "string" && search.trim()) {
    const q = search.trim().toLowerCase();
    results = results.filter(
      (tx) =>
        tx.username.toLowerCase().includes(q) ||
        (tx.recipientUsername && tx.recipientUsername.toLowerCase().includes(q)) ||
        tx.txHash.toLowerCase().includes(q) ||
        tx.method.toLowerCase().includes(q) ||
        tx.description.toLowerCase().includes(q)
    );
  }

  const max = Number(limit) || 100;
  res.json({
    success: true,
    totalCount: results.length,
    transactions: results.slice(0, max),
  });
});

// 5b. Public User Directory & Full Transparency API
app.get("/api/transparency/users", (req, res) => {
  const { search, limit } = req.query;
  let userList = Object.values(mockUsers).map((u) => {
    const stats = ensureUserStats(u);
    const history = getOrSeedUserBetHistory(u.userId, u.username);
    const refData = ensureReferralData(u.userId, u.username);
    return {
      userId: u.userId,
      username: u.username,
      balance: u.balance,
      demoBalance: u.demoBalance,
      lockedBalance: u.lockedBalance,
      totalWon: u.totalWon,
      totalLost: u.totalLost,
      gamesPlayed: u.gamesPlayed,
      kycStatus: u.kycStatus,
      stats,
      betHistoryCount: history.length,
      transactionsCount: u.transactions ? u.transactions.length : 0,
      referredFriendsCount: refData.totalReferredCount,
      totalCommissionEarned: refData.totalCommissionEarned,
    };
  });

  if (search && typeof search === "string" && search.trim()) {
    const q = search.trim().toLowerCase();
    userList = userList.filter((u) => u.username.toLowerCase().includes(q) || u.userId.toLowerCase().includes(q));
  }

  const max = Number(limit) || 100;
  res.json({
    success: true,
    totalUsers: userList.length,
    users: userList.slice(0, max),
  });
});

app.get("/api/transparency/users/:targetUserId", (req, res) => {
  const { targetUserId } = req.params;
  const user = mockUsers[targetUserId];
  if (!user) {
    return res.status(404).json({ success: false, error: "User not found" });
  }

  const stats = ensureUserStats(user);
  const betHistory = getOrSeedUserBetHistory(user.userId, user.username);
  const referralData = ensureReferralData(user.userId, user.username);

  res.json({
    success: true,
    user: {
      userId: user.userId,
      username: user.username,
      balance: user.balance,
      demoBalance: user.demoBalance,
      lockedBalance: user.lockedBalance,
      totalWon: user.totalWon,
      totalLost: user.totalLost,
      gamesPlayed: user.gamesPlayed,
      kycStatus: user.kycStatus,
      stats,
      transactions: user.transactions || [],
      betHistory: betHistory || [],
      referralData: referralData || null,
    },
  });
});

app.post("/api/wallet/action", (req, res) => {
  const { userId, action, amount, description, method } = req.body;
  const user = mockUsers[userId];
  if (!user) return res.status(404).json({ error: "User not found" });

  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    return res.status(400).json({ error: "Invalid amount" });
  }

  const selectedMethod = method || (action === "deposit" ? "bKash / Nagad / UPI" : "Bank / Mobile Payout");

  if (action === "deposit") {
    user.balance += numAmount;
    const txId = `tx_${Date.now()}`;
    const desc = description || `Instant Deposit via ${selectedMethod}`;
    
    user.transactions.unshift({
      id: txId,
      type: action,
      amount: numAmount,
      timestamp: new Date().toISOString(),
      description: desc,
    });

    if (action === "deposit") {
      recordGlobalTransaction({
        type: "deposit",
        username: user.username,
        userId: user.userId,
        amount: numAmount,
        method: selectedMethod,
        status: "COMPLETED",
        description: desc,
      });
    }
  } else if (action === "withdraw") {
    if (user.balance < numAmount) {
      return res.status(400).json({ error: "Insufficient balance for withdrawal" });
    }
    user.balance -= numAmount;
    const txId = `tx_${Date.now()}`;
    const desc = description || `Instant Withdrawal via ${selectedMethod}`;

    user.transactions.unshift({
      id: txId,
      type: "withdraw",
      amount: numAmount,
      timestamp: new Date().toISOString(),
      description: desc,
    });

    recordGlobalTransaction({
      type: "withdraw",
      username: user.username,
      userId: user.userId,
      amount: numAmount,
      method: selectedMethod,
      status: "COMPLETED",
      description: desc,
    });
  } else if (action === "demo_reset") {
    user.demoBalance = 100000;
  }

  res.json({ success: true, user });
});

// P2P Fund Transfer Endpoint (Send Money to another player)
app.post("/api/wallet/transfer", (req, res) => {
  const { fromUserId, toUsername, amount, note } = req.body;
  if (!fromUserId || !toUsername || !amount) {
    return res.status(400).json({ error: "Missing required parameters for transfer" });
  }

  const sender = mockUsers[fromUserId];
  if (!sender) {
    return res.status(404).json({ error: "Sender account not found" });
  }

  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount < 10) {
    return res.status(400).json({ error: "Minimum transfer amount is ৳10 / ₹10" });
  }

  if (sender.balance < numAmount) {
    return res.status(400).json({ error: "Insufficient balance to transfer this amount" });
  }

  // Find recipient by username (case-insensitive) or userId
  const cleanTarget = toUsername.trim().toLowerCase();
  let recipient = Object.values(mockUsers).find(
    (u) => u.username.toLowerCase() === cleanTarget || u.userId.toLowerCase() === cleanTarget
  );

  // If not found in mockUsers, check if target username is valid and create profile
  let targetRecipient: UserWallet;
  if (!recipient) {
    const targetUserId = `user_p2p_${Date.now()}`;
    targetRecipient = {
      userId: targetUserId,
      username: toUsername.trim(),
      balance: 0,
      demoBalance: 0,
      balanceType: "real",
      lockedBalance: 0,
      totalWon: 0,
      totalLost: 0,
      gamesPlayed: 0,
      kycStatus: "verified",
      transactions: [],
    };
    mockUsers[targetUserId] = targetRecipient;
  } else {
    targetRecipient = recipient;
  }

  if (targetRecipient.userId === sender.userId) {
    return res.status(400).json({ error: "Cannot send funds to your own account" });
  }

  // Execute Transfer
  sender.balance -= numAmount;
  targetRecipient.balance += numAmount;

  const txTime = new Date().toISOString();
  const txSenderDesc = `Sent ৳${numAmount.toLocaleString()} to @${targetRecipient.username}${note ? ` ("${note}")` : ""}`;
  const txRecipientDesc = `Received ৳${numAmount.toLocaleString()} from @${sender.username}${note ? ` ("${note}")` : ""}`;

  // Log in sender transactions
  sender.transactions.unshift({
    id: `tx_${Date.now()}_send`,
    type: "transfer" as unknown as "withdraw",
    amount: numAmount,
    timestamp: txTime,
    description: txSenderDesc,
  });

  // Log in recipient transactions
  targetRecipient.transactions.unshift({
    id: `tx_${Date.now()}_recv`,
    type: "transfer" as unknown as "deposit",
    amount: numAmount,
    timestamp: txTime,
    description: txRecipientDesc,
  });

  // Record in Global Public Ledger
  const globalTx = recordGlobalTransaction({
    type: "transfer",
    username: sender.username,
    userId: sender.userId,
    recipientUsername: targetRecipient.username,
    recipientUserId: targetRecipient.userId,
    amount: numAmount,
    method: "P2P Direct (0% Fee)",
    status: "COMPLETED",
    description: `P2P Transfer: @${sender.username} ➔ @${targetRecipient.username} (৳${numAmount.toLocaleString()})`,
  });

  res.json({
    success: true,
    message: `Successfully sent ৳${numAmount.toLocaleString()} to @${targetRecipient.username}`,
    senderBalance: sender.balance,
    user: sender,
    globalTx,
  });
});

// 5. Admin API
app.get("/api/admin/stats", (_req, res) => {
  let totalRealBalance = 0;
  let totalDemoBalance = 0;
  let totalEscrowLocked = 0;

  Object.values(mockUsers).forEach((u) => {
    totalRealBalance += u.balance;
    totalDemoBalance += u.demoBalance;
  });

  Object.values(tables).forEach((t) => {
    t.playerBets.forEach((b) => {
      if (b.status === "ACTIVE") totalEscrowLocked += b.amount;
    });
  });

  activeRooms.forEach((r) => {
    if (r.status === "open") totalEscrowLocked += r.amount;
  });

  res.json({
    metrics,
    totalSiteLiquidity: totalRealBalance + totalEscrowLocked,
    totalRealBalance,
    totalDemoBalance,
    totalEscrowLocked,
    tables: Object.values(tables).map((t) => ({
      slug: t.config.slug,
      name: t.config.name,
      minBet: t.config.minBet,
      maxBet: t.config.maxBet,
      timer: t.currentRound.secondsRemaining,
      dragonPool: t.currentRound.dragonPool,
      tigerPool: t.currentRound.tigerPool,
      matchedAmount: t.currentRound.matchedAmount,
      playersOnline: t.config.playersOnline,
    })),
    usersCount: Object.keys(mockUsers).length,
    users: Object.values(mockUsers).map((u) => ({
      userId: u.userId,
      username: u.username,
      balance: u.balance,
      demoBalance: u.demoBalance,
      kycStatus: u.kycStatus,
      gamesPlayed: u.gamesPlayed,
    })),
  });
});

app.post("/api/admin/user/balance", (req, res) => {
  const { userId, type, amount, isDemo } = req.body;
  const user = mockUsers[userId];
  if (!user) return res.status(404).json({ error: "User not found" });

  const num = Number(amount);
  if (isNaN(num) || num < 0) return res.status(400).json({ error: "Invalid amount" });

  if (isDemo) {
    if (type === "add") user.demoBalance += num;
    else user.demoBalance = Math.max(0, user.demoBalance - num);
  } else {
    if (type === "add") user.balance += num;
    else user.balance = Math.max(0, user.balance - num);
  }

  res.json({ success: true, balance: user.balance, demoBalance: user.demoBalance });
});

app.post("/api/admin/user/status", (req, res) => {
  const { userId, kycStatus } = req.body;
  const user = mockUsers[userId];
  if (!user) return res.status(404).json({ error: "User not found" });

  if (kycStatus) {
    user.kycStatus = kycStatus;
  }
  res.json({ success: true, user });
});

app.post("/api/admin/table/config", (req, res) => {
  const { slug, minBet, maxBet, bettingDuration } = req.body;
  const tbl = tables[slug];
  if (!tbl) return res.status(404).json({ error: "Table not found" });

  if (minBet !== undefined) tbl.config.minBet = Number(minBet);
  if (maxBet !== undefined) tbl.config.maxBet = Number(maxBet);
  if (bettingDuration !== undefined) tbl.config.bettingDuration = Number(bettingDuration);

  res.json({ success: true, config: tbl.config });
});

// 6. Merchant Simulation API
app.post("/api/merchant/test", (req, res) => {
  const { endpoint, method, payload } = req.body;
  const sampleResponses: Record<string, unknown> = {
    "/player/create": { success: true, playerId: "ext_user_8829", currency: "INR", balance: 5000 },
    "/player/deposit": { success: true, transactionId: `tx_merch_${Date.now()}`, newBalance: 15000 },
    "/player/launch-game": {
      success: true,
      gameUrl: "https://dragontiger.p2p.casino/play?token=session_jwt_apex_token_8892&table=classic",
      expiresIn: 3600,
    },
  };

  res.json({
    endpoint,
    method,
    status: 200,
    timeMs: Math.floor(Math.random() * 25) + 12,
    response: sampleResponses[endpoint] || { success: true, status: "acknowledged", payload },
  });
});

// Anti-bot Spam Tracking for P2P Rooms
const recentRoomAttempts: Record<string, number[]> = {};
const playerReports: PlayerReport[] = [];

// 7. P2P Lobby & Duels API
const checkExpiredRooms = () => {
  const now = Date.now();
  const FIVE_MINUTES = 5 * 60 * 1000;
  for (let i = activeRooms.length - 1; i >= 0; i--) {
    const room = activeRooms[i];
    if (room.status === "open" && room.createdAt) {
      const createdTime = new Date(room.createdAt).getTime();
      const elapsed = now - createdTime;
      room.autoCloseSecondsRemaining = Math.max(0, Math.floor((FIVE_MINUTES - elapsed) / 1000));
      
      if (elapsed > FIVE_MINUTES) {
        room.status = "cancelled" as any;
        const creator = mockUsers[room.creatorId];
        if (creator) {
          creator.balance += room.amount;
          creator.transactions.unshift({
            id: `tx_p2p_expire_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
            type: "deposit",
            amount: room.amount,
            timestamp: new Date().toISOString(),
            description: `Refund P2P Challenge: Room expired after 5 minutes without opponent (Stake: ৳${room.amount.toLocaleString()})`,
          });
        }
        activeRooms.splice(i, 1);
        broadcast({ type: "ROOM_EXPIRED", roomId: room.id });
      }
    }
  }
};

setInterval(checkExpiredRooms, 10000);

app.get("/api/rooms", (_req, res) => {
  checkExpiredRooms();
  res.json(activeRooms);
});

app.post("/api/rooms/create", (req, res) => {
  const {
    userId,
    username,
    amount,
    odds,
    acceptorAmount: clientAcceptorAmount,
    isPrivate,
    password,
    minStake,
    maxStake,
    invitedUsername,
    isSingleRoundQuickChallenge,
    choice,
  } = req.body;

  if (!userId || typeof userId !== "string" || !mockUsers[userId]) {
    return res.status(401).json({
      error: "Authentication required. Every player must be logged in to create challenge bets.",
      code: "AUTH_REQUIRED",
    });
  }

  // Anti-bot Spam Frequency Detection (high frequency creation/deletion)
  const now = Date.now();
  if (!recentRoomAttempts[userId]) recentRoomAttempts[userId] = [];
  recentRoomAttempts[userId] = recentRoomAttempts[userId].filter((t) => now - t < 60000);
  recentRoomAttempts[userId].push(now);

  const isHighFrequencySpam = recentRoomAttempts[userId].length >= 4;
  if (recentRoomAttempts[userId].length > 7) {
    return res.status(429).json({
      error: "⚠️ সিকিউরিটি সতর্কতা: অত্যধিক দ্রুত রুম রিকোয়েস্ট শনাক্ত হয়েছে (Bot Spam Defense)। অনুগ্রহ করে ৩০ সেকেন্ড অপেক্ষা করুন।",
      botSpamDetected: true,
    });
  }

  // 1-active-room limit enforcement per creator
  const hasActiveRoom = activeRooms.some((r) => r.creatorId === userId && r.status === "open");
  if (hasActiveRoom) {
    return res.status(400).json({
      error: "🚫 আপনার ইতিমধ্যে একটি সক্রিয় ডুয়েল রুম রয়েছে! নতুন রুম তৈরি করতে বর্তমান সক্রিয় রুমটি ডিলিট বা ক্যান্সেল করুন।"
    });
  }

  const user = mockUsers[userId];
  const numAmount = Number(amount);
  
  if (isNaN(numAmount) || numAmount < 1) {
    return res.status(400).json({ error: "Minimum challenge stake is ৳1 chip" });
  }

  const parsedMinStake = Number(minStake) || 1;
  const parsedMaxStake = Number(maxStake) || 100000;

  if (parsedMinStake < 1 || parsedMaxStake < parsedMinStake) {
    return res.status(400).json({ error: "অবৈধ ন্যূনতম বা সর্বোচ্চ বাজি সীমা!" });
  }

  let calculatedAcceptorAmount = 0;
  if (clientAcceptorAmount !== undefined && !isNaN(Number(clientAcceptorAmount)) && Number(clientAcceptorAmount) >= 10) {
    calculatedAcceptorAmount = Math.round(Number(clientAcceptorAmount));
  } else {
    let numOdds = Number(odds);
    if (isNaN(numOdds) || numOdds < 1.05) numOdds = 2.0;
    if (numOdds > 50.0) numOdds = 50.0;
    calculatedAcceptorAmount = Math.max(10, Math.round(numAmount * (numOdds - 1)));
  }

  const totalPot = numAmount + calculatedAcceptorAmount;
  const numOdds = Number((totalPot / numAmount).toFixed(2));

  if (numOdds < 1.05 || numOdds > 50.0) {
    return res.status(400).json({ error: "Invalid challenge odds ratio. Odds multiplier must be between 1.05x and 50.0x." });
  }

  if (user.balance < numAmount) {
    return res.status(400).json({ error: `🚫 অপর্যাপ্ত ব্যালেন্স! রুম তৈরি করতে আপনার মূল ব্যালেন্সে অন্তত ৳${numAmount.toLocaleString()} চিপস থাকতে হবে। দয়া করে Add Fund বা ডিপোজিট করুন।` });
  }

  user.balance -= numAmount;
  
  // Log creation transaction
  user.transactions.unshift({
    id: `tx_p2p_create_${Date.now()}`,
    type: "withdraw",
    amount: numAmount,
    timestamp: new Date().toISOString(),
    description: `Created P2P Challenge: Risked ৳${numAmount.toLocaleString()} (Min: ৳${parsedMinStake.toLocaleString()}, Max: ৳${parsedMaxStake.toLocaleString()})`,
  });

  // Side Selector (Dragon/Tiger) - Use player's chosen side or fallback
  const selectedChoice: "dragon" | "tiger" =
    choice === "tiger" || choice === "dragon"
      ? choice
      : Math.random() > 0.5 ? "dragon" : "tiger";

  // Compute Room Tags & Attributes
  const tags: string[] = [];
  if (numAmount <= 200) tags.push("Newbie Friendly");
  if (numAmount >= 3000) tags.push("High Roller");
  if (isSingleRoundQuickChallenge) tags.push("Fast Action", "1v1 Quick");
  else tags.push("Classic Duel");
  if (invitedUsername) tags.push("Direct Invite");

  const activityScore = isSingleRoundQuickChallenge ? 85 : Math.floor(Math.random() * 45) + 40;
  const isFastAction = isSingleRoundQuickChallenge === true || (parsedMinStake <= 50 && numAmount <= 500);
  const isHotRoom = activityScore >= 75 || numAmount >= 2500;

  const newRoom: P2PRoom = {
    id: `room_${Date.now()}`,
    creatorId: userId,
    creatorName: username || user.username,
    amount: numAmount,
    choice: selectedChoice,
    odds: numOdds,
    acceptorAmount: calculatedAcceptorAmount,
    status: "open",
    createdAt: new Date().toISOString(),
    isPrivate: isPrivate === true || Boolean(password),
    password: password || undefined,
    minStake: parsedMinStake,
    maxStake: parsedMaxStake,
    invitedUsername: invitedUsername ? String(invitedUsername).trim().replace(/^@/, "") : undefined,
    activityScore,
    lastActiveAt: new Date().toISOString(),
    isFastAction,
    isHotRoom,
    tags,
    autoCloseSecondsRemaining: 300,
    capacityPercent: 50,
    recentBetActionsCount: isSingleRoundQuickChallenge ? 9 : 3,
    isSingleRoundQuickChallenge: isSingleRoundQuickChallenge === true,
  };

  activeRooms.unshift(newRoom);
  p2pRoomsHistory.unshift(newRoom);
  broadcast({ type: "ROOM_CREATED", room: newRoom });

  res.json({
    success: true,
    room: newRoom,
    user,
    botSpamWarning: isHighFrequencySpam ? "High creation frequency detected from your IP. Please avoid rapid creation/deletion." : undefined,
  });
});

app.post("/api/rooms/update-password", (req, res) => {
  const { roomId, userId, newPassword } = req.body;
  if (!userId || typeof userId !== "string" || !mockUsers[userId]) {
    return res.status(401).json({ error: "Authentication required." });
  }
  const room = activeRooms.find((r) => r.id === roomId);
  if (!room || room.status !== "open") {
    return res.status(400).json({ error: "Room not found or no longer open." });
  }
  if (room.creatorId !== userId) {
    return res.status(403).json({ error: "Only the room creator can change the password." });
  }
  if (!newPassword || typeof newPassword !== "string" || !newPassword.trim()) {
    return res.status(400).json({ error: "Invalid password." });
  }

  room.password = newPassword.trim();
  room.isPrivate = true;
  broadcast({ type: "ROOM_UPDATED", room });

  res.json({ success: true, room });
});

app.post("/api/rooms/accept", (req, res) => {
  const { roomId, userId, username, password, acceptorStake: customAcceptorStake } = req.body;
  if (!userId || typeof userId !== "string" || !mockUsers[userId]) {
    return res.status(401).json({
      error: "Authentication required. Every player must be logged in to accept challenge bets.",
      code: "AUTH_REQUIRED",
    });
  }
  const room = activeRooms.find((r) => r.id === roomId);
  if (!room || room.status !== "open") {
    return res.status(400).json({ error: "Challenge is no longer available or already matched" });
  }

  // Check if room was created for a specific invited user
  if (room.invitedUsername) {
    const acceptorUsername = (username || mockUsers[userId]?.username || "").trim().toLowerCase().replace(/^@/, "");
    const cleanInvited = room.invitedUsername.trim().toLowerCase().replace(/^@/, "");
    if (acceptorUsername !== cleanInvited) {
      return res.status(403).json({
        error: `🚫 এই ডুয়েল রুমটি শুধুমাত্র @${cleanInvited} এর জন্য নির্ধারিত।`
      });
    }
  }

  if (room.isPrivate) {
    if (!password || room.password !== password) {
      return res.status(400).json({ error: "🚫 ভুল পাসওয়ার্ড! সঠিক পাসওয়ার্ড দিয়ে জয়েন করুন বা জয়েনিং লিঙ্ক ব্যবহার করুন।" });
    }
  }

  if (room.creatorId === userId) {
    return res.status(400).json({ error: "You cannot accept your own challenge. Use 'Cancel & Refund' to cancel it." });
  }

  let requiredAcceptorStake = room.acceptorAmount || Math.round(room.amount * ((room.odds || 2.0) - 1));
  if (customAcceptorStake !== undefined && !isNaN(Number(customAcceptorStake))) {
    const customStakeNum = Number(customAcceptorStake);
    if (room.minStake !== undefined && customStakeNum < room.minStake) {
      return res.status(400).json({ error: `🚫 বাজির পরিমাণ রুম ক্রিয়েটর কর্তৃক নির্ধারিত সর্বনিম্ন বাজি ৳${room.minStake.toLocaleString()} এর কম হতে পারবে না।` });
    }
    if (room.maxStake !== undefined && customStakeNum > room.maxStake) {
      return res.status(400).json({ error: `🚫 বাজির পরিমাণ রুম ক্রিয়েটর কর্তৃক নির্ধারিত সর্বোচ্চ বাজি ৳${room.maxStake.toLocaleString()} এর বেশি হতে পারবে না।` });
    }
    requiredAcceptorStake = Math.round(customStakeNum);
  }

  const acceptor = mockUsers[userId];
  if (acceptor.balance < requiredAcceptorStake) {
    return res.status(400).json({ error: `Insufficient balance to accept duel. Required stake: ৳${requiredAcceptorStake.toLocaleString()} chips.` });
  }

  // Deduct stake from acceptor balance
  acceptor.balance -= requiredAcceptorStake;
  room.acceptorId = userId;
  room.acceptorName = username || acceptor.username;
  room.status = "matched";
  room.capacityPercent = 100;
  room.lastActiveAt = new Date().toISOString();
  room.activityScore = Math.min(100, (room.activityScore || 50) + 35);

  const seed = generateServerSeed();
  const cards = deriveCards(seed, "p2p_duel", Date.now());
  
  room.dragonCard = cards.dragonCard;
  room.tigerCard = cards.tigerCard;
  room.winner = cards.result.toLowerCase() as "dragon" | "tiger" | "tie";

  // If 1v1 Quick Challenge, settle immediately with 5% company rake
  if (room.isSingleRoundQuickChallenge) {
    const totalPot = room.amount + requiredAcceptorStake;
    const companyFee = Math.round(totalPot * 0.05); // Strict 5% profit for company
    const winnerPayout = totalPot - companyFee;
    const creatorUser = mockUsers[room.creatorId];

    metrics.todayCommission += companyFee;
    metrics.todayMatchedVolume += totalPot;

    if (room.winner === "tie") {
      // Tie Rule: Company captures tie pot
      metrics.todayTieRevenue += totalPot;
      room.status = "completed";
    } else {
      const creatorWon = (room.winner === "dragon" && room.choice === "dragon") || (room.winner === "tiger" && room.choice === "tiger");
      if (creatorWon && creatorUser) {
        creatorUser.balance += winnerPayout;
        creatorUser.totalWon += (winnerPayout - room.amount);
        creatorUser.transactions.unshift({
          id: `tx_quick_win_${Date.now()}`,
          type: "win",
          amount: winnerPayout,
          timestamp: new Date().toISOString(),
          description: `Won 1v1 Quick Challenge Pot: +৳${winnerPayout.toLocaleString()} (5% House Rake: ৳${companyFee.toLocaleString()})`,
        });
      } else {
        acceptor.balance += winnerPayout;
        acceptor.totalWon += (winnerPayout - requiredAcceptorStake);
        acceptor.transactions.unshift({
          id: `tx_quick_win_${Date.now()}`,
          type: "win",
          amount: winnerPayout,
          timestamp: new Date().toISOString(),
          description: `Won 1v1 Quick Challenge Pot: +৳${winnerPayout.toLocaleString()} (5% House Rake: ৳${companyFee.toLocaleString()})`,
        });
      }
      room.status = "completed";
    }
  }

  const creatorRole = room.choice.toUpperCase() as "DRAGON" | "TIGER";
  const acceptorRole = creatorRole === "DRAGON" ? "TIGER" : "DRAGON";

  const creatorUser = mockUsers[room.creatorId];
  const creatorElo = creatorUser?.cosmetics?.eloRating || 1200;
  const acceptorElo = acceptor?.cosmetics?.eloRating || 1200;

  // Initialize fully stateful real-time duel state
  activeDuels[roomId] = {
    id: roomId,
    status: "ROLE_COIN_FLIP",
    tier: room.amount < 500 ? "Express" : room.amount < 2000 ? "Classic" : "VIP",
    creatorId: room.creatorId,
    creatorName: room.creatorName,
    creatorRole,
    creatorCard: creatorRole === "DRAGON" ? cards.dragonCard : cards.tigerCard,
    creatorBet: room.amount,
    creatorPeeked: false,
    creatorElo,
    
    acceptorId: userId,
    acceptorName: room.acceptorName || acceptor.username || "Opponent",
    acceptorRole,
    acceptorCard: acceptorRole === "DRAGON" ? cards.dragonCard : cards.tigerCard,
    acceptorBet: requiredAcceptorStake,
    acceptorPeeked: false,
    acceptorElo,
    
    currentPot: room.amount + requiredAcceptorStake,
    currentRaise: Math.max(room.amount, requiredAcceptorStake),
    bettingRound: 1,
    turnUser: "DRAGON",
    secondsRemaining: 15,
    raisesCount: 0,
    lastUpdated: Date.now(),
  };

  broadcast({ type: "ROOM_RESOLVED", room, duel: activeDuels[roomId] });
  res.json({ success: true, room, duel: activeDuels[roomId] });
});

// ============================================================================
// STATEFUL MULTIPLAYER 1v1 DUEL ENDPOINTS
// ============================================================================
app.get("/api/rooms/duel/:roomId", (req, res) => {
  const { roomId } = req.params;
  const { userId } = req.query;
  
  const duel = activeDuels[roomId];
  if (!duel) {
    const room = activeRooms.find(r => r.id === roomId);
    if (room && room.status === "completed") {
      return res.json({
        id: roomId,
        status: "SETTLED",
        winnerRole: room.winner?.toUpperCase(),
        dragonPlayer: { userId: room.choice === "dragon" ? room.creatorId : room.acceptorId, card: room.dragonCard },
        tigerPlayer: { userId: room.choice === "tiger" ? room.creatorId : room.acceptorId, card: room.tigerCard },
      });
    }
    return res.status(404).json({ error: "Active duel not found or expired" });
  }
  
  const responseState = { ...duel };
  
  // Clean-room card obscurity mapping: Keep opponent card invisible before Showdown
  const isCreator = userId === duel.creatorId;
  const isAcceptor = userId === duel.acceptorId;
  
  if (duel.status !== "SHOWDOWN" && duel.status !== "SETTLED") {
    if (isCreator) {
      if (duel.creatorRole === "DRAGON") {
        responseState.acceptorCard = undefined as any;
      } else {
        responseState.acceptorCard = undefined as any;
      }
    } else if (isAcceptor) {
      if (duel.acceptorRole === "DRAGON") {
        responseState.creatorCard = undefined as any;
      } else {
        responseState.creatorCard = undefined as any;
      }
    } else {
      responseState.creatorCard = undefined as any;
      responseState.acceptorCard = undefined as any;
    }
  }
  
  res.json(responseState);
});

app.post("/api/rooms/duel/:roomId/peek", (req, res) => {
  const { roomId } = req.params;
  const { userId } = req.body;
  
  const duel = activeDuels[roomId];
  if (!duel) return res.status(404).json({ error: "Duel session not found" });
  
  if (userId === duel.creatorId) {
    duel.creatorPeeked = true;
  } else if (userId === duel.acceptorId) {
    duel.acceptorPeeked = true;
  } else {
    return res.status(403).json({ error: "Access denied. Not a player in this duel." });
  }
  
  if (duel.creatorPeeked && duel.acceptorPeeked && duel.status === "PEEK_CARDS") {
    duel.status = "BETTING";
    duel.turnUser = "DRAGON";
    duel.secondsRemaining = 15;
    broadcast({ type: "DUEL_STATE_CHANGE", roomId: duel.id, status: "BETTING" });
  }
  
  duel.lastUpdated = Date.now();
  res.json(duel);
});

app.post("/api/rooms/duel/:roomId/action", (req, res) => {
  const { roomId } = req.params;
  const { userId, action } = req.body;
  
  const duel = activeDuels[roomId];
  if (!duel) return res.status(404).json({ error: "Duel session not found" });
  if (duel.status !== "BETTING") return res.status(400).json({ error: "Duel is not in betting phase" });
  
  const isCreator = userId === duel.creatorId;
  const isAcceptor = userId === duel.acceptorId;
  if (!isCreator && !isAcceptor) return res.status(403).json({ error: "Forbidden" });
  
  const activeRole = isCreator ? duel.creatorRole : duel.acceptorRole;
  if (duel.turnUser !== activeRole) {
    return res.status(400).json({ error: "Not your turn to act" });
  }
  
  const user = mockUsers[userId];
  if (!user) return res.status(404).json({ error: "User wallet not found" });
  
  const userBet = isCreator ? duel.creatorBet : duel.acceptorBet;
  
  if (action === "FOLD") {
    settleDuelOnFold(duel, userId);
    broadcast({ type: "DUEL_STATE_CHANGE", roomId: duel.id, status: "SETTLED" });
    return res.json(duel);
  }
  
  let additionalCost = 0;
  let nextRaiseVal = duel.currentRaise;
  
  if (action === "RAISE_2X") {
    additionalCost = duel.creatorBet + duel.acceptorBet; // raise by pot amount
    nextRaiseVal = userBet + additionalCost;
  } else if (action === "RAISE_3X") {
    additionalCost = (duel.creatorBet + duel.acceptorBet) * 1.5;
    nextRaiseVal = userBet + additionalCost;
  } else if (action === "ALL_IN") {
    additionalCost = user.balance;
    nextRaiseVal = userBet + additionalCost;
  } else if (action === "CALL") {
    additionalCost = duel.currentRaise - userBet;
  } else if (action === "CHECK") {
    if (userBet !== duel.currentRaise) {
      return res.status(400).json({ error: "Cannot check. Bets must be equal." });
    }
  }
  
  if (user.balance < additionalCost) {
    return res.status(400).json({ error: `Insufficient balance. Action cost is ৳${additionalCost.toLocaleString()} but you have ৳${user.balance.toLocaleString()}.` });
  }
  
  user.balance -= additionalCost;
  
  const updatedUserBet = userBet + additionalCost;
  if (isCreator) {
    duel.creatorBet = updatedUserBet;
    duel.creatorAction = action;
  } else {
    duel.acceptorBet = updatedUserBet;
    duel.acceptorAction = action;
  }
  
  duel.currentPot += additionalCost;
  duel.currentRaise = Math.max(duel.currentRaise, updatedUserBet);
  
  if (action.includes("RAISE")) {
    duel.raisesCount += 1;
  }
  
  const otherRole = activeRole === "DRAGON" ? "TIGER" : "DRAGON";
  const creatorHasActed = duel.creatorAction !== undefined;
  const acceptorHasActed = duel.acceptorAction !== undefined;
  
  if (creatorHasActed && acceptorHasActed && duel.creatorBet === duel.acceptorBet) {
    if (duel.bettingRound < 2 && duel.raisesCount < 3) {
      duel.bettingRound += 1;
      duel.creatorAction = undefined;
      duel.acceptorAction = undefined;
      duel.turnUser = "DRAGON";
      duel.secondsRemaining = 15;
    } else {
      duel.status = "SHOWDOWN";
      duel.secondsRemaining = 3;
      broadcast({ type: "DUEL_STATE_CHANGE", roomId: duel.id, status: "SHOWDOWN" });
    }
  } else {
    duel.turnUser = otherRole;
    duel.secondsRemaining = 15;
  }
  
  duel.lastUpdated = Date.now();
  broadcast({ type: "DUEL_ACTION", roomId: duel.id, duel });
  res.json(duel);
});

app.post("/api/rooms/cancel", (req, res) => {
  const { roomId, userId } = req.body;
  if (!userId || typeof userId !== "string" || !mockUsers[userId]) {
    return res.status(401).json({
      error: "Authentication required",
      code: "AUTH_REQUIRED",
    });
  }

  const roomIndex = activeRooms.findIndex((r) => r.id === roomId && r.creatorId === userId && r.status === "open");
  if (roomIndex === -1) {
    return res.status(400).json({ error: "Open challenge not found or already matched" });
  }

  const room = activeRooms[roomIndex];
  activeRooms.splice(roomIndex, 1);

  const user = mockUsers[userId];
  if (user) {
    user.balance += room.amount;
    user.transactions.unshift({
      id: `tx_room_cancel_${Date.now()}`,
      type: "refund",
      amount: room.amount,
      timestamp: new Date().toISOString(),
      description: `P2P Challenge Cancelled: ৳${room.amount.toLocaleString()} 100% refunded to wallet`,
    });
  }

  broadcast({ type: "ROOM_CANCELLED", roomId });

  // Sync cancelled room in history
  const histRoom = p2pRoomsHistory.find(r => r.id === roomId);
  if (histRoom) {
    histRoom.status = "cancelled" as any;
  }

  res.json({ success: true, refundedAmount: room.amount, user });
});

// GET /api/rooms/history/:userId - Retrieves all private room challenges history for a user
app.get("/api/rooms/history/:userId", (req, res) => {
  const { userId } = req.params;
  const history = p2pRoomsHistory.filter(
    (r) => r.creatorId === userId || r.acceptorId === userId
  );
  res.json(history);
});

// 8. Leaderboard
app.get("/api/leaderboard", (req, res) => {
  const sortBy = req.query.sortBy as string; // 'streak' or 'profit'
  const list = Object.values(mockUsers)
    .map((u) => {
      const stats = ensureUserStats(u);
      const streak = Math.max(stats.currentStreak || 0, 0);
      let streakTier: "warm" | "hot" | "fire" | "unstoppable" | "godlike" = "warm";
      if (streak >= 10) streakTier = "godlike";
      else if (streak >= 7) streakTier = "unstoppable";
      else if (streak >= 5) streakTier = "fire";
      else if (streak >= 3) streakTier = "hot";

      return {
        userId: u.userId,
        username: u.username,
        balance: u.balance,
        profit: u.totalWon - u.totalLost,
        winRate: u.gamesPlayed > 0 ? Math.round((u.totalWon / (u.totalWon + u.totalLost || 1)) * 100) : 50,
        gamesPlayed: u.gamesPlayed,
        currentStreak: streak,
        bestStreak: Math.max(stats.bestStreak || streak, streak),
        streakTier,
      };
    })
    .sort((a, b) => {
      if (sortBy === "streak") {
        return (b.currentStreak || 0) - (a.currentStreak || 0) || b.profit - a.profit;
      }
      return b.profit - a.profit;
    });
  res.json(list);
});

// 8b. Full Site Liquidity & All Users Transparency Ledger
app.get(["/api/site/liquidity", "/api/transparency"], (_req, res) => {
  let totalRealBalance = 0;
  let totalDemoBalance = 0;
  let totalLockedEscrow = 0;

  // Calculate table active bets
  Object.values(tables).forEach((t) => {
    t.playerBets.forEach((b) => {
      if (b.status === "ACTIVE") {
        totalLockedEscrow += b.amount;
      }
    });
  });

  // Calculate P2P open rooms escrow
  activeRooms.forEach((r) => {
    if (r.status === "open") {
      totalLockedEscrow += r.amount;
    }
  });

  const userList: UserBalanceRecord[] = Object.values(mockUsers).map((u, idx) => {
    totalRealBalance += u.balance;
    totalDemoBalance += u.demoBalance;

    // Check if user currently has an active in-play bet
    let userActiveEscrow = 0;
    Object.values(tables).forEach((t) => {
      t.playerBets.forEach((b) => {
        if (b.userId === u.userId && b.status === "ACTIVE") {
          userActiveEscrow += b.amount;
        }
      });
    });

    const isOnline = true;
    const status: "ACTIVE" | "IN_GAME" | "IDLE" = userActiveEscrow > 0 ? "IN_GAME" : idx % 2 === 0 ? "ACTIVE" : "IDLE";

    return {
      userId: u.userId,
      username: u.username,
      vipTier: "Standard",
      balance: u.balance,
      demoBalance: u.demoBalance,
      lockedBalance: userActiveEscrow,
      totalWon: u.totalWon,
      totalLost: u.totalLost,
      netProfit: u.totalWon - u.totalLost,
      gamesPlayed: u.gamesPlayed,
      kycStatus: u.kycStatus,
      isOnline,
      status,
      lastActive: new Date(Date.now() - idx * 45000).toISOString(),
    };
  });

  // Sort by balance descending
  userList.sort((a, b) => b.balance - a.balance);

  const totalSiteLiquidity = totalRealBalance + totalLockedEscrow;

  const totalActivePlayers = wss.clients.size;

  const responseData: SiteLiquidityData = {
    totalSiteLiquidity,
    totalRealBalance,
    totalDemoBalance,
    totalEscrowLocked: totalLockedEscrow,
    totalUsersCount: userList.length,
    activeOnlineCount: totalActivePlayers,
    todayMatchedVolume: metrics.todayMatchedVolume,
    todayCommission: metrics.todayCommission,
    todayTieRevenue: metrics.todayTieRevenue,
    telemetry: {
      totalActivePlayers,
      tps: 0,
      latencyMs: 12,
      activeNode: "AP-SOUTH-1 (Dhaka/Kolkata Primary Edge)",
      shoeRemainingCards: 416,
      shoeTotalCards: 416,
      burnCardsCount: 0,
      dealerName: "Live Dealer",
      dealerTableCode: "DT-LIVE-01",
      betsPerSecond: 0,
      todayGlobalTurnover: metrics.todayMatchedVolume,
    },
    tableLiquidity: {
      express: {
        pool: (tables["express"]?.currentRound.dragonPool || 0) + (tables["express"]?.currentRound.tigerPool || 0),
        matched: tables["express"]?.currentRound.matchedAmount || 0,
        players: (tables["express"]?.currentRound.dragonPlayers || 0) + (tables["express"]?.currentRound.tigerPlayers || 0),
      },
      classic: {
        pool: (tables["classic"]?.currentRound.dragonPool || 0) + (tables["classic"]?.currentRound.tigerPool || 0),
        matched: tables["classic"]?.currentRound.matchedAmount || 0,
        players: (tables["classic"]?.currentRound.dragonPlayers || 0) + (tables["classic"]?.currentRound.tigerPlayers || 0),
      },
      vip: {
        pool: (tables["vip"]?.currentRound.dragonPool || 0) + (tables["vip"]?.currentRound.tigerPool || 0),
        matched: tables["vip"]?.currentRound.matchedAmount || 0,
        players: (tables["vip"]?.currentRound.dragonPlayers || 0) + (tables["vip"]?.currentRound.tigerPlayers || 0),
      },
    },
    users: userList,
    timestamp: new Date().toISOString(),
  };

  res.json(responseData);
});

// ============================================================================
// P2P ENHANCEMENTS: CAPACITY TRENDS, REPORTS & TABLE PING
// ============================================================================
app.get("/api/p2p/capacity-trends", (_req, res) => {
  const now = new Date();
  const points: CapacityTrendPoint[] = [];
  const basePlayers = Math.max(activeRooms.length * 4, 38);

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 10 * 60 * 1000);
    const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const wave = Math.sin((d.getMinutes() / 60) * Math.PI * 2) * 16;
    const players = Math.max(12, Math.round(basePlayers + wave + (i % 2 === 0 ? 9 : -5)));
    const activeR = Math.max(2, Math.round(players / 4));
    const capacityPct = Math.min(96, Math.max(38, Math.round((players / (activeR * 6)) * 100)));
    points.push({
      time: timeStr,
      players,
      capacityPct,
      activeRooms: activeR,
    });
  }
  res.json({ success: true, points });
});

app.post("/api/reports/submit", (req, res) => {
  const { reporterUserId, reporterUsername, reportedUserId, reportedUsername, reason, details } = req.body;
  if (!reporterUserId || !reportedUserId || !reason) {
    return res.status(400).json({ error: "Missing required report information." });
  }
  const report: PlayerReport = {
    id: `rep_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    reporterUserId,
    reporterUsername: reporterUsername || "Anonymous",
    reportedUserId,
    reportedUsername: reportedUsername || "Unknown Player",
    reason,
    details: details || "",
    timestamp: new Date().toISOString(),
    status: "PENDING",
  };
  playerReports.unshift(report);
  broadcast({
    type: "PLAYER_REPORTED",
    report: {
      id: report.id,
      reportedUsername: report.reportedUsername,
      reason: report.reason,
      timestamp: report.timestamp,
    },
  });
  res.json({
    success: true,
    message: `Player @${report.reportedUsername} successfully reported for '${reason}'. Security review team notified.`,
    report,
  });
});

app.get("/api/reports", (_req, res) => {
  res.json({ success: true, reports: playerReports });
});

app.post("/api/rooms/:roomId/ping", (req, res) => {
  const { roomId } = req.params;
  const { userId, username } = req.body;
  broadcast({
    type: "ROOM_PING",
    roomId,
    userId,
    username: username || "Player",
    timestamp: new Date().toISOString(),
  });
  res.json({ success: true, message: "Ping sent to table" });
});

// 8c. Live High Load System Telemetry
app.get("/api/system/telemetry", (_req, res) => {
  const totalActivePlayers = Math.max(wss.clients.size, 1);

  // Real active bettor/player counts on tables
  const expressBettors = (tables["express"]?.currentRound.dragonPlayers || 0) + (tables["express"]?.currentRound.tigerPlayers || 0);
  const classicBettors = (tables["classic"]?.currentRound.dragonPlayers || 0) + (tables["classic"]?.currentRound.tigerPlayers || 0);
  const vipBettors = (tables["vip"]?.currentRound.dragonPlayers || 0) + (tables["vip"]?.currentRound.tigerPlayers || 0);

  let expressActive = expressBettors;
  let classicActive = classicBettors;
  let vipActive = vipBettors;

  const totalBettors = expressBettors + classicBettors + vipBettors;
  if (totalBettors < totalActivePlayers) {
    const unplaced = totalActivePlayers - totalBettors;
    classicActive += unplaced;
  }

  res.json({
    totalActivePlayers,
    tableActivePlayers: {
      express: expressActive,
      classic: classicActive,
      vip: vipActive,
    },
    tableLimits: {
      express: { minBet: 10, maxBet: 1000 },
      classic: { minBet: 100, maxBet: 10000 },
      vip: { minBet: 1000, maxBet: 100000 },
    },
    tps: 0,
    latencyMs: 12,
    activeNode: "AP-SOUTH-1 (Dhaka/Kolkata Primary Edge)",
    shoeRemainingCards: 416,
    shoeTotalCards: 416,
    burnCardsCount: 0,
    dealerName: "Live Dealer",
    dealerTableCode: "DT-LIVE-01",
    betsPerSecond: 0,
    todayGlobalTurnover: metrics.todayMatchedVolume,
    regionalNodes: [
      { code: "BGD-DHK-01", location: "Dhaka, Bangladesh", status: "ONLINE", ping: "11ms", load: "0%" },
      { code: "IND-CCU-02", location: "Kolkata, India", status: "ONLINE", ping: "14ms", load: "0%" },
      { code: "SGP-CEN-01", location: "Singapore Central", status: "ONLINE", ping: "28ms", load: "0%" },
      { code: "UAE-DXB-01", location: "Dubai, UAE", status: "ONLINE", ping: "42ms", load: "0%" },
      { code: "GBR-LON-01", location: "London, UK", status: "ONLINE", ping: "68ms", load: "0%" },
    ]
  });
});

// Complete Database Clean & Zero Reset Endpoint
app.post("/api/database/reset", (_req, res) => {
  // 1. Wipe all credentials and mock users
  for (const key of Object.keys(userCredentials)) delete userCredentials[key];
  for (const key of Object.keys(mockUsers)) delete mockUsers[key];
  for (const key of Object.keys(userBetHistories)) delete userBetHistories[key];
  for (const key of Object.keys(userReferralData)) delete userReferralData[key];
  for (const key of Object.keys(referralCodeToUser)) delete referralCodeToUser[key];
  for (const key of Object.keys(userReferrerMap)) delete userReferrerMap[key];

  // 2. Wipe public financial ledger and messages
  globalTransactions.length = 0;
  chatMessages.length = 0;
  activeRooms.length = 0;

  // 3. Zero all system metrics
  metrics.todayMatchedVolume = 0;
  metrics.todayCommission = 0;
  metrics.todayTieRevenue = 0;
  metrics.totalRoundsPlayed = 0;
  metrics.activeDeposits = 0;
  metrics.activeWithdrawals = 0;

  // 4. Reset table runtime pools to 0
  Object.values(tables).forEach((tbl) => {
    tbl.playerBets = [];
    tbl.recentSettledBets = [];
    tbl.currentRound.dragonPool = 0;
    tbl.currentRound.tigerPool = 0;
    tbl.currentRound.matchedAmount = 0;
    tbl.currentRound.dragonPlayers = 0;
    tbl.currentRound.tigerPlayers = 0;
  });

  broadcast({
    type: "DATABASE_RESET",
    message: "All databases and user data have been completely wiped and reset to 0.",
    timestamp: new Date().toISOString(),
  });

  res.json({
    success: true,
    message: "All databases, user records, transactions, bets, and metrics have been cleaned and set to 0.",
    status: "ZERO_DATABASE",
  });
});

// 9. AI Dealer commentary
app.post("/api/ai-dealer", async (req, res) => {
  const { lastWinner, tableSlug } = req.body;
  const ai = getGeminiClient();

  if (!ai) {
    return res.json({
      commentary: `Cards shuffled on the ${tableSlug.toUpperCase()} arena. Fortune favors the daring. Last win went to ${lastWinner || "Dragon"}!`,
    });
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `You are an elite, charismatic Asian casino dealer for Dragon Tiger P2P. Provide one punchy, exciting casino sentence for players placing bets. Last round winner: ${lastWinner || "Dragon"}. Keep it high energy.`,
    });
    res.json({ commentary: response.text });
  } catch {
    res.json({
      commentary: "Cards are in play! Will the Dragon roar or will the Tiger strike? Place your bets!",
    });
  }
});

// 10. Safeguard: API 404 and Global Error Catchers (Ensures all /api requests return JSON, never HTML)
app.use("/api", (req, res) => {
  res.status(404).json({ success: false, error: `API route not found: ${req.originalUrl}` });
});

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.originalUrl && req.originalUrl.startsWith("/api")) {
    console.error("API Exception:", err);
    return res.status(500).json({ error: err?.message || "Internal server error" });
  }
  next(err);
});

// ============================================================================
// SERVER STARTUP & VITE INTEGRATION
// ============================================================================
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Dragon Tiger P2P Server running on http://localhost:${PORT}`);
  });
}

startServer();
