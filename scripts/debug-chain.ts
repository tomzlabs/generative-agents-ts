
import { ethers } from "ethers";

const RPC_URL = "https://bsc-dataseed.binance.org/";
const CONTRACT_ADDRESS = "0x68f6c3d8a3B4e6Bdd21f589C852A998338466C5A";

async function main() {
    console.log("Connecting to BSC RPC:", RPC_URL);
    const provider = new ethers.JsonRpcProvider(RPC_URL);

    try {
        const net = await provider.getNetwork();
        console.log("Connected to network:", net.name, "ChainID:", net.chainId.toString());
    } catch (e) {
        console.error("Failed to connect to RPC:", e);
        return;
    }

    const contract = new ethers.Contract(CONTRACT_ADDRESS, [
        "function name() view returns (string)",
        "function symbol() view returns (string)",
        "function totalSupply() view returns (uint256)",
        "function ownerOf(uint256 tokenId) view returns (address)"
    ], provider);

    try {
        console.log("Fetching contract details...");
        const name = await contract.name();
        const symbol = await contract.symbol();
        console.log(`Contract: ${name} (${symbol})`);

        // Try getting an owner of a known token (e.g., 0 or 1)
        try {
            const owner0 = await contract.ownerOf(0);
            console.log("Owner of Token #0:", owner0);
        } catch (e) {
            console.log("Token #0 not minted yet or error:", e.message);
        }

    } catch (e) {
        console.error("Failed to fetch contract details:", e);
    }
}

main().catch(console.error);
