import { Link } from 'react-router-dom';

interface MyNFAPageProps {
    account: string | null;
    ownedTokens: number[];
    isScanning: boolean;
}

const CONTRACT_ADDRESS = '0x68f6c3d8a3B4e6Bdd21f589C852A998338466C5A';

export function MyNFAPage({ account, ownedTokens, isScanning }: MyNFAPageProps) {

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
                paddingTop: '5vh',
                position: 'relative',
                zIndex: 1
            }}>
                <div style={{
                    width: '90%',
                    maxWidth: '1200px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center'
                }}>
                    <h1 style={{
                        fontFamily: "'Press Start 2P', cursive",
                        fontSize: 'clamp(20px, 3vw, 32px)',
                        color: '#fff',
                        marginBottom: '4vh',
                        textTransform: 'uppercase',
                        textShadow: '0 0 10px #00FF41'
                    }}>
                        MY OPERATIVES <span className="blink">_</span>
                    </h1>

                    {!account ? (
                        <div style={{
                            border: '1px solid #333',
                            padding: '4rem',
                            textAlign: 'center',
                            backgroundColor: 'rgba(0,0,0,0.5)'
                        }}>
                            <div style={{ marginBottom: '2rem', color: '#666' }}>ACCESS DENIED</div>
                            <div style={{ color: '#00FF41', fontFamily: "'Press Start 2P', cursive", fontSize: '12px' }}>
                                &lt; PLEASE CONNECT WALLET &gt;
                            </div>
                        </div>
                    ) : (
                        <div style={{ width: '100%' }}>
                            <div style={{
                                fontFamily: "'Space Mono', monospace",
                                fontSize: '12px',
                                color: '#666',
                                marginBottom: '2vh',
                                borderBottom: '1px solid #333',
                                paddingBottom: '1vh',
                                display: 'flex',
                                justifyContent: 'space-between'
                            }}>
                                <span>STATUS: {isScanning ? <span style={{ color: '#00FF41' }} className="blink">SCANNING NETWORK...</span> : 'ONLINE'}</span>
                                <span>COUNT: {ownedTokens.length}</span>
                            </div>

                            {ownedTokens.length === 0 && !isScanning && (
                                <div style={{
                                    textAlign: 'center',
                                    padding: '5vh 0',
                                    color: '#666'
                                }}>
                                    NO AGENTS DETECTED IN SECTOR.
                                    <br /><br />
                                    <Link to="/nft" style={{ color: '#00FF41', textDecoration: 'none' }}>[ MINT NEW AGENT ]</Link>
                                </div>
                            )}

                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                                gap: '2rem',
                                width: '100%'
                            }}>
                                {ownedTokens.map(id => (
                                    <div key={id} style={{
                                        border: '1px solid #00FF41',
                                        background: 'rgba(0, 255, 65, 0.02)',
                                        padding: '1rem',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '1rem',
                                        transition: 'transform 0.2s',
                                        position: 'relative'
                                    }}>
                                        <div style={{
                                            position: 'absolute',
                                            top: '0',
                                            right: '0',
                                            background: '#00FF41',
                                            color: '#000',
                                            fontSize: '10px',
                                            padding: '2px 6px',
                                            fontFamily: "'Press Start 2P', cursive"
                                        }}>
                                            #{id}
                                        </div>

                                        <div style={{
                                            width: '100%',
                                            aspectRatio: '1/1',
                                            backgroundColor: '#000',
                                            border: '1px solid #333',
                                            overflow: 'hidden'
                                        }}>
                                            <img
                                                src={`/static/assets/nft/${id}.png`}
                                                alt={`Agent ${id}`}
                                                style={{ width: '100%', height: '100%', objectFit: 'cover', imageRendering: 'pixelated' }}
                                                onError={(e) => { (e.target as HTMLImageElement).src = '/static/assets/nft/0.png' }}
                                            />
                                        </div>

                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                            <div style={{ fontSize: '12px', color: '#fff', fontFamily: "'Press Start 2P', cursive" }}>AGENT #{id}</div>
                                            <div style={{ fontSize: '10px', color: '#888' }}>CLAS: NFA-BAP578</div>
                                        </div>

                                        <button
                                            onClick={() => downloadAgentJson(id)}
                                            style={{
                                                background: 'transparent',
                                                border: '1px solid #00FF41',
                                                color: '#00FF41',
                                                padding: '8px',
                                                fontFamily: "'Press Start 2P', cursive",
                                                fontSize: '10px',
                                                cursor: 'pointer',
                                                marginTop: 'auto',
                                                textAlign: 'center',
                                                transition: 'all 0.2s'
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.background = '#00FF41';
                                                e.currentTarget.style.color = '#000';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.background = 'transparent';
                                                e.currentTarget.style.color = '#00FF41';
                                            }}
                                        >
                                            [ DOWNLOAD_DATA ]
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
                <style>{`
                    .blink { animation: blink 1s infinite; }
                    @keyframes blink { 0% { opacity: 1; } 50% { opacity: 0; } 100% { opacity: 1; } }
                `}</style>
            </div>
        </>
    );
}
