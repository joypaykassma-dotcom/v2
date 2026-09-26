# System Coding Logic & Gameplay Strategy

This document outlines the coding patterns, client-side hooks, state synchronization mechanisms, and structural rules implemented in the Apex Dragon Tiger codebase.

## 1. Zero-Bonus & Zero-Bot Rule Compliance
The application enforces strict live player compliance:
- **No Bots Allowed**: All P2P challenges and rooms must be matched and played by real, authenticated accounts. Automated mock/bot endpoints and bypass parameters are prohibited.
- **No Deposit Bonuses**: In accordance with transparent platform rules, there are no synthetic bonuses or artificial signup multipliers. All real balances reflect direct verified deposits or verified peer-to-peer winnings.

---

## 2. Client-Server Synchronization Logic
Real-time state updates are transmitted via a persistent WebSocket connection:
- `NEW_BET`: Emitted when an active player submits a chip wager on either the Dragon, Tiger, or Tie pool.
- `TIMER_TICK`: Emitted every 1 second to update the circular count-down timer in the active game lobby.
- `ROUND_DEALING`: Reveals the cryptographically derived playing cards.
- `ROUND_RESULT`: Broadcasts the settlement outcomes, net profits, and updated roadmap history.

---

## 3. Frontend Architecture (Vite + React)
- **State Management**: React Context / Custom Hooks with persistent LocalStorage sessions.
- **Responsiveness**: Tailwind CSS fluid grid, flexbox layout, and absolute viewport awareness.
- **Sound Manager**: Synthesized vocal cues (in English and Bengali) combined with rich audio triggers for premium, immersive feedback.
