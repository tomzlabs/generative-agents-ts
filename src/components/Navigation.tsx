import { Link, useLocation } from 'react-router-dom';

interface NavigationProps {
    account: string | null;
    onConnect: () => void;
}

export function Navigation({ account, onConnect }: NavigationProps) {
    const location = useLocation();

    const getLinkStyle = (path: string) => {
        const isActive = location.pathname === path;
        return {
            color: isActive ? '#3a5e3d' : '#466b48',
            textDecoration: 'none',
            border: isActive ? '2px solid #c2a24c' : '2px solid #7ea46a',
            background: isActive ? '#ffeaa8' : '#f1ffd2',
            boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.14)',
            padding: '8px 12px',
            fontSize: '0.8rem',
            fontFamily: "'Press Start 2P', cursive",
            transition: 'all 0.15s',
            whiteSpace: 'nowrap' as const
        };
    };

    return (
        <nav style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            boxSizing: 'border-box',
            background: 'linear-gradient(180deg, #f6ffd8 0%, #e6f7ba 100%)',
            borderBottom: '3px solid #7ea46a',
            zIndex: 10001,
            padding: '10px 14px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px'
        }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', overflowX: 'auto', paddingBottom: 2 }}>
                <Link to="/map" style={getLinkStyle('/map')}>
                    MAP
                </Link>
                <Link to="/farm" style={getLinkStyle('/farm')}>
                    FARM
                </Link>
                <Link to="/nft" style={getLinkStyle('/nft')}>
                    MINT
                </Link>
                <Link to="/whitepaper" style={getLinkStyle('/whitepaper')}>
                    PAPER
                </Link>
                {account && (
                    <Link to="/my-nfa" style={getLinkStyle('/my-nfa')}>
                        MY NFA
                    </Link>
                )}
            </div>
            <div style={{ flexShrink: 0 }}>
                <button
                    onClick={onConnect}
                    style={{
                        background: account ? '#dff3b2' : '#fff6cb',
                        border: '2px solid #7ea46a',
                        color: '#355537',
                        padding: '8px 10px',
                        fontFamily: "'Press Start 2P', cursive",
                        fontSize: '10px',
                        cursor: account ? 'default' : 'pointer',
                        textTransform: 'uppercase',
                        boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.14)'
                    }}
                >
                    {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : 'LINK WALLET'}
                </button>
            </div>
        </nav>
    );
}
