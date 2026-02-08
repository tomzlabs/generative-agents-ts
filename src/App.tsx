import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import './App.css';
import { VillageMap } from './components/Map/VillageMap';
import { MintPage } from './pages/MintPage';
import { MyNFAPage } from './pages/MyNFAPage';
import { WhitepaperPage } from './pages/WhitepaperPage';
import { Navigation } from './components/Navigation';

const CONTRACT_ADDRESS = '0x68f6c3d8a3B4e6Bdd21f589C852A998338466C5A';
const RPC_URL = 'https://bsc-dataseed.binance.org/';

function App() {
  const [account, setAccount] = useState<string | null>(null);
  const [ownedTokens, setOwnedTokens] = useState<number[]>([]);
  const [isScanning, setIsScanning] = useState(false);

  const connectWallet = async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(window as any).ethereum) {
      alert("Please install MetaMask!");
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const addr = await signer.getAddress();
      setAccount(addr);
    } catch (e) {
      console.error("Connection failed", e);
    }
  };

  const scanOwnedTokens = async (ownerAddress: string) => {
    setIsScanning(true);
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, [
      "function ownerOf(uint256 tokenId) view returns (address)"
    ], provider);

    // We need to know max supply to scan, or just scan 1000 for now as per previous logic
    const maxSupply = 1000;
    const found: number[] = [];
    const BATCH_SIZE = 50;

    // Simple scanning logic
    for (let i = 0; i < maxSupply; i += BATCH_SIZE) {
      const promises = [];
      for (let j = 0; j < BATCH_SIZE && (i + j) < maxSupply; j++) {
        const id = i + j;
        promises.push(
          contract.ownerOf(id)
            .then(owner => {
              if (owner.toLowerCase() === ownerAddress.toLowerCase()) {
                found.push(id);
              }
            })
            .catch(() => { })
        );
      }
      await Promise.all(promises);
    }
    setOwnedTokens(found.sort((a, b) => a - b));
    setIsScanning(false);
  };

  // Effect to trigger scan when account changes
  useEffect(() => {
    if (account) {
      scanOwnedTokens(account);
    } else {
      setOwnedTokens([]);
    }
  }, [account]);

  return (
    <Router>
      <div style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <Navigation account={account} onConnect={connectWallet} />
        <div style={{ flex: 1, position: 'relative', overflowY: 'auto', marginTop: '64px', WebkitOverflowScrolling: 'touch' }}>
          <Routes>
            <Route path="/" element={<Navigate to="/map" replace />} />
            <Route path="/map" element={<div style={{ width: '100%', height: '100%' }}><VillageMap /></div>} />
            <Route path="/nft" element={<MintPage account={account} ownedTokens={ownedTokens} isScanning={isScanning} />} />
            <Route path="/my-nfa" element={<MyNFAPage account={account} ownedTokens={ownedTokens} isScanning={isScanning} />} />
            <Route path="/whitepaper" element={<WhitepaperPage />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;
