import fs from 'fs';
import { Keypair, Connection } from '@solana/web3.js';
import { YellowstoneIngestionEngine } from "./grpcStream.js";
import { AutonomousBountyAgent } from "./aiAgent.js";
import * as dotenv from "dotenv";

dotenv.config();

// Ensure our demo simulation controls are primed for the run execution loop
process.env.DEMO_MODE = "true";

// Pointing to Devnet infrastructure for stable simulation passes
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

function loadWallet(): Keypair {
  try {
    const secretKeyString = fs.readFileSync('my-wallet.json', 'utf8');
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secretKeyString)));
  } catch (err) {
    console.error("[CRITICAL] Failed to load wallet. Ensure my-wallet.json exists.");
    process.exit(1);
  }
}

async function runProductionStack() {
  console.log("=================================================================");
  console.log("[BOOT] INITIALIZING AUTONOMOUS TRANSACTION INFRASTRUCTURE PIPELINE");
  console.log("=================================================================");

  const wallet = loadWallet();
  const streamEngine = new YellowstoneIngestionEngine();
  const agent = new AutonomousBountyAgent(wallet);

  await streamEngine.initPipeline();
  
  let isProcessing = false;
  let cycleCount = 1;
  const MAX_CYCLES = 10;

  console.log("[BOOT] Telemetry ingestion active. Waiting for slot triggers... \n");

  const slotListener = async (slotData: any) => {
    // Break or detach listeners once our target metric run horizon is finalized
    if (cycleCount > MAX_CYCLES) {
      console.log(`\n[SHUTDOWN] Completed target iteration footprint (${MAX_CYCLES}/${MAX_CYCLES} Cycles). Closing pipeline infrastructure.`);
      streamEngine.off('slot', slotListener);
      process.exit(0);
    }

    // Process target cycles spaced across slot tick increments
    if (slotData.slot % 10 !== 0) return;

    if (isProcessing) return;
    isProcessing = true;

    try {
      console.log(`\n[CYCLE] --- Processing Runtime Operational Thread #${cycleCount} ---`);
      
      const cachedTipCount = streamEngine.telemetry?.recentJitoTips?.length || 0;
      const dummyTipHistoryArray = Array.from({ length: cachedTipCount || 5 }, () => 10000);
      
      console.table({
        "Slot": slotData.slot,
        "Tips Cached": cachedTipCount,
        "Cycle ID": cycleCount,
        "System": "AI Autonomous Drive Mode"
      });

      // DELEGATE RUN ENTIRELY TO THE AI AGENT:
      // This activates the internal retry pipelines, fault injections, and AI reasoning blocks.
      await agent.executeFaultInjectionRun(dummyTipHistoryArray);

    } catch (e: any) {
      console.error("[CRITICAL] Pipeline cycle failed:", e.message);
    } finally {
      isProcessing = false;
      cycleCount++;
    }
  };

  streamEngine.on('slot', slotListener);
}

process.on("unhandledRejection", (reason) => {
  console.error("[CRITICAL] Unhandled Rejection at Pipeline Level:", reason);
});

runProductionStack();