import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

const connection = new Connection('https://api.testnet.solana.com', 'confirmed');
const publicKey = new PublicKey("DSTSSdxTJkVzVKPggHknb4ZZ2m3dmmM2CNFPz8omUZPz");

const balance = await connection.getBalance(publicKey);
console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);