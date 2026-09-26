# Prompt & Coding Logic Strategy Guide

This guide details the coding standards, anti-bot measures, UI optimization logic, and strategic development goals of the **Apex Casino** platform.

---

## 1. SYSTEM_CODING_LOGIC
- **No Mock Fallbacks for Admin**: Full, real backend endpoints (`/api/admin/user/balance`, `/api/admin/user/status`, `/api/admin/table/config`) govern state updates.
- **Strict Separation of Concerns**: All financial modifications (such as modifying Real or Demo balance) must update both server-side variables and propagate through polling/WebSockets to ensure immediate data synchronization on the player's interface.
- **Zero Bots Allowed**: 
  - To prevent bot spam, rooms cannot be created in rapid succession (enforced via frequency detection thresholds in `server.ts`).
  - No automated bot balances or fictitious bonuses are coded into the core system ledger.

---

## 2. FRONTEND_DESIGN_CONSTITUTION
- **Responsiveness**: Double-row header layouts ensure crucial navigation controls like settings, mode switch, wallet balances, and menu drawers remain comfortably sized and never overlap or fall outside the screen limits on compact mobile screens.
- **Drawer Containment**: Screen-wide drawer components (`w-[calc(100vw-2.5rem)]`) leave a comfortable left margin of `pl-10` to guarantee that high-density mobile drawers never overflow the horizontal viewport of compact devices.

---

## 3. BUILD NUMBER & DEPLOYMENT
- All page footers, login cards, and administrative console menus must clearly render the active deployment build: **`Build v2.8.4-PRO`** to give operators and developers precise version control details on both public and privileged views.
