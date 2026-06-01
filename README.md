##  SOLTRIAGE Transaction Stack
[Link to the Public Architecture Document](https://docs.google.com/document/d/1e579iiSzZdIHWB5HvCcLd5gn5PI_sUCDI29QqxMgorA/edit?usp=sharing)

A smart transaction manager built for Solana that helps trades land faster and cheaper. It listens directly to the network's live data feed to track market congestion and see exactly what people are paying in Jito tips. Using that real-time info, it automatically calculates the perfect tip amount to get your transactions processed without overpaying. If a transaction ever fails or drops along the way, an embedded AI agent instantly steps in, figures out what went wrong, and fixes it on the fly so it can retry immediately.

## System Architecture and Mechanics

The system is built to multitask. It splits the heavy lifting into separate processing threads, allowing it to comfortably track fast-moving network data in the background while simultaneously running its automated error-fixing loops without missing a beat.

       [Solana Cluster] (wss://api.devnet.solana.com)
              │
              ▼ (Live Slot Ticks and Telemetry)
       ┌──────────────┐
       │ grpcStream   │ ──► Ingests raw cluster state data
       └──────┬───────┘
              │
              ▼
       ┌──────────────┐
       │ jitoEngine   │ ──► Tracks moving median array of tips & sets premiums
       └──────┬───────┘
              │
              ▼
       ┌──────────────┐
       │ aiAgent      │ ──► Intercepts faults, runs cognitive triage, and
       └──────────────┘     reconstructs transactions with optimal lifespans

## To view the real-time cognitive processing loops, mathematical tip escalations, and connection lifecycle management of the engine under simulated cluster drops, see the full production output in lifecycle.log.

## Question 1: What does the delta between processed_at and confirmed_at tell you about network health at the time of submission?

The delta between these two timestamps functions as a real-time health check on validator communication across the cluster. Inside my grpcStream.ts, incoming slots were tracked natively as they stream in. The moment a transaction hits processed_at, it means the active slot leader accepted the Jito bundle and included it in their local block. However, that block isn't secure yet. It only reaches confirmed_at once a supermajority of about (66.6%) of the global validator stake weight votes YES and signs off on it. When I see a tight delta (under 1.5–2 seconds): It tells me the network is perfectly healthy. Validators are highly synchronized, propagating blocks instantly across the globe, and voting without dropping packets. Alao When I see the delta stretch out (4+ seconds): It's a clear sign that the cluster is suffocating. Heavy congestion means validators are struggling to reach consensus, or voting packets are getting choked out in the TPU queue. For my infrastructure stack, a widening delta serves as an immediate warning indicator to scale up my tip premiums because blocks are taking way too long to secure.

## Question 2: Why should you never use finalized commitment when fetching a blockhash for a time-sensitive transaction?

If I were to fetch a blockhash using finalized commitment for a time-sensitive transaction, I would be sabotaging my own execution before the packet leaves my machine. On Solana, a blockhash has a short lifespan, it is only valid for exactly 150 slots (roughly 60 seconds) before the cluster throws it out. For a block to move from processed to a completely irreversible finalized state, it has to survive about 31 consecutive slot confirmations, which burns up 15 to 30 seconds of time. looking at my recovery loop inside aiAgent.ts, the moment my fault injector simulates a blockhash expiry failure, my AI agent purposefully bypasses stale, finalized data and forces a call for a fresh blockhash via: 
           await this.connection.getLatestBlockhash("processed");

If I had used finalized here, the blockhash my code received would had been 31 slots old out of its 150-slot lifespan before my runtime even finished compiling the transaction wrapper. By the time my Jito bundle hits the network and routes to the block engine, any minor cluster hiccup would cause the leader to immediately reject it with an ExpiredBlockhash or BlockhashNotFound error. Using processed guarantees my transaction lands in the leader's queue with the maximum possible lifespan.


## Question 3: What happens to your bundle if the Jito leader skips their slot?

If the scheduled Jito leader skips their assigned slot, my bundle doesn’t get paused, it doesn't get forwarded to the next guy, and it doesn't wait in a queue, it gets instantly dropped and vaporized. Jito bundles are fragile, real-time agreements tied to a specific block-producer. They only function because a particular validator running the Jito-Solana client was scheduled to build a block at a precise slot window and agreed to execute bundled transactions in exchange for a tip. If that leader drops offline, experiences hardware panic, or suffers clock drift, that slot is marked as "skipped" and no block is built.  Because a bundle cannot cross over leader boundaries, the Jito block engine completely discards my payload. This structural reality is exactly why I built the orchestration loop the way I did inside main.ts. My stack doesn't just fire a bundle into the dark and pray, rather my stream is constantly listening to live slot changes. The second a slot ticks past without an inclusion confirmation, my AutonomousBountyAgent intercepts the 400 rejection log, recognizes that the slot boundary was broken, recalculates a fresh tip target using the moving median array in my jitoEngine.ts, and resubmits within milliseconds to catch the very next available window.

## Lifecycle Log Sample
please see the lifecycle.log file in this repository. It demonstrates 10+ cycles of the AutonomousBountyAgent, capturing:

# Successful path execution.
# Simulated SimulatedPreFlightFailure detection.
# AI-driven tip escalation and recovery.
# Commitment progression from SUBMITTED to FINALIZED

## Installation and Deployment

### 1. Environment Configuration
Create a `.env` file in the root directory of your project (or duplicate and rename `.env.example`):
GRPC_URL=wss://api.devnet.solana.com
SOLANA_RPC_URL=[https://api.devnet.solana.com](https://api.devnet.solana.com)
SOLINFRA_GRPC_URL=[http://127.0.0.1:10000](http://127.0.0.1:10000)
JITO_BLOCK_ENGINE_URL=[https://mainnet.block-engine.jito.wtf/api/v1/bundles](https://mainnet.block-engine.jito.wtf/api/v1/bundles)
GEMINI_API_KEY=your_new_gemini_api_key
DEMO_MODE=true