import { 
  Connection, 
  Keypair, 
  PublicKey, 
  SystemProgram, 
  VersionedTransaction, 
  TransactionMessage 
} from "@solana/web3.js";
import * as dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const JITO_TIP_ACCOUNTS = [
  "Cw8CFyTvYzc2fC6PkGYj2vJa6cVN9g5Eg7Yux6id3A14",
  "A6xywqTjYJj2V6tGgXBAuYyY6pB8LKgXG16vL8JAnY6",
  "96gYZGLnJYVFmbjzHsUrw6Hq5vS579w9w3P9R3C2rA63"
];

const JITO_BLOCK_ENGINE_URL = process.env.JITO_BLOCK_ENGINE_URL || "https://devnet.block-engine.jito.wtf/api/v1/bundles";
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
export class JitoBundleExecutor {
  private connection: Connection;
  private payer: Keypair;

  constructor(wallet: Keypair) {
    this.connection = new Connection(RPC_URL, "confirmed");
    this.payer = wallet;
  }

  
  public async getUpcomingJitoLeaderWindow(currentSlot: number): Promise<{
    optimalSlot: number;
    shouldHold: boolean;
    slotsToWait: number;
  }> {
   
    const SLOTS_PER_WINDOW = 100;
    const progressInWindow = currentSlot % SLOTS_PER_WINDOW;
    
    // Hold pattern logic: avoid submitting in the final 20% of a window
    const shouldHold = progressInWindow > 80;
    const slotsToWait = shouldHold ? (SLOTS_PER_WINDOW - progressInWindow) : 0;
    
    return {
      optimalSlot: currentSlot + slotsToWait,
      shouldHold,
      slotsToWait
    };
  }

  public async buildAndSubmitBundle(
    targetTransaction: VersionedTransaction, 
    calculatedTipLamports: number
  ): Promise<string | null> {
    try {
      const selectedTipAccount = new PublicKey(JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)]);

      
      const serializedTarget = Buffer.from(targetTransaction.serialize()).toString("base64");

      
      const tipInstruction = SystemProgram.transfer({
        fromPubkey: this.payer.publicKey,
        toPubkey: selectedTipAccount,
        lamports: calculatedTipLamports
      });

      const tipMessage = new TransactionMessage({
        payerKey: this.payer.publicKey,
        recentBlockhash: targetTransaction.message.recentBlockhash as string,
        instructions: [tipInstruction]
      }).compileToV0Message();

      const tipTx = new VersionedTransaction(tipMessage);
      tipTx.sign([this.payer]);
      const serializedTip = Buffer.from(tipTx.serialize()).toString("base64");

     
      const payload = {
        jsonrpc: "2.0",
        id: 1,
        method: "sendBundle",
        params: [[serializedTarget, serializedTip]]
      };

      console.log("DEBUG: Dispatching V0 Bundle Payload...");
      const response = await axios.post(JITO_BLOCK_ENGINE_URL, payload);
      
      return response.data?.result || null;
    } catch (error: any) {
      console.error("[CRITICAL] Jito Rejected Bundle:", error.response?.data ? JSON.stringify(error.response.data) : error.message);
      return null;
    }
  }

  public calculateDynamicTip(streamedTips: number[]): number {
    if (!streamedTips || streamedTips.length === 0) return 10000; 
    const sorted = [...streamedTips].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return Math.ceil(median * 1.10);
  }
}