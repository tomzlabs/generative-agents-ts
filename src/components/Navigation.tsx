import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useI18n } from '../i18n/I18nContext';

interface NavigationProps {
  account: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
}

type NavItem = { path: string; label: string };

export function Navigation({ account, onConnect, onDisconnect }: NavigationProps) {
  const location = useLocation();
  const { lang, setLang, t } = useI18n();
  const [moreOpen, setMoreOpen] = useState(false);

  const primaryNavItems: NavItem[] = [
    { path: '/', label: t('首页', 'Home') },
    { path: '/map', label: t('市场', 'Market') },
    { path: '/office', label: t('办公室', 'Office') },
  ];

  const secondaryNavItems: NavItem[] = [
    { path: '/nft', label: t('通行证', 'Pass') },
    { path: '/whitepaper', label: t('研究文档', 'Docs') },
    ...(account ? [{ path: '/my-nfa', label: t('我的身份', 'My Pass') }] : []),
  ];

  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  const isSecondaryActive = secondaryNavItems.some((item) => location.pathname === item.path);

  return (
    <>
      <nav className="top-nav-shell">
        <div className="top-nav-brand">
          <span className="top-nav-dot" />
          <span>BINANCE AI TOWN</span>
        </div>

        <div className="top-nav-links">
          {primaryNavItems.map((item) => {
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
          <div className="top-nav-more-wrap">
            <button
              type="button"
              className={`top-nav-link top-nav-more-btn ${isSecondaryActive || moreOpen ? 'active' : ''}`}
              onClick={() => setMoreOpen((prev) => !prev)}
            >
              {t('更多', 'More')}
            </button>
            {moreOpen ? (
              <div className="top-nav-more-menu">
                {secondaryNavItems.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={`top-nav-more-link ${isActive ? 'active' : ''}`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
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
          border-bottom: 1px solid rgba(186, 145, 20, 0.42);
          border-top: 1px solid rgba(255, 245, 201, 0.2);
          background:
            radial-gradient(circle at 100% 0%, rgba(255, 214, 92, 0.1), transparent 36%),
            linear-gradient(180deg, rgba(26, 23, 14, 0.96) 0%, rgba(16, 15, 11, 0.92) 100%);
          box-shadow:
            0 3px 0 rgba(126, 96, 17, 0.24),
            0 16px 30px rgba(8, 8, 7, 0.3),
            inset 0 1px 0 rgba(255, 232, 163, 0.08);
          backdrop-filter: blur(10px) saturate(1.08);
        }

        .top-nav-brand {
          display: flex;
          align-items: center;
          gap: 8px;
          font-family: 'Press Start 2P', cursive;
          font-size: 10px;
          color: #f0c34e;
          white-space: nowrap;
          padding: 8px 11px;
          border: 1px solid rgba(186, 145, 20, 0.52);
          background: linear-gradient(180deg, rgba(45, 39, 23, 0.92), rgba(24, 21, 13, 0.92));
          border-radius: 8px;
          box-shadow: inset 0 1px 0 rgba(255, 232, 166, 0.08), 0 3px 9px rgba(0, 0, 0, 0.26);
        }

        .top-nav-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: #f0b90b;
          box-shadow: 0 0 0 2px rgba(240, 185, 11, 0.18), 0 0 12px rgba(240, 185, 11, 0.36);
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
          border: 1px solid rgba(171, 134, 20, 0.82);
          background:
            radial-gradient(circle at 100% 0%, rgba(255, 214, 92, 0.12), transparent 30%),
            linear-gradient(180deg, rgba(46, 39, 22, 0.94) 0%, rgba(23, 20, 12, 0.94) 100%);
          color: #efd070;
          box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.22);
          padding: 8px 11px;
          font-size: 11px;
          line-height: 1;
          font-family: 'Press Start 2P', cursive;
          white-space: nowrap;
          border-radius: 8px;
          transition: transform 0.12s ease, border-color 0.12s ease, box-shadow 0.14s ease, filter 0.14s ease;
        }

        .top-nav-link:hover {
          transform: translateY(-1px);
          border-color: #f0b90b;
          box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.2), 0 8px 14px rgba(15, 13, 7, 0.32);
          filter: saturate(1.08);
        }

        .top-nav-link.active {
          color: #2d2308;
          border-color: #f0b90b;
          background: linear-gradient(180deg, #ffe08a 0%, #f0b90b 100%);
          box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.16), 0 6px 12px rgba(169, 124, 11, 0.34);
        }

        .top-nav-more-wrap {
          position: relative;
        }

        .top-nav-more-btn {
          cursor: pointer;
        }

        .top-nav-more-menu {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          min-width: 150px;
          border: 1px solid #9f7b18;
          border-radius: 10px;
          background:
            radial-gradient(circle at 100% 0%, rgba(255, 214, 92, 0.1), transparent 30%),
            linear-gradient(180deg, rgba(43, 37, 21, 0.98) 0%, rgba(19, 17, 10, 0.96) 100%);
          box-shadow: inset 0 1px 0 rgba(255, 237, 173, 0.08), 0 14px 22px rgba(8, 8, 7, 0.32);
          padding: 6px;
          display: grid;
          gap: 6px;
          z-index: 12000;
        }

        .top-nav-more-link {
          text-decoration: none;
          padding: 8px 9px;
          font-family: 'Press Start 2P', cursive;
          font-size: 10px;
          color: #efcf70;
          border: 1px solid rgba(160, 125, 24, 0.82);
          border-radius: 7px;
          background: linear-gradient(180deg, rgba(53, 46, 26, 0.96), rgba(24, 21, 13, 0.96));
          box-shadow: inset 0 -2px 0 rgba(0,0,0,0.18);
        }

        .top-nav-more-link.active {
          color: #3f371f;
          border-color: #b48e3c;
          background: linear-gradient(180deg, #fff5ce 0%, #ffe287 100%);
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
