# Technical Blueprint: Apex Dragon Tiger Arena

This document details the architectural specifications, cryptographic designs, state machine synchronization protocols, and full P2P matchmaking flow of the Apex Dragon Tiger Arena.

## 1. High-Performance Server-Side Architecture
The backend is a Node.js server written in TypeScript utilizing Express for the HTTP API endpoints and `ws` for high-throughput real-time bid/match broadcasts.

### Key Performance Pillars:
- **Zero-Rake P2P Multiplayer Matching**: Direct player-to-player challenges.
- **Microsecond Latency State Tick**: Pure memory-resident game loops with persistent connection replication.
- **Provably Fair RNG**: Standard HMAC-SHA512 verification system with modulo bias rejection to ensure true random outcomes without trust.

---

## 2. Cryptographic RNG System (Provably Fair)
Rounds are derived server-side prior to active betting using a secure, provable three-variable hash derivation model.

### Derivation Equation:
$$H = \text{HMAC-SHA512}(\text{serverSeed}, \text{clientSeed} + \text{"-"} + \text{nonce})$$

### Modulo Bias Rejection:
To convert the resulting HMAC hash into values from 1 to 13 (representing playing card ranks), we slice the hash into 4-byte integers and apply a rejection threshold to eliminate mathematical bias:
- **Card Values**: Ace (1) to King (13).
- **Tie Resolution**: Tie outcomes capture matched stakes to fuel liquidity/tie-reserve funds.

---

## 3. Matchmaking & Peer-to-Peer 1v1 Arena State Machine
When players create or join private rooms, they enter a stateful real-time synchronized state machine.

```
       [ LOBBY ROOM CREATED ]
                 |
                 v
       [ WAITING FOR OPPONENT ]
                 |
                 v (Player Joins)
      [ ROLE_COIN_FLIP ] (2.5s)
                 |
                 v
       [ PEEK_CARDS ] (20s)
                 |
                 v
        [ BETTING PHASE ] (15s Turn-based)
        /        |        \
       v         v         v
   (Check)    (Call)    (Raise) ---> Max 3 Raises
       \         |         /
        v        v        v
        [ SHOWDOWN STAGE ] (3s)
                 |
                 v
         [ DUEL SETTLED ]
```

---

## 4. Platform Rake & Ledger Compliance
- **Rake Rate**: Fixed 5% of the overall pot for any settled game.
- **Refund Policy**: Unmatched bets are refunded to user wallets instantly upon round closing.
- **Demo Play**: Every user has a free, reloadable 10,000 BDT Demo Chips account.
