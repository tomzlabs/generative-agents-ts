import { Link, useLocation } from 'react-router-dom';

interface NavigationProps {
    account: string | null;
    onConnect: () => void;
    onDisconnect: () => void;
}

export function Navigation({ account, onConnect, onDisconnect }: NavigationProps) {
    const location = useLocation();

    const navItems = [
        { path: '/map', label: 'MAP' },
        { path: '/farm', label: 'FARM' },
        { path: '/lottery', label: 'LOTTERY' },
        { path: '/nft', label: 'MINT' },
        { path: '/whitepaper', label: 'PAPER' },
        ...(account ? [{ path: '/my-nfa', label: 'MY NFA' }] : [])
    ];

    return (
        <>
            <nav className="top-nav-shell">
                <div className="top-nav-brand">
                    <span className="top-nav-dot" />
                    <span>GEN AGENT</span>
                </div>

                <div className="top-nav-links">
                    {navItems.map((item) => {
                        const isActive = location.pathname === item.path;
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={`top-nav-link ${isActive ? 'active' : ''}`}
                            >
                                {item.label}
                            </Link>
                        );
                    })}
                </div>

                <div className="top-nav-wallet-wrap">
                    {account ? (
                        <div className="top-nav-wallet-group">
                            <button
                                className="top-nav-wallet-btn connected"
                                style={{ cursor: 'default' }}
                                type="button"
                            >
                                {`${account.slice(0, 6)}...${account.slice(-4)}`}
                            </button>
                            <button
                                onClick={onDisconnect}
                                className="top-nav-disconnect-btn"
                                type="button"
                            >
                                DISCONNECT
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={onConnect}
                            className="top-nav-wallet-btn"
                            style={{ cursor: 'pointer' }}
                            type="button"
                        >
                            LINK WALLET
                        </button>
                    )}
                </div>
            </nav>

            <style>{`
                .top-nav-shell {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    box-sizing: border-box;
                    z-index: 11000;
                    display: grid;
                    grid-template-columns: auto 1fr auto;
                    align-items: center;
                    gap: 12px;
                    padding: 10px 14px;
                    border-bottom: 3px solid #6f975f;
                    background:
                        linear-gradient(180deg, rgba(249, 255, 230, 0.96) 0%, rgba(230, 246, 191, 0.96) 100%);
                    box-shadow: 0 4px 0 rgba(86, 122, 74, 0.14), 0 12px 24px rgba(58, 85, 51, 0.12);
                    backdrop-filter: blur(4px);
                }

                .top-nav-brand {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-family: 'Press Start 2P', cursive;
                    font-size: 10px;
                    color: #355537;
                    white-space: nowrap;
                }

                .top-nav-dot {
                    width: 8px;
                    height: 8px;
                    border-radius: 999px;
                    background: #4f9b55;
                    box-shadow: 0 0 0 2px rgba(79, 155, 85, 0.2);
                    animation: navPulse 1.6s ease-in-out infinite;
                }

                .top-nav-links {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    overflow-x: auto;
                    scrollbar-width: none;
                    min-width: 0;
                }

                .top-nav-links::-webkit-scrollbar {
                    display: none;
                }

                .top-nav-link {
                    text-decoration: none;
                    border: 2px solid #7ea46a;
                    background: linear-gradient(180deg, #f9ffe6 0%, #e9f8c6 100%);
                    color: #3f6242;
                    box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.14);
                    padding: 8px 12px;
                    font-size: 11px;
                    line-height: 1;
                    font-family: 'Press Start 2P', cursive;
                    white-space: nowrap;
                    transition: transform 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
                }

                .top-nav-link:hover {
                    transform: translateY(-1px);
                    border-color: #6a9259;
                    box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.18), 0 3px 8px rgba(58, 87, 49, 0.14);
                }

                .top-nav-link.active {
                    color: #2f4b31;
                    border-color: #b7963f;
                    background: linear-gradient(180deg, #fff2be 0%, #ffe28b 100%);
                }

                .top-nav-wallet-wrap {
                    display: flex;
                    justify-content: flex-end;
                }

                .top-nav-wallet-group {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                }

                .top-nav-wallet-btn {
                    border: 2px solid #7ea46a;
                    color: #355537;
                    padding: 8px 10px;
                    font-family: 'Press Start 2P', cursive;
                    font-size: 10px;
                    text-transform: uppercase;
                    white-space: nowrap;
                    background: linear-gradient(180deg, #fff6cb 0%, #f8eebf 100%);
                    box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.14);
                }

                .top-nav-wallet-btn.connected {
                    background: linear-gradient(180deg, #e3f5ba 0%, #d5ebb3 100%);
                }

                .top-nav-disconnect-btn {
                    border: 2px solid #b17a6b;
                    color: #6c3a2d;
                    padding: 8px 10px;
                    font-family: 'Press Start 2P', cursive;
                    font-size: 10px;
                    text-transform: uppercase;
                    white-space: nowrap;
                    background: linear-gradient(180deg, #ffe4d8 0%, #ffd0bf 100%);
                    box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.14);
                    cursor: pointer;
                }

                .top-nav-disconnect-btn:hover {
                    border-color: #9d6657;
                }

                @keyframes navPulse {
                    0%, 100% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.65; transform: scale(0.9); }
                }

                @media (max-width: 980px) {
                    .top-nav-shell {
                        grid-template-columns: 1fr auto;
                        grid-template-areas:
                            "brand wallet"
                            "links links";
                        row-gap: 8px;
                        padding: 8px 10px;
                    }

                    .top-nav-brand { grid-area: brand; }
                    .top-nav-wallet-wrap { grid-area: wallet; }
                    .top-nav-links {
                        grid-area: links;
                        justify-content: flex-start;
                        padding-bottom: 2px;
                    }
                }

                @media (max-width: 560px) {
                    .top-nav-link {
                        padding: 8px 10px;
                        font-size: 10px;
                    }

                    .top-nav-wallet-btn {
                        font-size: 9px;
                        padding: 7px 8px;
                    }

                    .top-nav-disconnect-btn {
                        font-size: 9px;
                        padding: 7px 8px;
                    }

                    .top-nav-brand {
                        font-size: 9px;
                    }
                }
            `}</style>
        </>
    );
}
