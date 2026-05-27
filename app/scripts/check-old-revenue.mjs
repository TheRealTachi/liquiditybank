import { Connection, PublicKey } from "@solana/web3.js";
const PROGRAM = new PublicKey("LiqsdMHNBjXJt5XHjRq7f4H8tDwcBu4yj2cuUv6MNYi");
const [revenue] = PublicKey.findProgramAddressSync([Buffer.from("protocol-revenue")], PROGRAM);
const [config] = PublicKey.findProgramAddressSync([Buffer.from("protocol-config")], PROGRAM);
const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const revBal = await conn.getBalance(revenue);
const cfgBal = await conn.getBalance(config);
console.log("protocol_revenue:", revenue.toBase58(), "balance:", revBal, "lamports", `(${(revBal/1e9).toFixed(6)} SOL)`);
console.log("protocol_config: ", config.toBase58(), "balance:", cfgBal, "lamports", `(${(cfgBal/1e9).toFixed(6)} SOL)`);
