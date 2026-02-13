import { Link, useLocation } from 'react-router-dom';
import { useI18n } from '../i18n/I18nContext';

interface NavigationProps {
    account: string | null;
    onConnect: () => void;
    onDisconnect: () => void;
}

export function Navigation({ account, onConnect, onDisconnect }: NavigationProps) {
    const location = useLocation();
    const { lang, setLang, t } = useI18n();

    const navItems = [
        { path: '/map', label: t('地图', 'Map') },
        { path: '/farm', label: t('农场', 'Farm') },
        { path: '/lottery', label: t('开奖', 'Lottery') },
        { path: '/nft', label: t('铸造', 'Mint') },
        { path: '/whitepaper', label: t('白皮书', 'Whitepaper') },
        ...(account ? [{ path: '/my-nfa', label: t('我的 NFA', 'My NFA') }] : [])
    ];

    return (
        <>
            <nav className="top-nav-shell">
                <div className="top-nav-brand">
                    <span className="top-nav-dot" />
                    <span>AI TOWN</span>
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
                    <div className="top-nav-lang-group">
                        <button
                            type="button"
                            className={`top-nav-lang-btn ${lang === 'zh' ? 'active' : ''}`}
                            onClick={() => setLang('zh')}
                        >
                            {t('中文', 'ZH')}
                        </button>
                        <button
                            type="button"
                            className={`top-nav-lang-btn ${lang === 'en' ? 'active' : ''}`}
                            onClick={() => setLang('en')}
                        >
                            EN
                        </button>
                    </div>
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
                                {t('退出钱包', 'Disconnect')}
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={onConnect}
                            className="top-nav-wallet-btn"
                            style={{ cursor: 'pointer' }}
                            type="button"
                        >
                            {t('连接钱包', 'Connect Wallet')}
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
                    padding: 10px clamp(10px, 2vw, 20px);
                    border-bottom: 1px solid rgba(75, 117, 84, 0.46);
                    border-top: 1px solid rgba(255, 255, 255, 0.46);
                    background:
                        radial-gradient(circle at 100% 0%, rgba(255,255,255,0.38), transparent 35%),
                        linear-gradient(180deg, rgba(249, 255, 233, 0.9) 0%, rgba(230, 246, 194, 0.86) 100%);
                    box-shadow:
                        0 3px 0 rgba(68, 102, 73, 0.16),
                        0 16px 30px rgba(41, 63, 46, 0.16),
                        inset 0 1px 0 rgba(255, 255, 255, 0.46);
                    backdrop-filter: blur(10px) saturate(1.08);
                }

                .top-nav-brand {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-family: 'Press Start 2P', cursive;
                    font-size: 10px;
                    color: #31563b;
                    white-space: nowrap;
                    padding: 8px 11px;
                    border: 1px solid rgba(109, 147, 98, 0.55);
                    background: linear-gradient(180deg, rgba(255,255,255,0.5), rgba(234, 248, 205, 0.58));
                    border-radius: 8px;
                    box-shadow: inset 0 1px 0 rgba(255,255,255,0.52), 0 3px 9px rgba(54, 85, 61, 0.12);
                }

                .top-nav-dot {
                    width: 8px;
                    height: 8px;
                    border-radius: 999px;
                    background: #4f9b55;
                    box-shadow: 0 0 0 2px rgba(79, 155, 85, 0.24), 0 0 12px rgba(79, 155, 85, 0.48);
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
                    border: 1px solid rgba(110, 150, 98, 0.78);
                    background:
                        radial-gradient(circle at 100% 0%, rgba(255,255,255,0.34), transparent 30%),
                        linear-gradient(180deg, rgba(252, 255, 237, 0.9) 0%, rgba(233, 248, 201, 0.86) 100%);
                    color: #375b40;
                    box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.12);
                    padding: 8px 12px;
                    font-size: 11px;
                    line-height: 1;
                    font-family: 'Press Start 2P', cursive;
                    white-space: nowrap;
                    border-radius: 8px;
                    transition: transform 0.12s ease, border-color 0.12s ease, box-shadow 0.14s ease, filter 0.14s ease;
                }

                .top-nav-link:hover {
                    transform: translateY(-1px);
                    border-color: #618d60;
                    box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.18), 0 8px 14px rgba(51, 82, 53, 0.16);
                    filter: saturate(1.08);
                }

                .top-nav-link.active {
                    color: #37452d;
                    border-color: #b48e3c;
                    background: linear-gradient(180deg, #fff5ce 0%, #ffe287 100%);
                    box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.14), 0 6px 12px rgba(169, 137, 61, 0.28);
                }

                .top-nav-wallet-wrap {
                    display: flex;
                    justify-content: flex-end;
                    align-items: center;
                    gap: 8px;
                }

                .top-nav-lang-group {
                    display: inline-flex;
                    border: 1px solid rgba(102, 140, 95, 0.7);
                    border-radius: 8px;
                    overflow: hidden;
                    background: linear-gradient(180deg, rgba(255,255,255,0.42), rgba(236,248,204,0.6));
                }

                .top-nav-lang-btn {
                    border: none;
                    border-right: 1px solid rgba(102, 140, 95, 0.45);
                    background: transparent;
                    color: #4c6e52;
                    padding: 8px 9px;
                    min-width: 48px;
                    font-family: 'Press Start 2P', cursive;
                    font-size: 9px;
                    cursor: pointer;
                }

                .top-nav-lang-btn:last-child {
                    border-right: none;
                }

                .top-nav-lang-btn.active {
                    color: #344c38;
                    background: linear-gradient(180deg, #fff5ce 0%, #ffe287 100%);
                }

                .top-nav-wallet-group {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                }

                .top-nav-wallet-btn {
                    border: 1px solid rgba(111, 150, 99, 0.78);
                    color: #315238;
                    padding: 8px 10px;
                    font-family: 'Press Start 2P', cursive;
                    font-size: 10px;
                    text-transform: uppercase;
                    white-space: nowrap;
                    background:
                        radial-gradient(circle at 100% 0%, rgba(255,255,255,0.3), transparent 28%),
                        linear-gradient(180deg, #fff8d6 0%, #f7edbe 100%);
                    border-radius: 8px;
                    box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.14), 0 5px 10px rgba(62, 94, 66, 0.15);
                }

                .top-nav-wallet-btn.connected {
                    background: linear-gradient(180deg, #ecfad0 0%, #d9efba 100%);
                }

                .top-nav-disconnect-btn {
                    border: 1px solid #b17a6b;
                    color: #6c3a2d;
                    padding: 8px 10px;
                    font-family: 'Press Start 2P', cursive;
                    font-size: 10px;
                    text-transform: uppercase;
                    white-space: nowrap;
                    background: linear-gradient(180deg, #ffe4d8 0%, #ffd0bf 100%);
                    border-radius: 8px;
                    box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.14), 0 2px 6px rgba(108, 58, 45, 0.14);
                    cursor: pointer;
                    transition: transform 0.12s ease, box-shadow 0.14s ease, border-color 0.14s ease;
                }

                .top-nav-disconnect-btn:hover {
                    border-color: #9d6657;
                    transform: translateY(-1px);
                    box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.18), 0 5px 12px rgba(108, 58, 45, 0.16);
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

                    .top-nav-lang-btn {
                        min-width: 44px;
                        padding: 7px 8px;
                        font-size: 8px;
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
