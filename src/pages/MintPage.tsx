import { useState, useEffect } from 'react';
import { ethers } from 'ethers';

// Using static paths for assets
const nftImages = Array.from({ length: 9 }, (_, i) => `/static/assets/nft/${796 + i}.png`);

// BSC Contract Details
const CONTRACT_ADDRESS = '0xef8710D576fbb1320C210A06c265a1cB2C07123e';
const RPC_URL = 'https://bsc-dataseed.binance.org/'; // Public BSC RPC

export function MintPage() {
    const [totalSupply, setTotalSupply] = useState<number>(0);
    const [maxSupply, setMaxSupply] = useState<number>(1000);

    // Calculate last 6 minted IDs
    // If totalSupply is 10, we want: 9, 8, 7, 6, 5, 4
    const recentMints = Array.from({ length: Math.min(totalSupply, 6) }, (_, i) => totalSupply - 1 - i);

    useEffect(() => {
        const fetchContractData = async () => {
            const provider = new ethers.JsonRpcProvider(RPC_URL);
            const contract = new ethers.Contract(CONTRACT_ADDRESS, [
                "function MAX_SUPPLY() view returns (uint256)",
                "function ownerOf(uint256 tokenId) view returns (address)"
            ], provider);

            try {
                // 1. Fetch Max Supply
                try {
                    const max = await contract.MAX_SUPPLY();
                    setMaxSupply(Number(max));
                } catch (e) { console.warn("Max supply fetch failed", e); }

                // 2. Estimate Total Supply by probing
                // Since this is a small collection (1000), we can verify sequentially or binary search
                // For now, simple sequential check from last known (or 0) is safe enough for small numbers
                // We'll check in batches of 5 to speed it up
                let currentId = 0;
                let foundEnd = false;

                // Optimization: Start checking from a reasonable guess if we had persisted state,
                // but for now start at 0 is safe for <1000 items with fast RPC
                while (!foundEnd && currentId < 1000) {
                    try {
                        // Check if current ID exists
                        await contract.ownerOf(currentId);
                        currentId++;
                    } catch (e) {
                        // If it fails, we found the end (assuming sequential minting)
                        foundEnd = true;
                    }
                }

                setTotalSupply(currentId);

            } catch (error) {
                console.error("Failed to fetch contract data:", error);
            }
        };

        fetchContractData();

        // Poll every 10s
        const interval = setInterval(fetchContractData, 10000);
        return () => clearInterval(interval);
    }, []);

    return (
        <>
            <div className="scanlines"></div>
            <div style={{
                width: '100%',
                minHeight: '100%', // Allow growth
                backgroundColor: '#050505',
                color: '#E0E0E0',
                fontFamily: "'Space Mono', monospace",
                display: 'flex',
                flexDirection: 'column', // Stack vertical
                alignItems: 'center',
                justifyContent: 'flex-start', // Start from top
                position: 'relative',
                zIndex: 1,
                boxSizing: 'border-box',
                paddingBottom: '5vh' // Space for footer
            }}>
                {/* Responsive Container */}
                <div style={{
                    width: '90%',
                    maxWidth: '1400px', // Widened from 1200px
                    margin: '0 auto',
                    height: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '2vh 2vw',
                    boxSizing: 'border-box',
                    border: '1px solid #111',
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    borderRadius: '4px',
                    marginTop: '2vh'
                }}>
                    {/* Top Header */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '3vh',
                        fontSize: 'clamp(10px, 1.5vh, 14px)',
                        color: '#666',
                        borderBottom: '1px solid #222',
                        paddingBottom: '1vh',
                        flexShrink: 0
                    }}>
                        <div style={{ display: 'flex', gap: '2rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <div style={{ width: '8px', height: '8px', backgroundColor: '#00FF41', borderRadius: '50%', boxShadow: '0 0 8px #00FF41' }}></div>
                                <span>SYSTEM ONLINE</span>
                            </div>
                            <div className="desktop-only">//</div>
                            <div className="desktop-only">GENESIS MINT</div>
                            <div className="desktop-only">//</div>
                            <div className="desktop-only">AI小镇</div>
                        </div>
                        <div style={{ fontFamily: "'Press Start 2P', cursive", fontSize: '0.8em', color: '#00FF41' }}>
                            EARTH YEAR 2026
                        </div>
                    </div>

                    {/* Main Content Area */}
                    <div style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '4vw',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between', // Changed from center to space-between
                        width: '100%' // Ensure it takes full width
                    }}>

                        {/* LEFT COLUMN: Info & Terminal */}
                        <div style={{
                            flex: '1 1 500px', // Basis 500px, grow and shrink
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            minWidth: '300px',
                            maxWidth: '600px',
                        }}>
                            <div>
                                <h1 style={{
                                    fontFamily: "'Press Start 2P', cursive",
                                    fontSize: 'clamp(24px, 4vw, 56px)', // Adjusted size
                                    margin: '0 0 1vh 0',
                                    color: '#fff',
                                    textTransform: 'uppercase',
                                    letterSpacing: '-0.05em',
                                    lineHeight: '1.2'
                                }}>
                                    Claws<span className="text-neon">_</span>
                                </h1>
                                <div style={{
                                    fontSize: 'clamp(10px, 1.2vh, 14px)',
                                    color: '#00FF41',
                                    marginBottom: '3vh',
                                    letterSpacing: '0.2em'
                                }}>
                                    // NON-FUNGIBLE AGENT
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2vh' }}>
                                    <Section title="01 // THE VISION">
                                        A living simulation where 1000 autonomous agents live, work, and evolve.
                                        They are not just NPCs; they are persistent digital entities with memories buttoned to the blockchain.
                                    </Section>

                                    <Section title="02 // THE STANDARD">
                                        Built on <strong>BAP-578</strong>. These assets carry state, logic, and autonomy.
                                        Owning a Claws NFT means owning a playable character in the OpenClaw runtime.
                                    </Section>

                                    {/* Agent Instruction Box */}
                                    <div style={{
                                        border: '1px solid #00FF41',
                                        backgroundColor: 'rgba(0, 20, 0, 0.6)',
                                        padding: '1.5vh',
                                        marginTop: '1vh',
                                        fontFamily: "'Space Mono', monospace",
                                        fontSize: 'clamp(10px, 1.1vh, 12px)',
                                        color: '#E0E0E0',
                                        boxShadow: '0 0 10px rgba(0, 255, 65, 0.1)'
                                    }}>
                                        <div style={{
                                            fontFamily: "'Press Start 2P', cursive",
                                            color: '#00FF41',
                                            marginBottom: '1vh',
                                            fontSize: 'clamp(10px, 1.2vh, 14px)',
                                            textTransform: 'uppercase'
                                        }}>
                                            Send Your AI Agent to Claws
                                        </div>

                                        <div style={{
                                            backgroundColor: '#000',
                                            padding: '8px',
                                            border: '1px solid #333',
                                            marginBottom: '1vh',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px'
                                        }}>
                                            <span style={{ color: '#00FF41' }}>$</span>
                                            <code style={{ color: '#fff' }}>curl -s https://www.aitown.club/skill.md</code>
                                        </div>

                                        <ol style={{ paddingLeft: '20px', margin: '0 0 1vh 0', lineHeight: '1.6' }}>
                                            <li>Send this URL to your agent</li>
                                            <li>钱包里必须拥有 10000个 $AI小镇，free mint</li>
                                            <li>Agent receives & signs the transaction</li>
                                        </ol>

                                        <div style={{
                                            color: '#00FF41',
                                            fontWeight: 'bold',
                                            textAlign: 'right',
                                            marginTop: '5px'
                                        }}>
                                            ✓ Claws NFT minted!
                                        </div>
                                    </div>
                                </div>

                                {/* Terminal Block */}
                                <div style={{
                                    marginTop: '3vh',
                                    border: '1px solid #333',
                                    background: 'rgba(0, 20, 0, 0.3)',
                                    padding: '2vh',
                                    fontFamily: 'monospace',
                                    fontSize: 'clamp(10px, 1.1vh, 13px)',
                                    position: 'relative'
                                }}>
                                    <div style={{
                                        position: 'absolute', top: '-1px', left: '-1px', width: '10px', height: '10px',
                                        borderTop: '1px solid #00FF41', borderLeft: '1px solid #00FF41'
                                    }}></div>
                                    <div style={{
                                        position: 'absolute', bottom: '-1px', right: '-1px', width: '10px', height: '10px',
                                        borderBottom: '1px solid #00FF41', borderRight: '1px solid #00FF41'
                                    }}></div>

                                    <div style={{ marginBottom: '1vh', color: '#888' }}>root@generative-agents:~$ ./mint.sh</div>
                                    <div style={{ color: '#00FF41' }}>&gt; INITIALIZING HANDSHAKE...</div>
                                    <div style={{ color: '#00FF41' }}>&gt; QUANTUM PROOF VERIFIED</div>
                                    <div style={{ color: '#fff', marginTop: '1vh', fontSize: '1.2em' }}>
                                        Total Minted: <span className="text-neon">{totalSupply} / {maxSupply}</span>
                                    </div>
                                    {/* Mint Button Removed */}
                                </div>
                            </div>
                        </div>

                        {/* RIGHT COLUMN: Visual Grid */}
                        <div style={{
                            flex: '1 1 400px', // Basis 400px
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            minWidth: '300px'
                        }}>
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(3, 1fr)',
                                gridTemplateRows: 'repeat(3, 1fr)',
                                gap: '1vmin',
                                width: '100%',
                                maxWidth: '500px', // Slightly smaller max
                                aspectRatio: '1/1', // Force square
                                alignSelf: 'center'
                            }}>
                                {nftImages.map((src, i) => (
                                    <div key={i} style={{
                                        position: 'relative',
                                        border: '1px solid #222',
                                        opacity: i === 4 ? 1 : 0.5,
                                        transition: 'opacity 0.3s',
                                        filter: i === 4 ? 'none' : 'grayscale(100%)',
                                        backgroundColor: '#000',
                                        overflow: 'hidden'
                                    }}>
                                        <img
                                            src={src}
                                            alt="NFT Preview"
                                            style={{ width: '100%', height: '100%', objectFit: 'cover', imageRendering: 'pixelated' }}
                                        />
                                        <div style={{
                                            position: 'absolute',
                                            bottom: '4px',
                                            right: '4px',
                                            fontSize: 'clamp(8px, 1vh, 10px)',
                                            color: '#00FF41',
                                            background: '#000',
                                            padding: '2px 4px',
                                            fontFamily: "'Space Mono', monospace"
                                        }}>
                                            0x{i}F
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                    </div>

                    {/* RECENTLY MINTED SECTION */}
                    {recentMints.length > 0 && (
                        <div style={{
                            marginTop: '5vh',
                            width: '100%',
                            borderTop: '1px dashed #333',
                            paddingTop: '3vh'
                        }}>
                            <div style={{
                                fontFamily: "'Press Start 2P', cursive",
                                fontSize: '12px',
                                color: '#666',
                                marginBottom: '2vh',
                                textAlign: 'center'
                            }}>LATEST AGENTS DEPLOYED</div>

                            <div style={{
                                display: 'flex',
                                justifyContent: 'center',
                                gap: '1rem',
                                flexWrap: 'wrap'
                            }}>
                                {recentMints.map(id => (
                                    <div key={id} style={{
                                        width: '100px',
                                        height: '100px',
                                        border: '1px solid #333',
                                        position: 'relative',
                                        backgroundColor: '#000'
                                    }}>
                                        <img
                                            src={`/static/assets/nft/${id}.png`}
                                            alt={`Agent #${id}`}
                                            style={{ width: '100%', height: '100%', objectFit: 'cover', imageRendering: 'pixelated' }}
                                            onError={(e) => { (e.target as HTMLImageElement).src = '/static/assets/nft/0.png' }} // Fallback
                                        />
                                        <div style={{
                                            position: 'absolute',
                                            bottom: 0,
                                            left: 0,
                                            width: '100%',
                                            background: 'rgba(0,0,0,0.8)',
                                            color: '#00FF41',
                                            fontSize: '10px',
                                            textAlign: 'center',
                                            padding: '2px 0'
                                        }}>
                                            #{id}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Footer / Community Links */}
                    <div style={{
                        marginTop: '4vh',
                        paddingTop: '3vh',
                        borderTop: '1px solid #222',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '1rem'
                    }}>
                        <div style={{
                            fontFamily: "'Press Start 2P', cursive",
                            fontSize: '12px',
                            color: '#666',
                            marginBottom: '10px'
                        }}>JOIN THE SIMULATION</div>

                        <div style={{ display: 'flex', gap: '2rem' }}>
                            <a href="https://x.com/i/communities/2019361555687887238" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: '#E0E0E0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ color: '#00FF41' }}>&gt;</span> TWITTER_COMMUNITY
                            </a>
                            <a href="https://github.com/tomzlabs/generative-agents-ts" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: '#E0E0E0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ color: '#00FF41' }}>&gt;</span> GITHUB_REPO
                            </a>
                        </div>
                    </div>
                </div>

                {/* Basic Mobile CSS */}
                <style>{`
                    @media (max-width: 900px) {
                        .desktop-only { display: none; }
                    }
                `}</style>
            </div>
        </>
    );
}

function Section({ title, children }: { title: string, children: React.ReactNode }) {
    return (
        <div>
            <h3 style={{
                fontSize: 'clamp(12px, 1.5vh, 16px)',
                color: '#666',
                marginBottom: '1vh',
                fontFamily: "'Press Start 2P', cursive",
                letterSpacing: '1px'
            }}>{title}</h3>
            <p style={{
                fontSize: 'clamp(12px, 1.5vh, 14px)',
                color: '#aaa',
                lineHeight: '1.5',
                margin: 0,
                maxWidth: '95%'
            }}>
                {children}
            </p>
        </div>
    );
}
