# CODING ARCHITECTURE & FRONTEND STANDARDS

## Overview
APEX Dragon Tiger is structured as a Vite + React + Express full-stack single-page application (SPA).

## Directory Structure
```
/
├── server.ts                       # Express backend server with WebSocket server & game loop
├── src/
│   ├── main.tsx                    # React client entry point
│   ├── App.tsx                     # Top-level state coordinator & tab switcher
│   ├── index.css                   # Global Tailwind CSS imports & custom animations
│   ├── config/
│   │   └── version.ts              # Global build constants & build number
│   ├── types/
│   │   └── index.ts                # TypeScript interface definitions & data contracts
│   ├── utils/
│   │   ├── audio.ts                # HTML5 Audio + SpeechSynthesis voice manager
│   │   ├── currency.ts             # Exchange rate converter & currency formatter
│   │   └── useSoundManager.ts      # Custom React hook for ambient audio & SFX
│   └── components/
│       ├── Navbar.tsx              # Responsive top bar with table selector & balance display
│       ├── MobileBottomNav.tsx     # Fixed bottom navigation bar for mobile devices
│       ├── SideNavDrawer.tsx       # Comprehensive drawer for audio, language, & shortcuts
│       ├── GameTable.tsx           # Live Dragon Tiger card table, Smart Chips grid, & Auto Bet Engine 2.0
│       ├── OneOnOneArena.tsx       # 1v1 P2P duel lobby, private rooms, & active duel table
│       ├── WalletModal.tsx         # Deposit, withdraw, send money, & public ledger modal
│       ├── UserProfileModal.tsx    # Cosmetics, frames, card skins, ELO rank, & stats
│       ├── Leaderboard.tsx         # High rollers, ELO rankers, & daily streak rankings
│       ├── RegulatoryFooter.tsx    # Official licenses, SSL badges, & build number display
│       └── ...                     # Additional utility modals
```

## Styling & Theme Constitution
- **Colors**:
  - Background: Dark Navy/Charcoal `#080B11`, `#0C1019`, `#121826`
  - Dragon Side: Electric Blue `#3B82F6`, `#1D4ED8`
  - Tiger Side: Crimson Red `#EF4444`, `#B91C1C`
  - Accent/Glow: Gold Amber `#F59E0B`, `#FBBF24`
  - Auto Bet Glow: Electric Cyan `#06B6D4`, `#0891B2`
- **Tailwind Utility Classes**:
  - `@import "tailwindcss";` in `index.css`
  - Custom scrollbars (`no-scrollbar`)
  - Backdrops: `backdrop-blur-xl bg-[#0B0E14]/95`

## Smart Chips Grid & Betting Mechanics
- **Responsive Smart Chips Grid**: 4 columns on mobile, 8 columns on desktop (`grid grid-cols-4 sm:grid-cols-8`).
- **Room-Tailored Presets**: Express (Min ৳1), Classic (Min ৳10), VIP (Min ৳100).
- **1-Tap Action Bar**: `MIN`, `1/2`, `2X`, `+Inc`, `MAX` buttons for instant chip scaling.

## Pro Auto Bet Engine 2.0
- **Automated Strategies**:
  - `FLAT`: Fixed stake every round.
  - `MARTINGALE`: 2X stake on loss (loss recovery mechanism).
  - `ANTI_MARTINGALE`: 2X stake on win (streak capitalization).
  - `ALTERNATE`: Switches target side every round (Dragon ↔ Tiger).
  - `STREAK_CHASER`: Follows winning side streak.
- **Risk Safeguards**: Take Profit target, Stop Loss threshold, Stop on Single Win/Loss.
- **Session HUD**: Live P/L tracking, win/loss counter, next stake indicator, 1-tap emergency stop.
