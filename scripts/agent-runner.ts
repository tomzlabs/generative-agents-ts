import { ethers } from 'ethers';

// Configuration
const RPC_URL = 'https://bsc-dataseed.binance.org/';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const NFA_ADDRESS = '0x68f6c3d8a3B4e6Bdd21f589C852A998338466C5A'; // Your NFA Contract
const AGENT_ID = 0; // The ID of the agent you own and want to control

// ABIs
const NFA_ABI = [
    "function setLogicAddress(uint256 tokenId, address newLogic) external",
    "function executeAction(uint256 tokenId, bytes calldata data) external",
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function setAllowedLogicContract(address logic, bool allowed) external"
];

const LOGIC_ABI = [
    "function sayHello(string calldata message) external"
];

const LOGIC_BYTECODE = "0x6080604052348015600f57600080fd5b5060ae8061001e6000396000f3fe6080604052348015600f57600080fd5b506004361060285760003560e01c8063ef5fb05b14602d575b600080fd5b604060243660046039565b60008051602061007a833981519152602081015190805190602001909201919050517f06b72960d3dce365d95759715783226759c9431474447474444744447444744447444474447444474444744474444555b603580606f8339019056fe"; // Minimal bytecode for simple logic

async function main() {
    if (!PRIVATE_KEY) {
        console.error("Please set PRIVATE_KEY env var");
        process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    console.log(`Using wallet: ${wallet.address}`);

    const nfa = new ethers.Contract(NFA_ADDRESS, NFA_ABI, wallet);

    // 1. Deploy Logic Contract (Simplified for demo - usually you'd verify bytecode)
    // For this demo, let's assume we have a deployed logic address or deploy a simple one.
    // Since compiling in this script is hard, we'll use a placeholder or ask user to provide one.
    // ... Actually, for a pure JS script without hardhat, deploying bytecode is tricky without the artifact.

    // Let's assume the USER will deploy the contract via Remix or we use a pre-deployed one.
    // For now, I will use a placeholder address and instruct the user.
    const LOGIC_ADDRESS = "0x..."; // TODO: Deploy SimpleAgentLogic.sol and put address here.

    console.log("1. Setting Logic Address...");
    // const tx1 = await nfa.setLogicAddress(AGENT_ID, LOGIC_ADDRESS);
    // await tx1.wait();
    // console.log("Logic address set!");

    console.log("2. Executing Action...");
    const iface = new ethers.Interface(LOGIC_ABI);
    const data = iface.encodeFunctionData("sayHello", ["Hello from TypeScript!"]);

    try {
        const tx2 = await nfa.executeAction(AGENT_ID, data);
        console.log(`Transaction sent: ${tx2.hash}`);
        await tx2.wait();
        console.log("Action Executed Successfully!");
    } catch (e) {
        console.error("Execution failed:", e);
    }
}

main();
