import { useState } from 'react';

// Using static paths for assets
const nftImages = Array.from({ length: 9 }, (_, i) => `/static/assets/nft/${796 + i}.png`);

export function MintPage() {
    const [minted] = useState(420);

    return (
        <>
            <div className="scanlines"></div>
            <div style={{
                width: '100%',
                height: '100%', // Use 100% of parent (which is 100vh - nav height)
                backgroundColor: '#050505',
                color: '#E0E0E0',
                fontFamily: "'Space Mono', monospace",
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                position: 'relative',
                zIndex: 1,
                boxSizing: 'border-box'
            }}>
                {/* Responsive Container */}
                <div style={{
                    width: '100%',
                    height: '100%',
                    maxWidth: '1400px',
                    margin: '0 auto',
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '2vh 2vw',
                    boxSizing: 'border-box'
                }}>
                    {/* Top Header */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '1vh',
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
                        </div>
                        <div style={{ fontFamily: "'Press Start 2P', cursive", fontSize: '0.8em', color: '#00FF41' }}>
                            EARTH YEAR 2026
                        </div>
                    </div>

                    {/* Main Content Area */}
                    <div style={{
                        display: 'flex',
                        flex: 1,
                        gap: '2vw',
                        overflow: 'hidden',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}>

                        {/* LEFT COLUMN: Info & Terminal */}
                        <div style={{
                            flex: '1 1 50%',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            minWidth: '300px',
                            maxWidth: '600px',
                            paddingRight: '1rem',
                            height: '100%'
                        }}>
                            <div style={{ overflowY: 'auto', paddingRight: '10px' }}>
                                <h1 style={{
                                    fontFamily: "'Press Start 2P', cursive",
                                    fontSize: 'clamp(24px, 4vw, 64px)',
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

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '3vh' }}>
                                    <Section title="01 // THE VISION">
                                        A living simulation where 25 autonomous agents live, work, and evolve.
                                        They are not just NPCs; they are persistent digital entities with memories buttoned to the blockchain.
                                    </Section>

                                    <Section title="02 // THE STANDARD">
                                        Built on <strong>BAP-578</strong>. These assets carry state, logic, and autonomy.
                                        Owning a Claws NFT means owning a playable character in the OpenClaw runtime.
                                    </Section>
                                </div>

                                {/* Terminal Block */}
                                <div style={{
                                    marginTop: '4vh',
                                    border: '1px solid #333',
                                    background: 'rgba(0, 20, 0, 0.3)',
                                    padding: '2vh',
                                    fontFamily: 'monospace',
                                    fontSize: 'clamp(11px, 1.2vh, 14px)',
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
                                        Total Minted: <span className="text-neon">{minted} / 1000</span>
                                    </div>
                                    {/* Mint Button Removed */}
                                </div>
                            </div>
                        </div>

                        {/* RIGHT COLUMN: Visual Grid */}
                        <div style={{
                            flex: '1 1 50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: '100%',
                            overflow: 'hidden'
                        }}>
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(3, 1fr)',
                                gridTemplateRows: 'repeat(3, 1fr)',
                                gap: '1vmin',
                                width: '100%',
                                maxWidth: '600px', // Limit max width
                                aspectRatio: '1/1', // Force square
                                maxHeight: '70vh' // Limit height so it doesn't overflow vertically
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
