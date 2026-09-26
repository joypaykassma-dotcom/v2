# CASINO BETTING STRATEGY & RISK MANAGEMENT

## Automated Betting Strategies

### 1. Flat Staking (`FLAT`)
- Keeps stake fixed at the base amount every round. Ideal for low-variance session play.

### 2. Martingale (`MARTINGALE`)
- Automatically doubles stake after a loss to recover all previous losses and gain a net 1-unit profit upon the next win.
- Resets back to base stake immediately after a win.
- Safety cap protects wallet from exceeding max table limits.

### 3. Anti-Martingale (`ANTI_MARTINGALE`)
- Automatically doubles stake after a win to maximize streak gains during winning runs.
- Resets back to base stake upon a loss to preserve capital.

### 4. Alternate Side (`ALTERNATE`)
- Automatically switches target side every round (Dragon → Tiger → Dragon → Tiger).

### 5. Streak Chaser (`STREAK_CHASER`)
- Follows the winning streak by setting the target side to match the last round's winner.

## Risk Control Rules
- **Take Profit Target**: Automatically stops auto bet when total session profit reaches target amount.
- **Stop Loss Threshold**: Automatically stops auto bet if total session loss hits stop loss limit.
- **Stop on Win / Loss**: Stops on first win or first loss.
