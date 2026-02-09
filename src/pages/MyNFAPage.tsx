import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ethers } from 'ethers';

interface MyNFAPageProps {
    account: string | null;
    ownedTokens: number[];
    isScanning: boolean;
}

declare global {
    interface Window {
        ethereum: any;
    }
}

const CONTRACT_ADDRESS = '0x68f6c3d8a3B4e6Bdd21f589C852A998338466C5A';

export function MyNFAPage({ account, ownedTokens, isScanning }: MyNFAPageProps) {

    // Modal State
    const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);

    // Form State
    const [metadataForm, setMetadataForm] = useState({
        name: '',
        description: '',
        type: 'Assistant',
        voiceHash: '',
        animationURI: '',
        vaultURI: ''
    });

    const AGENT_TYPES = ['Assistant', 'Trader', 'Gamer', 'NPC', 'Custom'];

    // Pagination State
    const [visibleCount, setVisibleCount] = useState(20);

    const handleLoadMore = () => {
        setVisibleCount(prev => prev + 20);
    };

    const openEditModal = async (id: number) => {
        setSelectedAgentId(id);
        setIsModalOpen(true);
        // Reset form
        setMetadataForm({
            name: '',
            description: '',
            type: 'Assistant',
            voiceHash: '',
            animationURI: '',
            vaultURI: ''
        });

        // Try to fetch existing metadata
        if (window.ethereum) {
            try {
                const provider = new ethers.BrowserProvider(window.ethereum);
                const contract = new ethers.Contract(CONTRACT_ADDRESS, [
                    "function getAgentMetadata(uint256 tokenId) external view returns (tuple(string persona, string experience, string voiceHash, string animationURI, string vaultURI, bytes32 vaultHash))"
                ], provider);
                const data = await contract.getAgentMetadata(id);

                // Parse Type from Experience (Format: "[TYPE] Description")
                let type = 'Custom';
                let description = data.experience;
                const typeMatch = data.experience.match(/^\[(.*?)\]\s*(.*)/s);
                if (typeMatch) {
                    type = AGENT_TYPES.includes(typeMatch[1]) ? typeMatch[1] : 'Custom';
                    description = typeMatch[2];
                }

                setMetadataForm({
                    name: data.persona,
                    description: description,
                    type: type,
                    voiceHash: data.voiceHash,
                    animationURI: data.animationURI,
                    vaultURI: data.vaultURI
                });
            } catch (e) {
                console.error("Failed to fetch metadata", e);
            }
        }
    };

    const [logicAddressInput, setLogicAddressInput] = useState('');

    const handleSetLogic = async () => {
        if (!selectedAgentId || !window.ethereum || !logicAddressInput) return;
        setIsUpdating(true);
        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const contract = new ethers.Contract(CONTRACT_ADDRESS, [
                "function setLogicAddress(uint256 tokenId, address newLogic) external"
            ], signer);

            const tx = await contract.setLogicAddress(selectedAgentId, logicAddressInput);
            await tx.wait();
            alert("Logic Address Linked Successfully!");
        } catch (err: any) {
            console.error(err);
            alert("Link Failed: " + (err.reason || err.message));
        } finally {
            setIsUpdating(false);
        }
    };

    const handleExecuteAction = async () => {
        if (!selectedAgentId || !window.ethereum) return;
        setIsUpdating(true);
        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const contract = new ethers.Contract(CONTRACT_ADDRESS, [
                "function executeAction(uint256 tokenId, bytes calldata data) external"
            ], signer);

            // Encode "sayHello(string)"
            const iface = new ethers.Interface(["function sayHello(string calldata message) external"]);
            const data = iface.encodeFunctionData("sayHello", ["Hello from Frontend!"]);

            const tx = await contract.executeAction(selectedAgentId, data);
            await tx.wait();
            alert("Action Executed! Check BscScan for 'ActionExecuted' event.");
        } catch (err: any) {
            console.error(err);
            alert("Execution Failed: " + (err.reason || err.message));
        } finally {
            setIsUpdating(false);
        }
    };

    const handleUpdateMetadata = async () => {
        if (!selectedAgentId || !window.ethereum) return;
        setIsUpdating(true);
        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const contract = new ethers.Contract(CONTRACT_ADDRESS, [
                "function updateAgentMetadata(uint256 tokenId, tuple(string persona, string experience, string voiceHash, string animationURI, string vaultURI, bytes32 vaultHash) metadata) external"
            ], signer);

            // Construct Experience string
            const fullExperience = `[${metadataForm.type}] ${metadataForm.description}`;

            const tx = await contract.updateAgentMetadata(selectedAgentId, {
                persona: metadataForm.name,
                experience: fullExperience,
                voiceHash: metadataForm.voiceHash,
                animationURI: metadataForm.animationURI,
                vaultURI: metadataForm.vaultURI,
                vaultHash: ethers.ZeroHash // Placeholder
            });
            await tx.wait();
            alert("Metadata Updated Successfully!");
            setIsModalOpen(false);
        } catch (err: any) {
            console.error(err);
            alert("Update Failed: " + (err.reason || err.message));
        } finally {
            setIsUpdating(false);
        }
    };

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
                    alignItems: 'center',
                    paddingBottom: '100px'
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
                                <span>COUNT: {ownedTokens.length} (SHOWING {Math.min(visibleCount, ownedTokens.length)})</span>
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
                                {ownedTokens.slice(0, visibleCount).map(id => (
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

                                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto' }}>
                                            <button
                                                onClick={() => openEditModal(id)}
                                                style={{
                                                    flex: 1,
                                                    background: '#00FF41',
                                                    border: 'none',
                                                    color: '#000',
                                                    padding: '8px',
                                                    fontFamily: "'Press Start 2P', cursive",
                                                    fontSize: '10px',
                                                    cursor: 'pointer',
                                                    textAlign: 'center',
                                                    transition: 'all 0.2s',
                                                    textTransform: 'uppercase'
                                                }}
                                                onMouseEnter={(e) => {
                                                    e.currentTarget.style.boxShadow = '0 0 10px #00FF41';
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.currentTarget.style.boxShadow = 'none';
                                                }}
                                            >
                                                EDIT
                                            </button>
                                            <button
                                                onClick={() => downloadAgentJson(id)}
                                                style={{
                                                    flex: 1,
                                                    background: 'transparent',
                                                    border: '1px solid #00FF41',
                                                    color: '#00FF41',
                                                    padding: '8px',
                                                    fontFamily: "'Press Start 2P', cursive",
                                                    fontSize: '10px',
                                                    cursor: 'pointer',
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
                                                JSON
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {visibleCount < ownedTokens.length && (
                                <div style={{ marginTop: '2rem', width: '100%', textAlign: 'center' }}>
                                    <button
                                        onClick={handleLoadMore}
                                        style={{
                                            background: 'transparent',
                                            border: '1px solid #00FF41',
                                            color: '#00FF41',
                                            padding: '1rem 3rem',
                                            fontFamily: "'Press Start 2P', cursive",
                                            cursor: 'pointer',
                                            fontSize: '12px'
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
                                        LOAD MORE RESULTS_
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Edit Modal */}
                {isModalOpen && (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        backgroundColor: 'rgba(0,0,0,0.8)',
                        zIndex: 20000,
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center'
                    }}>
                        <div style={{
                            width: '90%',
                            maxWidth: '600px',
                            backgroundColor: '#000',
                            border: '2px solid #00FF41',
                            padding: '2rem',
                            position: 'relative',
                            boxShadow: '0 0 50px rgba(0, 255, 65, 0.2)',
                            maxHeight: '90vh',
                            overflowY: 'auto'
                        }}>
                            <button
                                onClick={() => setIsModalOpen(false)}
                                style={{
                                    position: 'absolute',
                                    top: '1rem',
                                    right: '1rem',
                                    background: 'transparent',
                                    border: 'none',
                                    color: '#00FF41',
                                    fontFamily: "'Press Start 2P', cursive",
                                    cursor: 'pointer'
                                }}
                            >
                                X
                            </button>

                            <h2 style={{
                                color: '#00FF41',
                                fontFamily: "'Press Start 2P', cursive",
                                fontSize: '16px',
                                marginBottom: '2rem',
                                borderBottom: '1px solid #333',
                                paddingBottom: '1rem'
                            }}>
                                UPDATE_METADATA_#{selectedAgentId}
                            </h2>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                                {/* Agent Name */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <label style={{ fontSize: '10px', color: '#666', fontFamily: "'Press Start 2P', cursive" }}>AGENT_NAME</label>
                                    <input
                                        type="text"
                                        value={metadataForm.name}
                                        onChange={(e) => setMetadataForm(prev => ({ ...prev, name: e.target.value }))}
                                        style={{
                                            background: '#111',
                                            border: '1px solid #333',
                                            color: '#00FF41',
                                            padding: '10px',
                                            fontFamily: "'Press Start 2P', cursive",
                                            outline: 'none'
                                        }}
                                        placeholder="ENTER NAME..."
                                    />
                                </div>

                                {/* Agent Type */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <label style={{ fontSize: '10px', color: '#666', fontFamily: "'Press Start 2P', cursive" }}>AGENT_TYPE</label>
                                    <select
                                        value={metadataForm.type}
                                        onChange={(e) => setMetadataForm(prev => ({ ...prev, type: e.target.value }))}
                                        style={{
                                            background: '#111',
                                            border: '1px solid #333',
                                            color: '#00FF41',
                                            padding: '10px',
                                            fontFamily: "'Space Mono', monospace",
                                            outline: 'none',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        {AGENT_TYPES.map(type => (
                                            <option key={type} value={type}>{type.toUpperCase()}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* Description */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <label style={{ fontSize: '10px', color: '#666', fontFamily: "'Press Start 2P', cursive" }}>DESCRIPTION___BIO</label>
                                    <textarea
                                        value={metadataForm.description}
                                        onChange={(e) => setMetadataForm(prev => ({ ...prev, description: e.target.value }))}
                                        rows={4}
                                        style={{
                                            background: '#111',
                                            border: '1px solid #333',
                                            color: '#E0E0E0',
                                            padding: '10px',
                                            fontFamily: "'Space Mono', monospace",
                                            outline: 'none',
                                            resize: 'vertical'
                                        }}
                                        placeholder="Enter agent backstory and capabilities..."
                                    />
                                </div>

                                <div style={{ borderBottom: '1px dashed #333', margin: '1rem 0' }}></div>

                                {/* Advanced Fields */}
                                <details>
                                    <summary style={{ color: '#666', fontSize: '10px', fontFamily: "'Press Start 2P', cursive", cursor: 'pointer', marginBottom: '1rem' }}>
                                        ADVANCED_SETTINGS
                                    </summary>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                        {[
                                            { label: 'VOICEHASH', key: 'voiceHash' },
                                            { label: 'ANIMATION URI', key: 'animationURI' },
                                            { label: 'VAULT URI', key: 'vaultURI' }
                                        ].map(field => (
                                            <div key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                <label style={{ fontSize: '10px', color: '#666', fontFamily: "'Press Start 2P', cursive" }}>{field.label}</label>
                                                <input
                                                    type="text"
                                                    value={(metadataForm as any)[field.key]}
                                                    onChange={(e) => setMetadataForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                                                    style={{
                                                        background: '#111',
                                                        border: '1px solid #333',
                                                        color: '#00FF41',
                                                        padding: '10px',
                                                        fontFamily: "'Space Mono', monospace",
                                                        outline: 'none'
                                                    }}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </details>
                            </div>

                            <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                                <button
                                    onClick={() => setIsModalOpen(false)}
                                    style={{
                                        background: 'transparent',
                                        border: '1px solid #666',
                                        color: '#666',
                                        padding: '12px 24px',
                                        fontFamily: "'Press Start 2P', cursive",
                                        fontSize: '12px',
                                        cursor: 'pointer'
                                    }}
                                >
                                    CANCEL
                                </button>
                                <button
                                    onClick={handleUpdateMetadata}
                                    disabled={isUpdating}
                                    style={{
                                        background: '#00FF41',
                                        border: 'none',
                                        color: '#000',
                                        padding: '12px 24px',
                                        fontFamily: "'Press Start 2P', cursive",
                                        fontSize: '12px',
                                        cursor: isUpdating ? 'not-allowed' : 'pointer',
                                        opacity: isUpdating ? 0.5 : 1
                                    }}
                                >
                                    {isUpdating ? 'WRITING...' : 'WRITE TO CHAIN'}
                                </button>
                            </div>

                            {/* BAP-578 Control Panel */}
                            <div style={{
                                marginTop: '2rem',
                                borderTop: '1px solid #333',
                                paddingTop: '2rem'
                            }}>
                                <h3 style={{
                                    color: '#00FF41',
                                    fontFamily: "'Press Start 2P', cursive",
                                    fontSize: '14px',
                                    marginBottom: '1rem'
                                }}>
                                    BAP-578_PROTOCOLS
                                </h3>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    {/* Set Logic Address */}
                                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                            <label style={{ fontSize: '10px', color: '#666', fontFamily: "'Press Start 2P', cursive" }}>LOGIC_CONTRACT_ADDRESS</label>
                                            <input
                                                type="text"
                                                value={logicAddressInput}
                                                onChange={(e) => setLogicAddressInput(e.target.value)}
                                                placeholder="0x..."
                                                style={{
                                                    background: '#111',
                                                    border: '1px solid #333',
                                                    color: '#00FF41',
                                                    padding: '10px',
                                                    fontFamily: "'Space Mono', monospace",
                                                    outline: 'none',
                                                    width: '100%',
                                                    boxSizing: 'border-box'
                                                }}
                                            />
                                        </div>
                                        <button
                                            onClick={handleSetLogic}
                                            disabled={isUpdating}
                                            style={{
                                                background: '#333',
                                                border: '1px solid #00FF41',
                                                color: '#00FF41',
                                                padding: '10px 16px',
                                                fontFamily: "'Press Start 2P', cursive",
                                                fontSize: '10px',
                                                cursor: isUpdating ? 'not-allowed' : 'pointer',
                                                height: '40px'
                                            }}
                                        >
                                            LINK
                                        </button>
                                    </div>

                                    {/* Execute Action */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,255,65,0.05)', padding: '1rem', border: '1px dashed #00FF41' }}>
                                        <div style={{ fontSize: '10px', color: '#ccc', fontFamily: "'Space Mono', monospace" }}>
                                            ACTION: "sayHello('Hello from UI')"
                                        </div>
                                        <button
                                            onClick={handleExecuteAction}
                                            disabled={isUpdating}
                                            style={{
                                                background: '#00FF41',
                                                border: 'none',
                                                color: '#000',
                                                padding: '10px 16px',
                                                fontFamily: "'Press Start 2P', cursive",
                                                fontSize: '10px',
                                                cursor: isUpdating ? 'not-allowed' : 'pointer'
                                            }}
                                        >
                                            EXECUTE
                                        </button>
                                    </div>
                                </div>
                            </div>

                        </div>
                    </div>
                )}

                <style>{`
                    .blink { animation: blink 1s infinite; }
                    @keyframes blink { 0% { opacity: 1; } 50% { opacity: 0; } 100% { opacity: 1; } }
                `}</style>
            </div >
        </>
    );
}
