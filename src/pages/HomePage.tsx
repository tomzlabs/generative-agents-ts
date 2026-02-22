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
      title: t('进入地图', 'Open Map'),
      desc: t('进入 AI 小镇主地图，进行移动、互动和任务。', 'Enter the main town map for movement, interaction, and quests.'),
      to: '/map',
    },
    {
      title: t('Conway 控制', 'Conway Control'),
      desc: t('在地图高级面板中创建 sandbox 并运行 Agent。', 'Create sandbox and run Agent in the map advanced panel.'),
      to: '/map',
    },
    {
      title: t('链上农场', 'On-chain Farm'),
      desc: t('购买土地/种子，种植收获并参与开奖循环。', 'Buy land/seeds, plant/harvest, and join lottery loops.'),
      to: '/farm',
    },
  ];

  return (
    <div className="home-conway-page">
      <section className="home-conway-hero ga-card-surface">
        <div className="home-conway-hero-badges">
          <span className="ga-chip">{t('Conway 模式', 'Conway Mode')}</span>
          <span className="ga-chip">{t('地图 · 合约 · Agent', 'Map · Contract · Agent')}</span>
        </div>
        <h1>AI TOWN / Conway</h1>
        <p>
          {t(
            '首页采用 Conway 主线：先看全局状态，再进入地图执行与验证。减少信息噪音，只保留关键操作。',
            'Home follows the Conway main path: check global status first, then enter the map to execute and verify. Less noise, key actions only.',
          )}
        </p>
        <div className="home-conway-hero-cta">
          <Link className="ga-btn home-conway-main-btn" to="/map">
            {t('开始进入小镇', 'Enter Town')}
          </Link>
          <Link className="ga-btn home-conway-sub-btn" to="/whitepaper">
            {t('查看玩法文档', 'Read Guide')}
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
            <span>{t('Farm 合约', 'Farm Contract')}</span>
            <strong>{shortAddress(CHAIN_CONFIG.farmAddress)}</strong>
          </div>
          <div className="home-conway-kv">
            <span>{t('Token 合约', 'Token Contract')}</span>
            <strong>{shortAddress(CHAIN_CONFIG.tokenAddress)}</strong>
          </div>
          <div className="home-conway-kv">
            <span>{t('NFA 合约', 'NFA Contract')}</span>
            <strong>{shortAddress(CHAIN_CONFIG.nfaAddress)}</strong>
          </div>
        </article>

        <article className="home-conway-card ga-card-surface">
          <h2>{t('Conway 操作路径', 'Conway Flow')}</h2>
          <ol className="home-conway-flow">
            <li>{t('连接钱包并进入地图。', 'Connect wallet and open map.')}</li>
            <li>{t('打开“高级面板”，进入 Conway Runtime。', 'Open Advanced panel, then Conway Runtime.')}</li>
            <li>{t('创建 Sandbox，执行 Agent Prompt。', 'Create sandbox and run Agent prompt.')}</li>
            <li>{t('将输出应用到 NPC，观察小镇行为变化。', 'Apply output to NPCs and observe behavior changes.')}</li>
          </ol>
          <div className="home-conway-tip">
            {t(
              '建议输出 JSON：agents[{id/name, thought, status, intent}] + broadcast。',
              'Recommended JSON output: agents[{id/name, thought, status, intent}] + broadcast.',
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
          color: #2f4936;
        }

        .home-conway-hero p {
          margin: 0;
          font-size: 13px;
          color: #456347;
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
          background: linear-gradient(180deg, #fff2bf 0%, #ffd76d 100%);
          border-color: #b68a33;
          color: #4f3a19;
        }

        .home-conway-sub-btn {
          background: linear-gradient(180deg, #f8ffdc 0%, #ddf3b5 100%);
          border-color: #66905b;
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
          color: #2e4c38;
        }

        .home-conway-kv {
          display: grid;
          grid-template-columns: 120px 1fr;
          gap: 8px;
          font-size: 12px;
          color: #4a6949;
        }

        .home-conway-kv strong {
          color: #2c4732;
          font-weight: 700;
          word-break: break-all;
        }

        .home-conway-flow {
          margin: 4px 0 0;
          padding-left: 18px;
          display: grid;
          gap: 8px;
          font-size: 12px;
          color: #456347;
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
