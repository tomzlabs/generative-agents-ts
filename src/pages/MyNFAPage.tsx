import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ethers } from 'ethers';
import { CHAIN_CONFIG } from '../config/chain';

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

type RuntimePanelConfig = {
    agentId: string;
    logicAddress: string;
    executorAddress: string;
    message: string;
    rpcUrl: string;
    nfaAddress: string;
    legacyMode: boolean;
};

const RUNTIME_PANEL_KEY = 'ga:runtime:panel-v1';
const LEGACY_ONLY_NFA = true;

function loadRuntimePanelConfig(): RuntimePanelConfig {
    if (typeof window === 'undefined') {
        return {
            agentId: '',
            logicAddress: '',
            executorAddress: '',
            message: 'Hello from AI Runtime',
            rpcUrl: CHAIN_CONFIG.rpcUrl,
            nfaAddress: CHAIN_CONFIG.nfaAddress,
            legacyMode: true,
        };
    }

    try {
        const raw = window.localStorage.getItem(RUNTIME_PANEL_KEY);
        if (!raw) {
            return {
                agentId: '',
                logicAddress: '',
                executorAddress: '',
                message: 'Hello from AI Runtime',
                rpcUrl: CHAIN_CONFIG.rpcUrl,
                nfaAddress: CHAIN_CONFIG.nfaAddress,
                legacyMode: true,
            };
        }
        const parsed = JSON.parse(raw) as Partial<RuntimePanelConfig>;
        return {
            agentId: parsed.agentId ?? '',
            logicAddress: parsed.logicAddress ?? '',
            executorAddress: parsed.executorAddress ?? '',
            message: parsed.message ?? 'Hello from AI Runtime',
            rpcUrl: parsed.rpcUrl || CHAIN_CONFIG.rpcUrl,
            nfaAddress: CHAIN_CONFIG.nfaAddress,
            legacyMode: true,
        };
    } catch {
        return {
            agentId: '',
            logicAddress: '',
            executorAddress: '',
            message: 'Hello from AI Runtime',
            rpcUrl: CHAIN_CONFIG.rpcUrl,
            nfaAddress: CHAIN_CONFIG.nfaAddress,
            legacyMode: true,
        };
    }
}

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
    const [runtimePanel, setRuntimePanel] = useState<RuntimePanelConfig>(() => loadRuntimePanelConfig());
    const [runtimePanelOpen, setRuntimePanelOpen] = useState(false);

    const handleLoadMore = () => {
        setVisibleCount(prev => prev + 20);
    };

    const visibleAgents = Math.min(visibleCount, ownedTokens.length);
    const shortContract = `${CHAIN_CONFIG.nfaAddress.slice(0, 6)}...${CHAIN_CONFIG.nfaAddress.slice(-4)}`;
    const networkLabel = CHAIN_CONFIG.rpcUrl.includes('bsc') ? 'BSC MAINNET' : 'CUSTOM RPC';

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(RUNTIME_PANEL_KEY, JSON.stringify(runtimePanel));
    }, [runtimePanel]);

    useEffect(() => {
        setRuntimePanel((prev) => {
            const forcedLegacyMode = LEGACY_ONLY_NFA ? true : prev.legacyMode;
            if (prev.legacyMode === forcedLegacyMode && prev.nfaAddress === CHAIN_CONFIG.nfaAddress) return prev;
            return {
                ...prev,
                legacyMode: forcedLegacyMode,
                nfaAddress: CHAIN_CONFIG.nfaAddress,
            };
        });
    }, []);

    const runtimeCommand = useMemo(() => {
        const agentId = runtimePanel.agentId || '0';
        const logicPart = runtimePanel.logicAddress ? `LOGIC_ADDRESS=${runtimePanel.logicAddress} \\\n` : '';
        const legacyPart = 'LEGACY_MODE=1 \\\n';
        const message = (runtimePanel.message || 'Hello from AI Runtime').replace(/"/g, '\\"');
        return `RPC_URL=${runtimePanel.rpcUrl} \\
PRIVATE_KEY=0x... \\
NFA_ADDRESS=${CHAIN_CONFIG.nfaAddress} \\
AGENT_ID=${agentId} \\
${legacyPart}${logicPart}SAY_MESSAGE="${message}" \\
node --loader ts-node/esm scripts/agent-runner.ts`;
    }, [runtimePanel.agentId, runtimePanel.logicAddress, runtimePanel.message, runtimePanel.rpcUrl]);

    const copyRuntimeCommand = async () => {
        try {
            await navigator.clipboard.writeText(runtimeCommand);
            alert('Runtime command copied!');
        } catch (err) {
            console.error(err);
            alert('Failed to copy runtime command');
        }
    };

    const openEditModal = async (id: number) => {
        setSelectedAgentId(id);
        setIsModalOpen(true);
        setRuntimePanel(prev => ({ ...prev, agentId: String(id) }));
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
                const contract = new ethers.Contract(CHAIN_CONFIG.nfaAddress, [
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
    const [executorAddressInput, setExecutorAddressInput] = useState('');

    const handleSetLogic = async () => {
        if (!selectedAgentId || !window.ethereum || !logicAddressInput) return;
        setIsUpdating(true);
        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const contract = new ethers.Contract(CHAIN_CONFIG.nfaAddress, [
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

    const handleSetExecutor = async () => {
        if (!selectedAgentId || !window.ethereum) return;
        setIsUpdating(true);
        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const contract = new ethers.Contract(CHAIN_CONFIG.nfaAddress, [
                "function setActionExecutor(uint256 tokenId, address executor) external"
            ], signer);

            const tx = await contract.setActionExecutor(selectedAgentId, executorAddressInput || ethers.ZeroAddress);
            await tx.wait();
            alert(executorAddressInput ? "Action Executor Updated!" : "Action Executor Cleared!");
        } catch (err: any) {
            console.error(err);
            alert("Executor Update Failed: " + (err.reason || err.message));
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
            const contract = new ethers.Contract(CHAIN_CONFIG.nfaAddress, [
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
            const contract = new ethers.Contract(CHAIN_CONFIG.nfaAddress, [
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
                contract: CHAIN_CONFIG.nfaAddress,
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
            <div className="mynfa-shell" style={{
                width: '100%',
                minHeight: '100%',
                backgroundColor: '#eafbcc',
                color: '#2f4a31',
                fontFamily: "'Space Mono', monospace",
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                paddingTop: '5vh',
                position: 'relative',
                zIndex: 1
            }}>
                <div className="mynfa-content" style={{
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
                        color: '#2f4a31',
                        marginBottom: '4vh',
                        textTransform: 'uppercase',
                        textShadow: '0 1px 0 rgba(255,255,255,0.4)'
                    }}>
                        MY OPERATIVES <span className="blink">_</span>
                    </h1>

                    {!account ? (
                        <div className="ga-card-surface" style={{
                            padding: '4rem',
                            textAlign: 'center',
                            backgroundColor: 'rgba(246, 255, 226, 0.9)'
                        }}>
                            <div style={{ marginBottom: '2rem', color: '#5f7e5f' }}>ACCESS DENIED</div>
                            <div style={{ color: '#4f9b55', fontFamily: "'Press Start 2P', cursive", fontSize: '12px' }}>
                                &lt; PLEASE CONNECT WALLET &gt;
                            </div>
                        </div>
                    ) : (
                        <div style={{ width: '100%' }}>
                            <div className="mynfa-status-row ga-card-surface" style={{
                                fontFamily: "'Space Mono', monospace",
                                fontSize: '12px',
                                color: '#5f7e5f',
                                marginBottom: '2vh',
                                padding: '10px 12px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                borderRadius: 8,
                            }}>
                                <span>STATUS: {isScanning ? <span style={{ color: '#4f9b55' }} className="blink">SCANNING NETWORK...</span> : 'ONLINE'}</span>
                                <span>COUNT: {ownedTokens.length} (SHOWING {Math.min(visibleCount, ownedTokens.length)})</span>
                            </div>

                            <div className="mynfa-metric-grid">
                                <div className="mynfa-metric-card ga-card-surface">
                                    <div className="mynfa-metric-label">NETWORK</div>
                                    <div className="mynfa-metric-value">{networkLabel}</div>
                                </div>
                                <div className="mynfa-metric-card ga-card-surface">
                                    <div className="mynfa-metric-label">CONTRACT</div>
                                    <div className="mynfa-metric-value">{shortContract}</div>
                                </div>
                                <div className="mynfa-metric-card ga-card-surface">
                                    <div className="mynfa-metric-label">OWNED AGENTS</div>
                                    <div className="mynfa-metric-value">{ownedTokens.length}</div>
                                </div>
                                <div className="mynfa-metric-card ga-card-surface">
                                    <div className="mynfa-metric-label">VISIBLE</div>
                                    <div className="mynfa-metric-value">{visibleAgents}</div>
                                </div>
                            </div>

                            <div className="mynfa-runtime-panel ga-card-surface" style={{ marginBottom: '1.4rem', background: 'rgba(246, 255, 226, 0.9)' }}>
                                <button
                                    onClick={() => setRuntimePanelOpen(prev => !prev)}
                                    className="mynfa-runtime-toggle ga-btn"
                                    style={{
                                        width: '100%',
                                        borderBottom: runtimePanelOpen ? '1px solid #7ea46a' : 'none',
                                        padding: '10px 12px',
                                        textAlign: 'left',
                                        cursor: 'pointer'
                                    }}
                                >
                                    {runtimePanelOpen ? '[-] RUNTIME CONFIG PANEL' : '[+] RUNTIME CONFIG PANEL'}
                                </button>
                                {runtimePanelOpen && (
                                    <div style={{ padding: '12px', display: 'grid', gap: '10px' }}>
                                        <div className="ga-field-grid">
                                            <span className="ga-label">MODE</span>
                                            <span style={{ fontSize: '12px', color: '#2f4a31' }}>
                                                LEGACY CONTRACT MODE (NFA2 owner-only) - LOCKED
                                            </span>
                                            <span className="ga-label">RPC URL</span>
                                            <input
                                                className="ga-input"
                                                value={runtimePanel.rpcUrl}
                                                onChange={(e) => setRuntimePanel(prev => ({ ...prev, rpcUrl: e.target.value }))}
                                            />
                                            <span className="ga-label">NFA ADDRESS</span>
                                            <input
                                                className="ga-input"
                                                value={CHAIN_CONFIG.nfaAddress}
                                                disabled
                                            />
                                            <span className="ga-label">AGENT ID</span>
                                            <input
                                                className="ga-input"
                                                value={runtimePanel.agentId}
                                                onChange={(e) => setRuntimePanel(prev => ({ ...prev, agentId: e.target.value.replace(/[^\d]/g, '') }))}
                                                placeholder="0"
                                            />
                                            <span className="ga-label">LOGIC ADDRESS</span>
                                            <input
                                                className="ga-input"
                                                value={runtimePanel.logicAddress}
                                                onChange={(e) => setRuntimePanel(prev => ({ ...prev, logicAddress: e.target.value }))}
                                                placeholder="0x..."
                                            />
                                            <span className="ga-label">MESSAGE</span>
                                            <input
                                                className="ga-input"
                                                value={runtimePanel.message}
                                                onChange={(e) => setRuntimePanel(prev => ({ ...prev, message: e.target.value }))}
                                            />
                                        </div>

                                        <div className="ga-note-box">
                                            使用教程：
                                            <br />1. 先确认你钱包是 `AGENT ID` 对应 NFT 的 owner。
                                            <br />2. 先在链上允许 logic（项目 owner 调 `setAllowedLogicContract`）。
                                            <br />3. 在编辑弹窗点 `LINK` 把 logic 绑定到该 token。
                                            <br />4. 当前页面已锁定旧合约模式，`EXECUTOR` 不生效。
                                            <br />5. 点击 `COPY COMMAND`，在终端运行即可。
                                        </div>

                                        <div className="ga-code-box">
                                            {runtimeCommand}
                                        </div>

                                        <div className="mynfa-inline-actions" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                            <button
                                                className="ga-btn mynfa-inline-btn"
                                                onClick={copyRuntimeCommand}
                                                style={{
                                                    padding: '8px 12px',
                                                    cursor: 'pointer'
                                                }}
                                            >
                                                COPY COMMAND
                                            </button>
                                            <button
                                                className="ga-btn mynfa-inline-btn mynfa-inline-btn-alt"
                                                onClick={() => setRuntimePanel({
                                                    agentId: '',
                                                    logicAddress: '',
                                                    executorAddress: '',
                                                    message: 'Hello from AI Runtime',
                                                    rpcUrl: CHAIN_CONFIG.rpcUrl,
                                                    nfaAddress: CHAIN_CONFIG.nfaAddress,
                                                    legacyMode: true,
                                                })}
                                                style={{
                                                    padding: '8px 12px',
                                                    cursor: 'pointer'
                                                }}
                                            >
                                                RESET PANEL
                                            </button>
                                        </div>
                                        <div className="ga-help-text">
                                            ENV DEFAULTS: `VITE_BSC_RPC_URL`, `VITE_TOKEN_ADDRESS` | Runtime: `LEGACY_MODE`
                                        </div>
                                    </div>
                                )}
                            </div>

                            {ownedTokens.length === 0 && !isScanning && (
                                <div style={{
                                    textAlign: 'center',
                                    padding: '5vh 0',
                                    color: '#5f7e5f'
                                }}>
                                    NO AGENTS DETECTED IN SECTOR.
                                    <br /><br />
                                    <Link to="/nft" style={{ color: '#4f9b55', textDecoration: 'none' }}>[ MINT NEW AGENT ]</Link>
                                </div>
                            )}

                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                                gap: '2rem',
                                width: '100%'
                            }}>
                                {ownedTokens.slice(0, visibleCount).map(id => (
                                    <div className="mynfa-agent-card ga-card-surface" key={id} style={{
                                        background: 'linear-gradient(180deg, rgba(255,255,255,0.72), rgba(239,252,210,0.84))',
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
                                            background: '#4f9b55',
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
                                            backgroundColor: '#f6ffd8',
                                            border: '1px solid #7ea46a',
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
                                            <div style={{ fontSize: '12px', color: '#2f4a31', fontFamily: "'Press Start 2P', cursive" }}>AGENT #{id}</div>
                                            <div style={{ fontSize: '10px', color: '#5f7e5f' }}>CLAS: NFA-BAP578</div>
                                        </div>

                                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto' }}>
                                            <button
                                                className="ga-btn mynfa-inline-btn"
                                                onClick={() => openEditModal(id)}
                                                style={{
                                                    flex: 1,
                                                    padding: '8px',
                                                    cursor: 'pointer',
                                                    textAlign: 'center',
                                                    textTransform: 'uppercase'
                                                }}
                                            >
                                                EDIT
                                            </button>
                                            <button
                                                className="ga-btn mynfa-inline-btn mynfa-inline-btn-alt"
                                                onClick={() => downloadAgentJson(id)}
                                                style={{
                                                    flex: 1,
                                                    padding: '8px',
                                                    cursor: 'pointer',
                                                    textAlign: 'center',
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
                                        className="ga-btn mynfa-load-more-btn"
                                        onClick={handleLoadMore}
                                        style={{
                                            padding: '1rem 3rem',
                                            cursor: 'pointer',
                                            fontSize: '12px',
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
                        backgroundColor: 'rgba(219, 239, 181, 0.93)',
                        zIndex: 20000,
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center'
                    }}>
                        <div className="mynfa-modal-card ga-card-surface" style={{
                            width: '95%',
                            maxWidth: '420px',
                            backgroundColor: '#f6ffd8',
                            padding: '1.2rem',
                            position: 'relative',
                            boxShadow: '0 0 20px rgba(79, 155, 85, 0.12)',
                            maxHeight: '80vh',
                            overflowY: 'auto',
                            display: 'flex',
                            flexDirection: 'column',
                            marginTop: '5vh' // Push down slightly from center
                        }}>
                            <button
                                className="ga-btn mynfa-modal-close"
                                onClick={() => setIsModalOpen(false)}
                                style={{
                                    position: 'absolute',
                                    top: '0.8rem',
                                    right: '0.8rem',
                                    padding: '6px 8px',
                                    cursor: 'pointer'
                                }}
                            >
                                X
                            </button>

                            <h2 style={{
                                color: '#4f9b55',
                                fontFamily: "'Press Start 2P', cursive",
                                fontSize: '16px',
                                marginBottom: '2rem',
                                borderBottom: '1px solid #7ea46a',
                                paddingBottom: '1rem'
                            }}>
                                UPDATE_METADATA_#{selectedAgentId}
                            </h2>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                                {/* Agent Name */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <label className="ga-label">AGENT NAME</label>
                                    <input
                                        className="ga-input"
                                        type="text"
                                        value={metadataForm.name}
                                        onChange={(e) => setMetadataForm(prev => ({ ...prev, name: e.target.value }))}
                                        style={{ fontFamily: "'Press Start 2P', cursive" }}
                                        placeholder="ENTER NAME..."
                                    />
                                </div>

                                {/* Agent Type */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <label className="ga-label">AGENT TYPE</label>
                                    <select
                                        className="ga-select"
                                        value={metadataForm.type}
                                        onChange={(e) => setMetadataForm(prev => ({ ...prev, type: e.target.value }))}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        {AGENT_TYPES.map(type => (
                                            <option key={type} value={type}>{type.toUpperCase()}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* Description */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <label className="ga-label">DESCRIPTION / BIO</label>
                                    <textarea
                                        className="ga-textarea"
                                        value={metadataForm.description}
                                        onChange={(e) => setMetadataForm(prev => ({ ...prev, description: e.target.value }))}
                                        rows={4}
                                        placeholder="Enter agent backstory and capabilities..."
                                    />
                                </div>

                                <div style={{ borderBottom: '1px dashed #7ea46a', margin: '1rem 0' }}></div>

                                {/* Advanced Fields */}
                                <details>
                                    <summary className="ga-label" style={{ cursor: 'pointer', marginBottom: '1rem' }}>
                                        ADVANCED_SETTINGS
                                    </summary>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                        {[
                                            { label: 'VOICEHASH', key: 'voiceHash' },
                                            { label: 'ANIMATION URI', key: 'animationURI' },
                                            { label: 'VAULT URI', key: 'vaultURI' }
                                        ].map(field => (
                                            <div key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                <label className="ga-label">{field.label}</label>
                                                <input
                                                    className="ga-input"
                                                    type="text"
                                                    value={(metadataForm as any)[field.key]}
                                                    onChange={(e) => setMetadataForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </details>
                            </div>

                            <div className="mynfa-modal-actions" style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                                <button
                                    className="ga-btn mynfa-inline-btn mynfa-inline-btn-alt"
                                    onClick={() => setIsModalOpen(false)}
                                    style={{
                                        padding: '12px 24px',
                                        fontSize: '12px',
                                        cursor: 'pointer'
                                    }}
                                >
                                    CANCEL
                                </button>
                                <button
                                    className="ga-btn mynfa-inline-btn"
                                    onClick={handleUpdateMetadata}
                                    disabled={isUpdating}
                                    style={{
                                        padding: '12px 24px',
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
                                borderTop: '1px solid #7ea46a',
                                paddingTop: '2rem'
                            }}>
                                <h3 style={{
                                    color: '#4f9b55',
                                    fontFamily: "'Press Start 2P', cursive",
                                    fontSize: '14px',
                                    marginBottom: '1rem'
                                }}>
                                    BAP-578_PROTOCOLS
                                </h3>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    {/* Set Logic Address */}
                                    <div className="mynfa-action-row" style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                            <label className="ga-label">LOGIC CONTRACT ADDRESS</label>
                                            <input
                                                className="ga-input"
                                                type="text"
                                                value={logicAddressInput}
                                                onChange={(e) => setLogicAddressInput(e.target.value)}
                                                placeholder="0x..."
                                                style={{
                                                    width: '100%',
                                                    boxSizing: 'border-box'
                                                }}
                                            />
                                        </div>
                                        <button
                                            className="ga-btn mynfa-inline-btn"
                                            onClick={handleSetLogic}
                                            disabled={isUpdating}
                                            style={{
                                                padding: '10px 16px',
                                                cursor: isUpdating ? 'not-allowed' : 'pointer',
                                                height: '40px'
                                            }}
                                        >
                                            LINK
                                        </button>
                                    </div>

                                    {!LEGACY_ONLY_NFA ? (
                                        <>
                                            {/* Set Action Executor */}
                                            <div className="mynfa-action-row" style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                    <label className="ga-label">ACTION EXECUTOR WALLET</label>
                                                    <input
                                                        className="ga-input"
                                                        type="text"
                                                        value={executorAddressInput}
                                                        onChange={(e) => setExecutorAddressInput(e.target.value)}
                                                        placeholder="0x... (blank to clear)"
                                                        style={{
                                                            width: '100%',
                                                            boxSizing: 'border-box'
                                                        }}
                                                    />
                                                </div>
                                                <button
                                                    className="ga-btn mynfa-inline-btn"
                                                    onClick={handleSetExecutor}
                                                    disabled={isUpdating}
                                                    style={{
                                                        padding: '10px 16px',
                                                        cursor: isUpdating ? 'not-allowed' : 'pointer',
                                                        height: '40px'
                                                    }}
                                                >
                                                    SET
                                                </button>
                                            </div>

                                            {/* Execute Action */}
                                            <div className="ga-note-box" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                                                <div className="ga-help-text" style={{ color: '#2f4a31' }}>
                                                    ACTION: "sayHello('Hello from UI')"
                                                </div>
                                                <button
                                                    className="ga-btn mynfa-inline-btn"
                                                    onClick={handleExecuteAction}
                                                    disabled={isUpdating}
                                                    style={{
                                                        padding: '10px 16px',
                                                        cursor: isUpdating ? 'not-allowed' : 'pointer'
                                                    }}
                                                >
                                                    EXECUTE
                                                </button>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="ga-note-box" style={{ color: '#2f4a31' }}>
                                            旧合约模式下不支持 EXECUTOR / EXECUTE 控制，仅保留 LINK 与 Metadata 更新。
                                        </div>
                                    )}
                                    <div className="ga-help-text">
                                        NOTE: Logic contract must be allowlisted by the contract owner before LINK.
                                    </div>
                                </div>
                            </div>

                        </div>
                    </div>
                )}

                <style>{`
                    .blink { animation: blink 1s infinite; }
                    @keyframes blink { 0% { opacity: 1; } 50% { opacity: 0; } 100% { opacity: 1; } }

                    .mynfa-shell {
                        background:
                            radial-gradient(circle at 12% 6%, rgba(255,255,255,0.45), transparent 24%),
                            radial-gradient(circle at 84% 10%, rgba(255,255,255,0.35), transparent 22%),
                            linear-gradient(180deg, #dff5bf 0%, #d3efb2 44%, #cae7a7 100%);
                    }

                    .mynfa-content {
                        animation: mynfa-entry .35s ease-out;
                    }

                    .mynfa-status-row {
                        border-radius: 8px;
                    }

                    .mynfa-metric-grid {
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
                        gap: 10px;
                        margin-bottom: 1rem;
                    }

                    .mynfa-metric-card {
                        background: linear-gradient(180deg, rgba(255,255,255,0.5), rgba(240,252,214,0.72));
                        padding: 10px 12px;
                    }

                    .mynfa-metric-label {
                        font-size: 10px;
                        letter-spacing: .08em;
                        opacity: .74;
                        margin-bottom: 6px;
                        font-family: 'Press Start 2P', cursive;
                    }

                    .mynfa-metric-value {
                        font-size: 13px;
                        font-weight: 700;
                        color: #2f4a31;
                    }

                    .mynfa-runtime-panel {
                        border-radius: 10px;
                        overflow: hidden;
                    }

                    .mynfa-runtime-toggle {
                        border: none !important;
                        border-radius: 0 !important;
                        transition: background .16s ease, transform .08s ease;
                    }

                    .mynfa-runtime-toggle:hover {
                        background: linear-gradient(180deg, rgba(252,255,236,0.95), rgba(230,244,192,0.96)) !important;
                    }

                    .mynfa-runtime-toggle:active {
                        transform: translateY(1px);
                    }

                    .mynfa-agent-card {
                        box-shadow: inset 0 1px 0 rgba(255,255,255,0.35), 0 4px 14px rgba(58, 86, 51, 0.1);
                        transition: transform .15s ease, box-shadow .15s ease;
                    }

                    .mynfa-agent-card:hover {
                        transform: translateY(-2px);
                        box-shadow: inset 0 1px 0 rgba(255,255,255,0.45), 0 8px 18px rgba(58, 86, 51, 0.16);
                    }

                    .mynfa-modal-card {
                        border-radius: 10px;
                    }

                    .mynfa-inline-btn {
                        min-height: 34px;
                        font-size: 10px !important;
                    }

                    .mynfa-inline-btn-alt {
                        background: linear-gradient(180deg, #f9ffe7 0%, #e8f8c8 100%) !important;
                    }

                    .mynfa-load-more-btn {
                        min-height: 40px;
                        font-size: 12px !important;
                    }

                    .mynfa-modal-close {
                        min-height: 28px;
                        min-width: 28px;
                        line-height: 1;
                        font-size: 10px !important;
                    }

                    .mynfa-inline-actions {
                        align-items: center;
                    }

                    .mynfa-action-row .mynfa-inline-btn {
                        min-width: 82px;
                    }

                    @keyframes mynfa-entry {
                        0% { opacity: 0; transform: translateY(6px); }
                        100% { opacity: 1; transform: translateY(0); }
                    }
                    
                    /* Responsive Modal Inputs */
                    @media (max-width: 860px) {
                        .mynfa-status-row {
                            flex-direction: column;
                            align-items: flex-start;
                            gap: 6px;
                        }
                    }

                    @media (max-width: 640px) {
                        .mynfa-modal-actions {
                            flex-direction: column;
                            align-items: stretch;
                        }

                        .mynfa-inline-actions {
                            flex-direction: column;
                            align-items: stretch;
                        }

                        .mynfa-action-row {
                            flex-direction: column;
                            align-items: stretch;
                        }
                    }

                    @media (max-height: 700px) {
                        input, select, textarea { padding: 8px !important; font-size: 12px !important; }
                        h2 { font-size: 12px !important; margin-bottom: 1rem !important; }
                        div[style*="gap: 1rem"] { gap: 0.8rem !important; }
                    }
                `}</style>
            </div >
        </>
    );
}
