# FULL CODEBASE BLUEPRINT

## Core System Architecture
APEX Dragon Tiger is an enterprise-grade high-frequency casino exchange built for high volume, real-time 1v1 P2P gaming, and Provably Fair single-player tables.

## Primary Codebase Files
- `/server.ts`: Express backend server, WebSocket server, game engine loop, P2P room manager, Provably Fair seed generator.
- `/src/components/GameTable.tsx`: Main game screen featuring interactive dealer canvas, Smart Chips grid, 1-tap increments, and Auto Bet Engine 2.0 with Martingale, Anti-Martingale, Alternate Side, and Streak Chaser strategies.
- `/src/components/OneOnOneArena.tsx`: 1v1 P2P duel arena, room creation, card peeking/squeezing physics, and voice taunts.
- `/src/components/WalletModal.tsx`: Cashier system supporting 40+ fiat and crypto currencies, bKash, Nagad, Rocket, and public ledger auditing.
- `/src/components/RegulatoryFooter.tsx`: Regulatory footer with build version tag `BUILD: v2.8.5-BUILD-2026.09.26.105`.
