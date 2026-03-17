import { Link } from 'react-router-dom';
import { CHAIN_CONFIG } from '../config/chain';
import { useI18n } from '../i18n/I18nContext';

type HomePageProps = {
  account: string | null;
  ownedTokens: number[];
};

function shortAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

export function HomePage(props: HomePageProps) {
  const { account, ownedTokens } = props;
  const { t } = useI18n();

  const quickItems = [
    {
      title: t('进入市场地图', 'Open Market Map'),
      desc: t('进入 Binance AI Town 主地图，查看市场区域、图谱人物和事件任务。', 'Enter the Binance AI Town map to explore market districts, graph citizens, and live quests.'),
      to: '/map',
    },
    {
      title: t('Alpha 运行台', 'Alpha Runtime'),
      desc: t('在高级面板里驱动 Agent、图谱同步和市场模拟。', 'Use the advanced panel to drive agents, graph sync, and market simulation.'),
      to: '/map',
    },
    {
      title: t('策略金库', 'Strategy Vault'),
      desc: t('进入链上策略与 farming 区，管理土地、产出和奖池循环。', 'Enter the on-chain strategy and farming zone to manage land, yield, and reward loops.'),
      to: '/farm',
    },
  ];

  return (
    <div className="home-conway-page">
      <section className="home-conway-hero ga-card-surface">
        <div className="home-conway-hero-badges">
          <span className="ga-chip">{t('Binance 生态模式', 'Binance Ecosystem Mode')}</span>
          <span className="ga-chip">{t('市场 · 图谱 · Agent', 'Market · Graph · Agent')}</span>
        </div>
        <h1>BINANCE AI TOWN / Alpha</h1>
        <p>
          {t(
            '首页现在聚焦 Binance AI Town 主线：先看链上与市场状态，再进入地图执行任务、查看图谱角色，并让 Agent 推动世界变化。',
            'Home now follows the Binance AI Town loop: check on-chain and market status first, then enter the map to run quests, inspect graph actors, and let agents move the world forward.',
          )}
        </p>
        <div className="home-conway-hero-cta">
          <Link className="ga-btn home-conway-main-btn" to="/map">
            {t('进入交易小镇', 'Enter Market Town')}
          </Link>
          <Link className="ga-btn home-conway-sub-btn" to="/whitepaper">
            {t('查看 Alpha 指南', 'Read Alpha Guide')}
          </Link>
        </div>
      </section>

      <section className="home-conway-grid">
        <article className="home-conway-card ga-card-surface">
          <h2>{t('实时状态', 'Live Status')}</h2>
          <div className="home-conway-kv">
            <span>{t('钱包', 'Wallet')}</span>
            <strong>{account ? shortAddress(account) : t('未连接', 'Disconnected')}</strong>
          </div>
          <div className="home-conway-kv">
            <span>{t('持有 NFA', 'Owned NFA')}</span>
            <strong>{ownedTokens.length}</strong>
          </div>
          <div className="home-conway-kv">
            <span>{t('策略金库合约', 'Strategy Vault')}</span>
            <strong>{shortAddress(CHAIN_CONFIG.farmAddress)}</strong>
          </div>
          <div className="home-conway-kv">
            <span>{t('BAI Token', 'BAI Token')}</span>
            <strong>{shortAddress(CHAIN_CONFIG.tokenAddress)}</strong>
          </div>
          <div className="home-conway-kv">
            <span>{t('身份通行证', 'Identity Pass')}</span>
            <strong>{shortAddress(CHAIN_CONFIG.nfaAddress)}</strong>
          </div>
        </article>

        <article className="home-conway-card ga-card-surface">
          <h2>{t('Alpha 操作路径', 'Alpha Flow')}</h2>
          <ol className="home-conway-flow">
            <li>{t('连接钱包并进入 Binance AI Town 地图。', 'Connect wallet and enter the Binance AI Town map.')}</li>
            <li>{t('打开“高级面板”，进入 Alpha Runtime 与 MiroFish Link。', 'Open the Advanced panel to enter Alpha Runtime and MiroFish Link.')}</li>
            <li>{t('同步图谱、加载 demo 或创建 sandbox，让 Agent 接管市场角色。', 'Sync the graph, load the demo, or create a sandbox so agents can steer market actors.')}</li>
            <li>{t('查看 NPC 的报告、采访和关系线，把研究结果投射回地图。', 'Inspect NPC reports, interviews, and relation lines to project research back into the map.')}</li>
          </ol>
          <div className="home-conway-tip">
            {t(
              '建议输出 JSON：agents[{id/name, thought, status, intent, sector}] + market_broadcast。',
              'Recommended JSON output: agents[{id/name, thought, status, intent, sector}] + market_broadcast.',
            )}
          </div>
        </article>
      </section>

      <section className="home-conway-actions">
        {quickItems.map((item) => (
          <Link key={item.title} to={item.to} className="home-conway-action-card ga-card-surface">
            <div className="home-conway-action-title">{item.title}</div>
            <div className="home-conway-action-desc">{item.desc}</div>
          </Link>
        ))}
      </section>

      <style>{`
        .home-conway-page {
          width: min(1180px, calc(100vw - 28px));
          margin: 18px auto 44px;
          display: grid;
          gap: 16px;
        }

        .home-conway-hero {
          padding: 20px 20px 18px;
          display: grid;
          gap: 12px;
        }

        .home-conway-hero-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .home-conway-hero h1 {
          margin: 0;
          font-family: var(--font-pixel);
          font-size: clamp(18px, 2.6vw, 30px);
          line-height: 1.25;
          color: #3a2d09;
        }

        .home-conway-hero p {
          margin: 0;
          font-size: 13px;
          color: #604d16;
          line-height: 1.72;
          max-width: 820px;
        }

        .home-conway-hero-cta {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 2px;
        }

        .home-conway-main-btn,
        .home-conway-sub-btn {
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 42px;
          padding: 0 14px;
        }

        .home-conway-main-btn {
          background: linear-gradient(180deg, #ffe79a 0%, #f0b90b 100%);
          border-color: #9f7f13;
          color: #2a2208;
        }

        .home-conway-sub-btn {
          background: linear-gradient(180deg, #2f2a18 0%, #18160d 100%);
          border-color: #b6921a;
          color: #f7e3a1;
        }

        .home-conway-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }

        .home-conway-card {
          padding: 14px;
          display: grid;
          gap: 8px;
        }

        .home-conway-card h2 {
          margin: 0 0 2px;
          font-size: 14px;
          font-family: var(--font-pixel);
          color: #4a390d;
        }

        .home-conway-kv {
          display: grid;
          grid-template-columns: 120px 1fr;
          gap: 8px;
          font-size: 12px;
          color: #68551d;
        }

        .home-conway-kv strong {
          color: #3f320f;
          font-weight: 700;
          word-break: break-all;
        }

        .home-conway-flow {
          margin: 4px 0 0;
          padding-left: 18px;
          display: grid;
          gap: 8px;
          font-size: 12px;
          color: #5e4f24;
          line-height: 1.65;
        }

        .home-conway-tip {
          margin-top: 6px;
          border: 1px dashed #779e68;
          background: rgba(246, 255, 223, 0.8);
          color: #38563f;
          border-radius: 8px;
          padding: 8px 10px;
          font-size: 11px;
          line-height: 1.6;
        }

        .home-conway-actions {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }

        .home-conway-action-card {
          text-decoration: none;
          color: inherit;
          padding: 13px;
          display: grid;
          gap: 6px;
          transition: transform 0.12s ease, box-shadow 0.14s ease, border-color 0.14s ease;
        }

        .home-conway-action-card:hover {
          transform: translateY(-1px);
          border-color: #5b8455;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.64), 0 18px 30px rgba(48, 73, 58, 0.18);
        }

        .home-conway-action-title {
          font-family: var(--font-pixel);
          font-size: 11px;
          color: #2f4b37;
          line-height: 1.45;
        }

        .home-conway-action-desc {
          font-size: 12px;
          color: #4a694c;
          line-height: 1.68;
        }

        @media (max-width: 980px) {
          .home-conway-grid {
            grid-template-columns: 1fr;
          }

          .home-conway-actions {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
