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

  const pulseItems = [
    {
      label: t('世界模式', 'World Mode'),
      value: t('BSC × MiroFish × Agent', 'BSC × MiroFish × Agent'),
    },
    {
      label: t('当前入口', 'Primary Loop'),
      value: t('地图探索 → 图谱人物 → 实时对话', 'Map → Graph Citizens → Live Dialog'),
    },
    {
      label: t('推荐站点', 'Recommended Hub'),
      value: t('市场地图 / 龙虾办公室', 'Market Map / Lobster Office'),
    },
  ];

  const worldCards = [
    {
      kicker: t('地图主线', 'Map Arc'),
      title: t('进入市场小镇', 'Enter Market Town'),
      desc: t(
        '在主地图里查看区域状态、图谱人物和 BSC 任务流，把首页入口变成真正的世界入口。',
        'Use the map as the real front door: inspect districts, graph citizens, and BSC missions in one world view.',
      ),
      meta: t('地图 · 任务 · 关系', 'Map · Missions · Relations'),
      to: '/map',
    },
    {
      kicker: t('角色协作', 'Agent Space'),
      title: t('打开龙虾办公室', 'Open Lobster Office'),
      desc: t(
        '让值班龙虾和 NPC 围绕 BSC 状态、Skills 热点与图谱任务实时讨论，像一个协作中的控制室。',
        'Watch lobster guests and NPCs discuss BSC state, Skills trends, and graph tasks inside a live coordination room.',
      ),
      meta: t('办公室 · 讨论 · 本地龙虾', 'Office · Discussions · Local Lobsters'),
      to: '/office',
    },
    {
      kicker: t('研究引擎', 'Research Engine'),
      title: t('驱动 Alpha Runtime', 'Drive Alpha Runtime'),
      desc: t(
        '在高级面板里同步 MiroFish 图谱、运行 Agent sandbox，并把采访、报告和关系线投射回小镇。',
        'Use the advanced runtime to sync graphs, run agent sandboxes, and project reports back into the town.',
      ),
      meta: t('Runtime · Sandbox · Reports', 'Runtime · Sandbox · Reports'),
      to: '/map',
    },
  ];

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
      title: t('龙虾办公室', 'Lobster Office'),
      desc: t('进入像素办公室，看小龙虾和 NPC 围绕 BSC 市场、链上状态与 Skills 热点实时讨论。', 'Enter the pixel office to watch Lobster guests and NPCs discuss the BSC market, chain state, and Skills trends in real time.'),
      to: '/office',
    },
  ];

  return (
    <div className="home-conway-page">
      <section className="home-conway-hero ga-card-surface">
        <div className="home-conway-hero-main">
          <div className="home-conway-hero-copy">
            <div className="home-conway-hero-badges">
              <span className="ga-chip">{t('Binance 生态模式', 'Binance Ecosystem Mode')}</span>
              <span className="ga-chip">{t('市场 · 图谱 · Agent', 'Market · Graph · Agent')}</span>
            </div>
            <h1>BINANCE AI TOWN / Alpha</h1>
            <p>
              {t(
                '把市场信号、图谱人物、Agent 运行台和办公室讨论揉成一个活着的小镇入口。先看世界状态，再进入地图，最后把研究和对话投射回角色。',
                'Turn market signals, graph citizens, agent runtime, and office discussion into a living town. Read the world state, enter the map, and project research back into the citizens.',
              )}
            </p>
            <div className="home-conway-hero-cta">
              <Link className="ga-btn home-conway-main-btn" to="/map">
                {t('进入交易小镇', 'Enter Market Town')}
              </Link>
              <Link className="ga-btn home-conway-sub-btn" to="/office">
                {t('打开龙虾办公室', 'Open Lobster Office')}
              </Link>
              <Link className="ga-btn home-conway-ghost-btn" to="/whitepaper">
                {t('查看 Alpha 指南', 'Read Alpha Guide')}
              </Link>
            </div>
          </div>

          <aside className="home-conway-hero-world ga-card-surface">
            <div className="home-conway-world-title">
              <span className="home-conway-world-dot" />
              <span>{t('世界情报', 'World Pulse')}</span>
            </div>
            <div className="home-conway-world-list">
              {pulseItems.map((item) => (
                <div key={item.label} className="home-conway-world-row">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
            <div className="home-conway-world-footer">
              {t(
                '先用首页判断世界状态，再进入地图执行。首页不再只是目录，而是小镇的前情提要。',
                'Use the homepage as the world briefing. It is not just a menu anymore; it is the first read of the town.',
              )}
            </div>
          </aside>
        </div>

        <div className="home-conway-hero-ribbon">
          {quickItems.map((item) => (
            <Link key={item.title} to={item.to} className="home-conway-ribbon-item">
              <span>{item.title}</span>
              <strong>{item.desc}</strong>
            </Link>
          ))}
        </div>
      </section>

      <section className="home-conway-world-cards">
        {worldCards.map((card) => (
          <Link key={card.title} to={card.to} className="home-conway-world-card ga-card-surface">
            <span className="home-conway-world-kicker">{card.kicker}</span>
            <h2>{card.title}</h2>
            <p>{card.desc}</p>
            <div className="home-conway-world-meta">{card.meta}</div>
          </Link>
        ))}
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
            <span>{t('BSC', 'BSC')}</span>
            <strong>{t('主网络已接入', 'Mainnet Connected')}</strong>
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

      <style>{`
        .home-conway-page {
          width: min(1220px, calc(100vw - 28px));
          margin: 18px auto 54px;
          display: grid;
          gap: 18px;
        }

        .home-conway-hero {
          padding: 20px 20px 18px;
          display: grid;
          gap: 14px;
          background:
            radial-gradient(circle at 100% 0%, rgba(255, 236, 166, 0.28), transparent 30%),
            radial-gradient(circle at 0% 100%, rgba(112, 176, 118, 0.18), transparent 36%),
            linear-gradient(180deg, rgba(253, 255, 248, 0.96), rgba(230, 245, 197, 0.92));
        }

        .home-conway-hero-main {
          display: grid;
          grid-template-columns: minmax(0, 1.28fr) minmax(300px, 0.88fr);
          gap: 14px;
          align-items: stretch;
        }

        .home-conway-hero-copy {
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
          color: #5b4b18;
          line-height: 1.72;
          max-width: 760px;
        }

        .home-conway-hero-cta {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 2px;
        }

        .home-conway-main-btn,
        .home-conway-sub-btn,
        .home-conway-ghost-btn {
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

        .home-conway-ghost-btn {
          background: linear-gradient(180deg, rgba(255,255,255,0.55), rgba(238,248,212,0.84));
          border-color: #799e6b;
          color: #31533a;
        }

        .home-conway-hero-world {
          padding: 14px;
          display: grid;
          gap: 10px;
          border-color: #7ba06c;
          background:
            radial-gradient(circle at 100% 0%, rgba(255,255,255,0.28), transparent 24%),
            linear-gradient(180deg, rgba(248,255,235,0.95), rgba(224,241,193,0.92));
        }

        .home-conway-world-title {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-family: var(--font-pixel);
          font-size: 11px;
          color: #36513e;
        }

        .home-conway-world-dot {
          width: 9px;
          height: 9px;
          border-radius: 999px;
          background: #f0b90b;
          box-shadow: 0 0 0 2px rgba(240, 185, 11, 0.18);
        }

        .home-conway-world-list {
          display: grid;
          gap: 8px;
        }

        .home-conway-world-row {
          display: grid;
          gap: 4px;
          padding: 8px 9px;
          border: 1px solid rgba(118, 156, 103, 0.72);
          border-radius: 10px;
          background: rgba(246, 255, 225, 0.78);
        }

        .home-conway-world-row span {
          font-size: 11px;
          color: #648362;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .home-conway-world-row strong {
          font-size: 12px;
          color: #2f4a37;
          line-height: 1.55;
        }

        .home-conway-world-footer {
          padding: 10px 11px;
          border-radius: 10px;
          background: linear-gradient(180deg, rgba(31, 49, 38, 0.94), rgba(18, 28, 22, 0.94));
          color: #d8efbc;
          font-size: 11px;
          line-height: 1.65;
          border: 1px solid rgba(139, 186, 122, 0.26);
        }

        .home-conway-hero-ribbon {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }

        .home-conway-ribbon-item {
          text-decoration: none;
          color: inherit;
          display: grid;
          gap: 5px;
          padding: 11px 12px;
          border-radius: 12px;
          border: 1px solid rgba(118, 156, 103, 0.72);
          background: linear-gradient(180deg, rgba(250, 255, 239, 0.9), rgba(232, 246, 201, 0.86));
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.6);
          transition: transform 0.12s ease, box-shadow 0.14s ease, border-color 0.14s ease;
        }

        .home-conway-ribbon-item:hover {
          transform: translateY(-1px);
          border-color: #5b8455;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.64), 0 14px 26px rgba(48, 73, 58, 0.16);
        }

        .home-conway-ribbon-item span {
          font-family: var(--font-pixel);
          font-size: 10px;
          color: #334f3a;
          line-height: 1.45;
        }

        .home-conway-ribbon-item strong {
          font-size: 11px;
          line-height: 1.65;
          color: #52704f;
          font-weight: 400;
        }

        .home-conway-world-cards {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }

        .home-conway-world-card {
          padding: 15px 15px 14px;
          text-decoration: none;
          color: inherit;
          display: grid;
          gap: 8px;
          transition: transform 0.12s ease, box-shadow 0.14s ease, border-color 0.14s ease;
        }

        .home-conway-world-card:hover {
          transform: translateY(-2px);
          border-color: #5b8455;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.64), 0 20px 32px rgba(48, 73, 58, 0.18);
        }

        .home-conway-world-kicker {
          font-family: var(--font-pixel);
          font-size: 10px;
          color: #6d915e;
          line-height: 1.4;
        }

        .home-conway-world-card h2 {
          margin: 0;
          font-family: var(--font-pixel);
          font-size: 14px;
          line-height: 1.45;
          color: #304b36;
        }

        .home-conway-world-card p {
          margin: 0;
          font-size: 12px;
          line-height: 1.72;
          color: #577051;
        }

        .home-conway-world-meta {
          margin-top: 2px;
          font-size: 11px;
          color: #35653b;
          padding-top: 8px;
          border-top: 1px dashed rgba(112, 147, 98, 0.8);
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

        @media (max-width: 980px) {
          .home-conway-hero-main,
          .home-conway-world-cards,
          .home-conway-hero-ribbon {
            grid-template-columns: 1fr;
          }

          .home-conway-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 680px) {
          .home-conway-page {
            width: min(100vw - 18px, 1220px);
            margin-top: 12px;
            gap: 14px;
          }

          .home-conway-hero {
            padding: 14px;
          }

          .home-conway-hero h1 {
            font-size: 20px;
            line-height: 1.35;
          }

          .home-conway-hero p,
          .home-conway-world-row strong,
          .home-conway-world-card p,
          .home-conway-kv,
          .home-conway-flow {
            font-size: 11px;
          }

          .home-conway-kv {
            grid-template-columns: 96px 1fr;
          }
        }
      `}</style>
    </div>
  );
}
