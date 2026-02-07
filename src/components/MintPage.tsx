import React from 'react';
import nftImage from '../nfa-bap578-bsc/nft/nft-image.png';

const MintPage = () => {
  const handleMint = () => {
    // Placeholder function for minting logic
    console.log('Minting NFT...');
  };

  return (
    <div style={{ textAlign: 'center', marginTop: '50px' }}>
      <img src={nftImage} alt="NFT" style={{ width: '300px', height: '300px' }} />
      <h1>Mint Your NFT</h1>
      <button onClick={handleMint} style={{ padding: '10px 20px', fontSize: '16px' }}>
        Mint NFT
      </button>
    </div>
  );
};

export default MintPage;
