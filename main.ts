import fs from 'fs';
import { Keypair } from '@solana/web3.js';
import { YellowstoneIngestionEngine } from "./grpcStream.js";
import { AutonomousBountyAgent } from "./aiAgent.js";


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

  console.log("[BOOT] Telemetry ingestion active. Waiting for slot triggers...");

  
  streamEngine.on('slot', async (slotData: any) => {
   
    if (slotData.slot % 20 !== 0) return;

   
    if (isProcessing) return;

    isProcessing = true;
    try {
      console.log(`\n[CYCLE] --- Processing Runtime Operational Thread #${cycleCount} ---`);
      
      const currentTips = streamEngine.telemetry.recentJitoTips.length > 0 
        ? streamEngine.telemetry.recentJitoTips 
        : [1000];
      
      console.table({
        "Slot": slotData.slot,
        "Tips Cached": currentTips.length,
        "Cycle ID": cycleCount,
        "System": "Healthy"
      });

     
      await agent.executeFaultInjectionRun(currentTips);
      
      console.log(`[STATUS] Cycle #${cycleCount} completed successfully.`);
    } catch (e: any) {
      console.error("[CRITICAL] Pipeline cycle failed:", e.message);
    } finally {
     
      isProcessing = false;
      cycleCount++;
    }
  });
}

// Global safety net for process-wide errors
process.on("unhandledRejection", (reason) => {
  console.error("[CRITICAL] Unhandled Rejection:", reason);
});

// Bootstrapping the infrastructure
runProductionStack();