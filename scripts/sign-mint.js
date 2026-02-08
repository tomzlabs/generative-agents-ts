const { ethers } = require("ethers");

// ==============================================================================
// CONFIGURATION
// ==============================================================================
// 1. The Private Key of the "Signer Wallet" (the one who deployed the contract)
const SIGNER_PRIVATE_KEY = "YOUR_PRIVATE_KEY_HERE";

// 2. The Deployed Contract Address (NFA2.sol)
const CONTRACT_ADDRESS = "0xYourDeployedContractAddress";

// 3. Chain ID (56 for BSC Mainnet, 97 for BSC Testnet, 31337 for Local)
const CHAIN_ID = 56;
// ==============================================================================

async function signMintRequest(userWallet, nonce, expiry) {
    const wallet = new ethers.Wallet(SIGNER_PRIVATE_KEY);

    const domain = {
        name: "Non-Fungible Agent",
        version: "1",
        chainId: CHAIN_ID,
        verifyingContract: CONTRACT_ADDRESS
    };

    const types = {
        MintRequest: [
            { name: "wallet", type: "address" },
            { name: "nonce", type: "uint256" },
            { name: "expiry", type: "uint256" }
        ]
    };

    const value = {
        wallet: userWallet,
        nonce: nonce,
        expiry: expiry
    };

    const signature = await wallet.signTypedData(domain, types, value);
    return signature;
}

// EXAMPLE RUN
async function main() {
    if (SIGNER_PRIVATE_KEY === "YOUR_PRIVATE_KEY_HERE") {
        console.error("❌ PLEASE SET YOUR_PRIVATE_KEY_HERE IN THE SCRIPT");
        process.exit(1);
    }

    const user = "0x1234567890123456789012345678901234567890"; // User to whitelist
    const nonce = 0; // Ensure this matches contract: nonces[user]
    const expiry = Math.floor(Date.now() / 1000) + 3600; // 1 Hour

    console.log(`\nGenerating signature for:\nUser: ${user}\nNonce: ${nonce}\nExpiry: ${expiry}\n`);

    try {
        const sig = await signMintRequest(user, nonce, expiry);
        console.log("✅ SIGNATURE GENERATED:");
        console.log(sig);
        console.log("\n📋 CONTRACT CALL DATA:");
        console.log(`mint(\n  ["${user}", ${nonce}, ${expiry}],\n  "${sig}"\n)`);
    } catch (e) {
        console.error("Error:", e);
    }
}

main();
