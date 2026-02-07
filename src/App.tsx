import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import './App.css';
import { VillageMap } from './components/Map/VillageMap';
import { MintPage } from './pages/MintPage';
import { Navigation } from './components/Navigation';

function App() {
  return (
    <Router>
      <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <Navigation />
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden', marginTop: '64px' }}>
          <Routes>
            <Route path="/" element={<Navigate to="/map" replace />} />
            <Route path="/map" element={<div style={{ width: '100%', height: '100%' }}><VillageMap /></div>} />
            <Route path="/nft" element={<MintPage />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;
