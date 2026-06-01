import { Keypair } from '@solana/web3.js';
import fs from 'fs';

const keypair = Keypair.generate();

console.log("--- New Wallet Generated ---");
console.log("Public Address:", keypair.publicKey.toBase58());

const secretKeyString = JSON.stringify(Array.from(keypair.secretKey));
fs.writeFileSync('my-wallet.json', secretKeyString);

console.log("Secret key saved to my-wallet.json (KEEP THIS PRIVATE!)");