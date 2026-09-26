# APEX CASINO — Codebase & Technical Architecture

This document maps out the system architecture, directory layouts, security flow, and business logic of the **Apex Casino Dragon Tiger P2P** application.

---

## 1. TECHNICAL_BLUEPRINT & STACK
The application is built as a highly responsive, real-time, high-frequency full-stack application using:
- **Frontend SPA**: React with Vite, TypeScript, and Tailwind CSS.
- **Backend Server**: Node.js Express server running concurrently with a Native WebSocket Server (`ws`) to achieve instant P2P state synchronization.
- **Real-Time Engine**: Action broadcasting system over WebSocket channels for live bet placements, game results, chat messages, and private challenges.

---

## 2. DIRECTORY STRUCTURE
```text
├── server.ts                  # Main Express and WebSocket Server Entrypoint
├── src/
│   ├── App.tsx                # Main Router, Authentication, and Modals coordinator
│   ├── types.ts               # Complete TypeScript data model definitions
│   ├── components/
│   │   ├── AdminModal.tsx     # Secure God-Mode Admin Dashboard (No normal login required)
│   │   ├── Navbar.tsx         # Double-row optimized responsive header
│   │   ├── GameTable.tsx      # Core live table wagering arena
│   │   ├── P2PLobby.tsx       # 1v1 P2P Duels listing and setup
│   │   └── RegulatoryFooter.tsx # Footer showing build info & transparency compliance
│   └── index.css              # Global styles with Tailwind CSS directives
└── Architecture.md            # System Architecture and blueprint logs
```

---

## 3. SYSTEM_CODING_LOGIC & SECURITY
- **Admin Authentication Gate**:
  - Located cleanly in `/admin` / `/#/admin`.
  - Does NOT require any standard player registration or login to access.
  - Username: `admin` | Password: `123456`.
  - Handled via client-side routing fallback and session retention (`sessionStorage`) to provide a frictionless but secure workflow.
- **P2P Matching Logic**:
  - Complete matching fund security: Bets are held in a secure state-server-side escrow pool before results are drawn, preventing double-spend or client-side wallet spoofing.
- **Provably Fair Algorithm**:
  - Relies on HMAC-SHA512. The combination of server seed, client seed, and nonce determines the outcome of the Dragon and Tiger cards transparently.
