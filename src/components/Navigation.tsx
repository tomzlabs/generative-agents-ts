import { Link, useLocation } from 'react-router-dom';

export function Navigation() {
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
            background: 'var(--color-background)',
            borderBottom: '4px solid white',
            zIndex: 100,
            padding: '16px 0',
            display: 'flex',
            justifyContent: 'center',
            gap: '32px'
        }}>
            <Link to="/map" style={getLinkStyle('/map')}>
                VILLAGE MAP
            </Link>
            <Link to="/nft" style={getLinkStyle('/nft')}>
                MINT NFA
            </Link>
        </nav>
    );
}
