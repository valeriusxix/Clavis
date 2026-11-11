# Clavis demo video script (1:59)

Follows the outline in AGENT.md 15.2. Every scene is real footage: scenes 2-6 and 8 are the hosted demo
(https://clavisapp.up.railway.app), scene 7 is the screen recording of real mainnet trades #2 and #3 (2026-11-11).
The **caption** is burned into the video. The **voiceover** line is optional, for recording your own voice over it.

| # | Time | Shot | Caption (on screen) | Voiceover (optional) |
|---|---|---|---|---|
| 1 | 0:00-0:07 | Title card | (title card) Trade in private. Prove your PnL in public. Sell the key to your trades. | On-chain traders have two bad options: trade in public and get copied, or trade in private and never prove you're good. |
| 2 | 0:07-0:18 | Leaderboard, slow scroll | Public leaderboard: verified PnL, win rate and trades committed on NEAR. The trades themselves stay hidden. | Clavis fixes that. Everyone sees each trader's verified PnL, but not their trades. |
| 3 | 0:18-0:28 | `quiet-whale` profile: equity curve, locked feed | Every trader's log is hash-chained, and its latest hash is committed to the Clavis contract on NEAR. | Each trader's full trade log is hash-chained, and the latest hash is committed to a NEAR smart contract. |
| 4 | 0:28-0:42 | **Buy key** -> **Use demo account** -> feed unlocks | Buy a key and the full trade feed unlocks. (Demo account: the purchase is simulated, no wallet needed.) | Followers buy a key to unlock the feed. Here a demo account stands in for the wallet. |
| 5 | 0:42-0:53 | **Verify log** -> green checklist | Verify log: your browser rebuilds the hash chain and matches it with the head stored on NEAR testnet. | And anyone with a key can check the history wasn't edited: the browser rebuilds the chain and compares it with the contract. |
| 6 | 0:53-1:09 | **Trade**, Dry run ON, NEAR -> USDC, 1, **Get confidential quote** | Trades run through NEAR Intents' 1Click API with confidentiality: basic. Dry run: a live, signed quote. No funds move. | Trades go through NEAR Confidential Intents. In dry run you get a live, signed 1Click quote. |
| 7a | 1:09-1:22 | Screen recording: Dry run off, wallet connect, quote 1 NEAR -> USDT | Real mode, NEAR mainnet: the trader turns Dry run off and connects their mainnet wallet. / A live confidential quote: 1 NEAR → USDT, under the $4 per-trade cap. | Real mode trades on mainnet: here, one NEAR into USDT. |
| 7b | 1:22-1:28 | Screen recording: HOT Wallet approval | One wallet approval to wrap.near. The output stays in the trader's Confidential Intents balance. | One wallet approval. The output stays in the trader's confidential balance, not sent back on-chain. |
| 7c | 1:28-1:35 | Screen recording: KNOWN_DEPOSIT_TX -> PROCESSING -> SUCCESS | SUCCESS: logged as trade #3, 1Click-signed, and the new hash head is committed on NEAR. | Settled, logged with 1Click's signature, and committed on NEAR. |
| 8 | 1:35-1:51 | `real-trader` profile, unlocked feed | real-trader: 3 real mainnet confidential trades, each carrying 1Click's signed quote. | This trader is real: three mainnet confidential trades, each signed by 1Click. |
| 9 | 1:51-1:59 | End card | (end card) Where NEAR does the work. | NEAR does the private execution, the key sales and the on-chain proof. Clavis, the key to your trades. |

End card text: "Where NEAR does the work: Confidential Intents (1Click) · Rust contract for keys and commitments ·
NEP-413 wallet login", the demo URL and the repo URL (https://github.com/valeriusxix/Clavis).

## Honesty notes (keep them true)

- The demo account's key purchase is simulated; wallet purchases go through `buy_key` on the testnet contract.
- Real trades are on NEAR Intents mainnet; the Clavis contract and its commitments are on NEAR testnet.
- Captions say the *output* stays confidential. Deposits into 1Click are still visible on-chain (README trust model).
