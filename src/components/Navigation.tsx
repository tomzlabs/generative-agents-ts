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
            color: isActive ? '#FCD34D' : '#FFFFFF',
            textDecoration: 'none',
            borderBottom: isActive ? '4px solid #FCD34D' : '4px solid transparent',
            padding: '8px 16px',
            fontSize: '1.2rem',
            transition: 'all 0.2s',
            textShadow: isActive ? '2px 2px 0 #000' : 'none'
        };
    };

    return (
        <nav style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            background: 'var(--color-background)', // Assuming this var exists, else fallback to #222
            backgroundColor: '#111',
            borderBottom: '4px solid #333',
            zIndex: 10001,
            padding: '16px 0',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: '32px'
        }}>
            <Link to="/map" style={getLinkStyle('/map')}>
                VILLAGE MAP
            </Link>
            <Link to="/nft" style={getLinkStyle('/nft')}>
                MINT NFA
            </Link>
            <Link to="/whitepaper" style={getLinkStyle('/whitepaper')}>
                WHITE PAPER
            </Link>

            {/* My NFA Link */}
            {account && (
                <Link to="/my-nfa" style={{ ...getLinkStyle('/my-nfa'), color: '#00FF41', borderColor: location.pathname === '/my-nfa' ? '#00FF41' : 'transparent' }}>
                    MY NFA
                </Link>
            )}

            {/* Wallet Connect Button - Absolute Right */}
            <div style={{ position: 'absolute', right: '2rem', top: '50%', transform: 'translateY(-50%)' }}>
                <button
                    onClick={onConnect}
                    style={{
                        background: account ? 'rgba(0, 255, 65, 0.1)' : 'transparent',
                        border: '1px solid #00FF41',
                        color: '#00FF41',
                        padding: '8px 16px',
                        fontFamily: "'Press Start 2P', cursive",
                        fontSize: '10px',
                        cursor: account ? 'default' : 'pointer',
                        textTransform: 'uppercase',
                        boxShadow: '0 0 10px rgba(0, 255, 65, 0.2)'
                    }}
                >
                    {account ? `[ ${account.slice(0, 6)}...${account.slice(-4)} ]` : '[ LINK_WALLET ]'}
                </button>
            </div>
        </nav>
    );
}
