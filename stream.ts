import WebSocket from "ws";
import * as dotenv from "dotenv";

dotenv.config();

const RAW_ENDPOINT = process.env.GRPC_URL || "wss://api.devnet.solana.com";
const TARGET_ENDPOINT = RAW_ENDPOINT.trim()
  .replace(/^["']|["']$/g, "")
  .replace(/^grpc:\/\/|^http:\/\//, "wss://");

export interface TransactionLogNotification {
  method: string;
  params: {
    result: {
      context: { slot: number };
      value: {
        signature: string;
        err: any | null;
        logs: string[];
      };
    };
  };
}


export class PipelineMetricsTracker {
  private totalTxCount = 0;
  private failedTxCount = 0;
  private instructionRegistry: Record<string, number> = {};
  private initialTimestamp: number = Date.now();
  private monitoredSlots: Set<number> = new Set();

  public track(isFailed: boolean, instructions: string[], slot: number): void {
    this.totalTxCount++;
    if (isFailed) this.failedTxCount++;
    this.monitoredSlots.add(slot);

    instructions.forEach((instr) => {
      this.instructionRegistry[instr] = (this.instructionRegistry[instr] || 0) + 1;
    });

   
    if (this.monitoredSlots.size >= 10) {
      this.flushReport();
    }
  }

  private flushReport(): void {
    const runDurationSec = (Date.now() - this.initialTimestamp) / 1000;
    const avgTps = (this.totalTxCount / runDurationSec).toFixed(2);
    const failureRate = ((this.failedTxCount / this.totalTxCount) * 100).toFixed(2);

    console.log("-----------------------------------------------------------------");
    console.log(`[METRIC] PIPELINE PERFORMANCE RECOVERY & METRICS REPORT`);
    console.log("-----------------------------------------------------------------");
    console.log(`[METRIC] Active runtime duration : ${runDurationSec.toFixed(1)} seconds`);
    console.log(`[METRIC] Processed blocks count  : ${this.monitoredSlots.size}`);
    console.log(`[METRIC] Core computational TPS  : ${avgTps} tx/sec`);
    console.log(`[METRIC] Tracked cluster drop rate: ${failureRate}%`);
    console.log("[METRIC] Dominant programmatic instructions captured:");
    
    Object.entries(this.instructionRegistry)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([instr, count]) => {
        console.log(`  -> [${instr.padEnd(28)}] : Registered ${count} invocations`);
      });
    console.log("-----------------------------------------------------------------");

    this.monitoredSlots.clear();
  }
}

export class ResilientSolanaIngestionEngine {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectTimeout = 16000;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private metrics = new PipelineMetricsTracker();

  constructor(private readonly clusterUrl: string) {}

  public boot(): void {
    console.log(`[INFO] Spinning up logs telemetry pipeline on target node: ${this.clusterUrl}`);
    try {
      this.ws = new WebSocket(this.clusterUrl);
      this.registerLifecycleListeners();
    } catch (error) {
      this.triggerBackoffRecovery();
    }
  }

  private registerLifecycleListeners(): void {
    if (!this.ws) return;

    this.ws.on("open", () => {
      console.log("[INFO] Ingestion transport layer secured. Connection handshakes validated.");
      this.reconnectAttempts = 0;
      this.startHeartbeatLoop();
      this.commitSubscriptionMasks();
    });

    this.ws.on("message", (bufferData: WebSocket.Data) => {
      this.processIncomingPayload(bufferData);
    });

    this.ws.on("error", () => {
      // Internal capture node to catch runtime transport breaks silently
    });

    this.ws.on("close", () => {
      console.warn("[WARN] Log ingestion pipe connection lost. Resetting interfaces...");
      this.triggerBackoffRecovery();
    });

    this.ws.on("pong", () => {
      // Keepalive diagnostic response verified
    });
  }

  private commitSubscriptionMasks(): void {
    const subscriptionFrame = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "logsSubscribe",
      params: ["all", { commitment: "processed" }]
    };
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(subscriptionFrame));
    }
  }

  private processIncomingPayload(rawData: WebSocket.Data): void {
    try {
      const parsedPayload = JSON.parse(rawData.toString());

      if (parsedPayload.method === "logsNotification") {
        const txUpdate = parsedPayload as TransactionLogNotification;
        const valueContext = txUpdate.params.result.value;
        const slotContext = txUpdate.params.result.context.slot;

        const extractedInstructions: string[] = [];
        if (valueContext.logs) {
          valueContext.logs.forEach((log) => {
            if (log.includes("Instruction:")) {
              const name = log.split("Instruction:")[1].trim();
              if (!name.includes(" ")) extractedInstructions.push(name);
            }
          });
        }

        this.metrics.track(valueContext.err !== null, extractedInstructions, slotContext);
      }
    } catch (error) {
      // Suppress parsing defects to maintain system throughput bounds
    }
  }

  private startHeartbeatLoop(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.ping();
    }, 30000);
  }

  private triggerBackoffRecovery(): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    const backoffDelay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectTimeout);
    this.reconnectAttempts++;
    
    console.log(`[RECOVERY] Scheduling backoff retry sequence. Holding thread for ${backoffDelay}ms...`);
    setTimeout(() => this.boot(), backoffDelay);
  }
}

const pipelineEngine = new ResilientSolanaIngestionEngine(TARGET_ENDPOINT);
pipelineEngine.boot();