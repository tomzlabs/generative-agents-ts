import React from 'react';

const MintInterface = () => {
  const handleMint = () => {
    // Placeholder function for minting logic
    console.log('Minting NFT...');
  };

  return (
    <div style={{ textAlign: 'center', marginTop: '50px' }}>
      <h1>Mint Your NFT</h1>
      <button onClick={handleMint} style={{ padding: '10px 20px', fontSize: '16px' }}>
        Mint NFT
      </button>
    </div>
  );
};

export default MintInterface;
