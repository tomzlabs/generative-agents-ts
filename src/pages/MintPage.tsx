import { useState, useEffect } from 'react';
import { ethers } from 'ethers';

// Using static paths for assets
const nftImages = Array.from({ length: 9 }, (_, i) => `/static/assets/nft/${796 + i}.png`);

// BSC Contract Details
const CONTRACT_ADDRESS = '0x68f6c3d8a3B4e6Bdd21f589C852A998338466C5A';
const RPC_URL = 'https://bsc-dataseed.binance.org/'; // Public BSC RPC

interface MintPageProps {
    account: string | null;
    ownedTokens: number[];
    isScanning: boolean;
}

export function MintPage({ account, ownedTokens, isScanning }: MintPageProps) {
    const [totalSupply, setTotalSupply] = useState<number>(0);
    const [maxSupply, setMaxSupply] = useState<number>(1000);
    // const [account, setAccount] = useState<string | null>(null); // Lifted to App.tsx
    // const [ownedTokens, setOwnedTokens] = useState<number[]>([]); // Lifted
    // const [isScanning, setIsScanning] = useState(false); // Lifted

    // Calculate last 6 minted IDs
    // Calculate last 20 minted IDs for marquee
    const recentMints = Array.from({ length: Math.min(totalSupply, 20) }, (_, i) => totalSupply - 1 - i);

    useEffect(() => {
        const fetchContractData = async () => {
            const provider = new ethers.JsonRpcProvider(RPC_URL);
            const contract = new ethers.Contract(CONTRACT_ADDRESS, [
                "function MAX_SUPPLY() view returns (uint256)",
                "function ownerOf(uint256 tokenId) view returns (address)"
            ], provider);

            try {
                try {
                    const max = await contract.MAX_SUPPLY();
                    setMaxSupply(Number(max));
                } catch (e) { console.warn("Max supply fetch failed", e); }

                let currentId = 0;
                let foundEnd = false;
                while (!foundEnd && currentId < 1000) {
                    try {
                        await contract.ownerOf(currentId);
                        currentId++;
                    } catch (e) {
                        foundEnd = true;
                    }
                }
                setTotalSupply(currentId);
            } catch (error) {
                console.error("Failed to fetch contract data:", error);
            }
        };

        fetchContractData();
        const interval = setInterval(fetchContractData, 10000);
        return () => clearInterval(interval);
    }, []);

    // Effect to trigger scan when account changes -> MOVED TO APP.TSX

    // connectWallet lifted to App.tsx

    // scanOwnedTokens MOVED TO APP.TSX

    const downloadAgentJson = (id: number) => {
        const data = {
            id: `nft_${id}`,
            name: `Agent #${id}`,
            description: `Claws NFA Agent #${id}`,
            metadata: {
                contract: CONTRACT_ADDRESS,
                tokenId: id,
                owner: account
            },
            personality: {
                bio: "A digital entity living in AI Town.",
                traits: ["Unknown"],
                voice: "default"
            }
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `agent_${id}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <>
            <div className="scanlines"></div>
            <div style={{
                width: '100%',
                minHeight: '100%',
                backgroundColor: '#050505',
                color: '#E0E0E0',
                fontFamily: "'Space Mono', monospace",
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'flex-start',
                position: 'relative',
                zIndex: 1,
                boxSizing: 'border-box',
                paddingBottom: '5vh'
            }}>
                <div style={{
                    width: '90%',
                    maxWidth: '1400px',
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
                    {/* Header */}
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

                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                            {/* Wallet connection is now in the top Navigation bar */}
                            <div style={{ fontFamily: "'Press Start 2P', cursive", fontSize: '0.8em', color: '#00FF41' }}>
                                EARTH YEAR 2026
                            </div>
                        </div>
                    </div>

                    <div style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '4vw',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        width: '100%'
                    }}>

                        {/* LEFT COLUMN */}
                        <div style={{
                            flex: '1 1 500px',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            minWidth: '300px',
                            maxWidth: '600px',
                        }}>
                            <div>
                                <h1 style={{
                                    fontFamily: "'Press Start 2P', cursive",
                                    fontSize: 'clamp(24px, 4vw, 56px)',
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
                                </div>
                            </div>
                        </div>

                        {/* RIGHT COLUMN */}
                        <div style={{
                            flex: '1 1 400px',
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
                                maxWidth: '500px',
                                aspectRatio: '1/1',
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

                    {/* Owned Agents Section */}
                    {account && (
                        <div style={{
                            marginTop: '5vh',
                            width: '100%',
                            borderTop: '1px solid #333',
                            paddingTop: '3vh',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center'
                        }}>
                            <div style={{
                                fontFamily: "'Press Start 2P', cursive",
                                fontSize: '12px',
                                color: '#fff',
                                marginBottom: '2vh'
                            }}>
                                YOUR OPERATIVES {isScanning && <span className="blink">_SCANNING</span>}
                            </div>

                            {ownedTokens.length === 0 && !isScanning && (
                                <div style={{ color: '#666', fontSize: '12px' }}>NO AGENTS DETECTED</div>
                            )}

                            <div style={{
                                display: 'flex',
                                gap: '1rem',
                                flexWrap: 'wrap',
                                justifyContent: 'center'
                            }}>
                                {ownedTokens.map(id => (
                                    <div key={id} style={{
                                        border: '1px solid #00FF41',
                                        background: 'rgba(0, 255, 65, 0.05)',
                                        padding: '10px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        gap: '10px',
                                        width: '140px'
                                    }}>
                                        <img
                                            src={`/static/assets/nft/${id}.png`}
                                            alt={`Agent ${id}`}
                                            style={{ width: '100px', height: '100px', imageRendering: 'pixelated', border: '1px solid #333' }}
                                            onError={(e) => { (e.target as HTMLImageElement).src = '/static/assets/nft/0.png' }}
                                        />
                                        <div style={{ fontSize: '10px', color: '#fff' }}>AGENT #{id}</div>
                                        <button
                                            onClick={() => downloadAgentJson(id)}
                                            style={{
                                                background: '#00FF41',
                                                color: '#000',
                                                border: 'none',
                                                padding: '4px 8px',
                                                fontFamily: "'Press Start 2P', cursive",
                                                fontSize: '8px',
                                                cursor: 'pointer',
                                                width: '100%'
                                            }}
                                        >
                                            DWN_JSON
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

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
                                width: '100%',
                                overflow: 'hidden',
                                position: 'relative',
                                maskImage: 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)',
                                WebkitMaskImage: 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)'
                            }}>
                                <div className="marquee-content" style={{
                                    display: 'flex',
                                    gap: '1rem',
                                    padding: '1rem 0',
                                    width: 'fit-content'
                                }}>
                                    {/* Duplicating for seamless loop */}
                                    {[...recentMints, ...recentMints].map((id, index) => (
                                        <div key={`${id}-${index}`} style={{
                                            width: '100px',
                                            height: '100px',
                                            flexShrink: 0,
                                            border: '1px solid #333',
                                            position: 'relative',
                                            backgroundColor: '#000'
                                        }}>
                                            <img
                                                src={`/static/assets/nft/${id}.png`}
                                                alt={`Agent #${id}`}
                                                style={{ width: '100%', height: '100%', objectFit: 'cover', imageRendering: 'pixelated' }}
                                                onError={(e) => { (e.target as HTMLImageElement).src = '/static/assets/nft/0.png' }}
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

                {/* Mobile CSS */}
                <style>{`
                    @media (max-width: 900px) {
                        .desktop-only { display: none; }
                    }
                    .blink {
                        animation: blink 1s infinite;
                    }
                    .marquee-content {
                        animation: scroll 40s linear infinite;
                    }
                    @keyframes scroll {
                        0% { transform: translateX(0); }
                        100% { transform: translateX(-50%); }
                    }
                    @keyframes blink {
                        0% { opacity: 1; }
                        50% { opacity: 0; }
                        100% { opacity: 1; }
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
