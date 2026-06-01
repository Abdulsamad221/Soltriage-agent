import { GoogleGenAI } from "@google/genai";
import { Connection, Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { JitoBundleExecutor } from "./jitoEngine.js";
import * as dotenv from "dotenv";

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export class AutonomousBountyAgent {
  private connection: Connection;
  private jito: JitoBundleExecutor;
  private testingPayer: Keypair;
  private isBusy: boolean = false;
  private failureHistory: any[] = [];

  constructor(wallet: Keypair) {
    const endpoint = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
    this.connection = new Connection(endpoint, {
        commitment: "confirmed",
        wsEndpoint: endpoint.replace("https", "wss")
    });
    this.jito = new JitoBundleExecutor(wallet); 
    this.testingPayer = wallet; 
  }

  public async reasonAboutFailure(errorLog: string): Promise<any> {
    console.log(`[AI] Agent is analyzing error: ${errorLog}`);
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.0-flash",
            contents: `You are a senior Solana infrastructure engineer. 
                        1. Analyze this error: ${errorLog}. 
                        2. Explain your diagnostic reasoning briefly. 
                        3. Finally, return ONLY a JSON object with these keys: 'retry' (boolean), 'newTipMultiplier' (number), 'reason' (string). 
                        Ensure the JSON is the very last part of your response.`
        });

        const rawText = response.text || "";
        console.log(`[AI-DIAGNOSTIC]: ${rawText}`);

        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON found in AI response");
        
        const decision = JSON.parse(jsonMatch[0]);
        console.log(`[AI] Decision received: ${decision.reason} (Retry: ${decision.retry})`);
        return decision;
    } catch (error: any) {
        if (error.status === 429 || error.message?.includes("Quota exceeded")) {
            console.warn("[AI] Rate limit hit. Backing off for 7 seconds...");
            await sleep(7000); 
            return { retry: true, newTipMultiplier: 1.2, reason: "Rate-limited: Auto-retry after cooldown" };
        }
        console.error(`[AI] Reasoning failed, using fallback: ${error.message}`);
        return { retry: false, newTipMultiplier: 1.0, reason: "Fallback safety mode" };
    }
  }

  private async dispatchWithFailover(tx: VersionedTransaction, tip: number, attempt: number = 1, injectFault: boolean = false): Promise<void> {
    const isMainnet = process.env.SOLANA_RPC_URL?.includes("mainnet");

    try {
        if (injectFault && process.env.DEMO_MODE === "true") {
            const faults = ["BlockhashNotFound", "InsufficientComputeUnits", "SimulatedPreFlightFailure"];
            const randomFault = faults[Math.floor(Math.random() * faults.length)];
            console.warn(`[DEMO] Injecting deliberate random fault: ${randomFault}`);
            throw new Error(randomFault);
        }
        
        console.log(`[LIFECYCLE] Status: SUBMITTED | Attempt: ${attempt} | Tip: ${tip}`);
        
        let txId: string;
        if (isMainnet) {
            txId = await this.jito.buildAndSubmitBundle(tx, tip) || "";
            if (!txId) throw new Error("JitoBundleRejected");
        } else {
            txId = await this.connection.sendTransaction(tx);
        }

        const confirmation = await this.connection.confirmTransaction(txId, "confirmed");
        const confSlot = (confirmation.value as any).contextSlot || "Unknown";
        console.log(`[LIFECYCLE] Status: CONFIRMED | Slot: ${confSlot}`);

        const finality = await this.connection.confirmTransaction(txId, "finalized");
        const finalSlot = (finality.value as any).contextSlot || "Unknown";
        console.log(`[LIFECYCLE] Status: FINALIZED | Slot: ${finalSlot}`);

    } catch (err: any) {
        const errorMsg = err.message || "Unknown Error";
        this.failureHistory.push({ attempt, error: errorMsg, timestamp: Date.now() });
        
        console.log(`[RECOVERY] Caught error: ${errorMsg}. Reasoning...`);
        const decision = await this.reasonAboutFailure(errorMsg);
        
        if (decision.retry && attempt < 3) {
            console.log(`[RECOVERY] AI decision: ${decision.reason}. Retrying (Attempt ${attempt + 1})...`);
            await this.dispatchWithFailover(tx, tip * decision.newTipMultiplier, attempt + 1, false);
        } else {
            console.warn("[FAILOVER] Max retries reached or AI advised against retry.");
            await this.connection.sendTransaction(tx).catch(e => console.error("[FATAL] Failover RPC failed:", e.message));
        }
    }
  }

  public async executeFaultInjectionRun(historicalStreamedTips: number[]): Promise<void> {
    if (this.isBusy) return;
    this.isBusy = true;

    try {
      const tips = historicalStreamedTips.length > 0 ? historicalStreamedTips : [1000];
      const recentBlockhash = (await this.connection.getLatestBlockhash("confirmed")).blockhash;
      const tx = new VersionedTransaction(new TransactionMessage({
        payerKey: this.testingPayer.publicKey,
        recentBlockhash,
        instructions: [SystemProgram.transfer({ fromPubkey: this.testingPayer.publicKey, toPubkey: this.testingPayer.publicKey, lamports: 1000 })]
      }).compileToV0Message());
      
      tx.sign([this.testingPayer]);

      
      const shouldInject = process.env.DEMO_MODE === "true" && Math.random() < 0.2; 

      await this.dispatchWithFailover(tx, this.jito.calculateDynamicTip(tips), 1, shouldInject);
      
    } catch (err: any) {
      console.error(`[CRITICAL] Run failed: ${err.message}`);
    } finally {
      this.isBusy = false;
    }
  }
}