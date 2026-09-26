# CODING LOGIC & DATA FLOW ARCHITECTURE

## 1. High-Frequency Game Loop & WebSocket Flow
1. **Server Broadcast**: Every 100ms, `server.ts` broadcasts the active round state (`BETTING`, `DEALING`, `SQUEEZING`, `SETTLING`, `COMPLETED`) to connected clients over WebSockets.
2. **Client Sync**: `GameTable.tsx` listens for state transitions and automatically manages timers, card dealing animations, and audio voice prompts.

## 2. Pro Auto Bet Engine 2.0 Automation Logic
```
Round Status == "BETTING" & Seconds > 2
  ├── Read autoBetConfig (Active, Strategy, Base Stake, Current Stake, Side)
  ├── Check Balance >= Current Stake
  ├── Execute Direct Bet on Target Side
  └── Decrement Rounds Remaining & Increment Total Wagered

Round Status == "SETTLING" or "COMPLETED"
  ├── Evaluate Outcome (Win / Loss / Tie)
  ├── Compute Session P/L (+Stake for Win, -Stake for Loss)
  ├── Calculate Next Stake & Target Side:
  │     ├── FLAT: Next Stake = Base Stake
  │     ├── MARTINGALE: Loss → 2X Stake; Win → Reset Base Stake
  │     ├── ANTI_MARTINGALE: Win → 2X Stake; Loss → Reset Base Stake
  │     ├── ALTERNATE: Switch Side (Dragon ↔ Tiger), Base Stake
  │     └── STREAK_CHASER: Set Side = Last Winner, Base Stake
  └── Check Stop Rules:
        ├── Stop on Single Win (if enabled & won)
        ├── Stop on Single Loss (if enabled & lost)
        ├── Profit Target Hit (Total P/L >= Take Profit)
        └── Loss Limit Hit (Total P/L <= -Stop Loss Limit)
```

## 3. Smart Chips Grid & Currency Conversion
- Every chip value is formatted dynamically using `formatCurrency(amt, activeCurrency)`.
- Selecting a chip immediately sets `selectedAmount` and calculates live potential payout (`1.9X`).
- Quick multipliers (`MIN`, `1/2`, `2X`, `MAX`, `+Inc`) compute values without opening soft keyboards.
