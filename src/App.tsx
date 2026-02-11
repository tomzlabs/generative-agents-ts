import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import './App.css';
import { VillageMap } from './components/Map/VillageMap';
import { MintPage } from './pages/MintPage';
import { MyNFAPage } from './pages/MyNFAPage';
import { WhitepaperPage } from './pages/WhitepaperPage';
import { FarmingPage } from './pages/FarmingPage';
import { LotteryPage } from './pages/LotteryPage';
import { TestMapPage } from './pages/TestMapPage';
import { Navigation } from './components/Navigation';
import { CHAIN_CONFIG } from './config/chain';
import { getReadProvider } from './core/chain/readProvider';
import { useI18n } from './i18n/I18nContext';

const WALLET_AUTO_CONNECT_KEY = 'ga:wallet:auto-connect';

function App() {
  const { t } = useI18n();
  const [account, setAccount] = useState<string | null>(null);
  const [ownedTokens, setOwnedTokens] = useState<number[]>([]);
  const [isScanning, setIsScanning] = useState(false);

  const connectWallet = async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(window as any).ethereum) {
      alert(t('请先安装 MetaMask', 'Please install MetaMask first.'));
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const accounts = await provider.send('eth_requestAccounts', []);
      const addr = (accounts?.[0] as string | undefined) ?? null;
      setAccount(addr);
      window.localStorage.setItem(WALLET_AUTO_CONNECT_KEY, '1');
    } catch (e) {
      console.error("Connection failed", e);
    }
  };

  const scanOwnedTokens = async (ownerAddress: string) => {
    setIsScanning(true);
    const provider = getReadProvider();
    const contract = new ethers.Contract(CHAIN_CONFIG.nfaAddress, [
      "function ownerOf(uint256 tokenId) view returns (address)",
      "function balanceOf(address owner) view returns (uint256)"
    ], provider);

    try {
      // 1. Check Balance first
      const balance = await contract.balanceOf(ownerAddress);
      const balanceNum = Number(balance);

      if (balanceNum === 0) {
        setOwnedTokens([]);
        setIsScanning(false);
        return;
      }

      // 2. Scan for tokens
      const maxSupply = 1000;
      const found: number[] = [];
      const BATCH_SIZE = 5; // Reduced to avoid rate limits

      for (let i = 0; i < maxSupply; i += BATCH_SIZE) {
        // Optimization: if we found all tokens, stop scanning
        if (found.length >= balanceNum) break;

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
              .catch(() => {
                // Ignore errors
              })
          );
        }
        await Promise.all(promises);

        // Anti-rate-limit delay
        await new Promise(r => setTimeout(r, 100));
      }
      setOwnedTokens(found.sort((a, b) => a - b));
    } catch (e) {
      console.error("Scan failed", e);
    } finally {
      setIsScanning(false);
    }
  };

  const disconnectWallet = () => {
    setAccount(null);
    window.localStorage.setItem(WALLET_AUTO_CONNECT_KEY, '0');
  };

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ethereum = (window as any).ethereum;
    if (!ethereum) return;

    const shouldAutoConnect = window.localStorage.getItem(WALLET_AUTO_CONNECT_KEY) !== '0';

    const handleAccountsChanged = (accounts: string[]) => {
      const next = accounts?.[0] ?? null;
      setAccount(next);
      if (next) {
        window.localStorage.setItem(WALLET_AUTO_CONNECT_KEY, '1');
      }
    };

    const restoreSession = async () => {
      if (!shouldAutoConnect) return;
      try {
        const accounts = (await ethereum.request({ method: 'eth_accounts' })) as string[];
        if (accounts?.[0]) {
          setAccount(accounts[0]);
        }
      } catch (error) {
        console.error('Restore wallet session failed', error);
      }
    };

    void restoreSession();
    ethereum.on?.('accountsChanged', handleAccountsChanged);

    return () => {
      ethereum.removeListener?.('accountsChanged', handleAccountsChanged);
    };
  }, []);

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
      <div className="app-shell">
        <Navigation account={account} onConnect={connectWallet} onDisconnect={disconnectWallet} />
        <div className="app-scroll-area">
          <Routes>
            <Route path="/" element={<Navigate to="/map" replace />} />
            <Route path="/map" element={<div style={{ width: '100%', height: '100%' }}><VillageMap account={account} /></div>} />
            <Route path="/testmap" element={<Navigate to="/farm" replace />} />
            <Route path="/nft" element={<MintPage account={account} ownedTokens={ownedTokens} isScanning={isScanning} />} />
            <Route path="/my-nfa" element={<MyNFAPage account={account} ownedTokens={ownedTokens} isScanning={isScanning} />} />
            <Route path="/farm" element={<TestMapPage account={account} />} />
            <Route path="/farm-legacy" element={<FarmingPage account={account} ownedTokens={ownedTokens} />} />
            <Route path="/lottery" element={<LotteryPage account={account} />} />
            <Route path="/whitepaper" element={<WhitepaperPage />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;
