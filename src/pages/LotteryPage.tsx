import { useCallback, useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import { CHAIN_CONFIG } from '../config/chain';
import { getReadProvider } from '../core/chain/readProvider';
import { FARM_CONTRACT_ABI } from '../config/farmAbi';
import { useI18n } from '../i18n/I18nContext';

type RoundRow = {
  round: number;
  status: 'DRAWN' | 'OPEN';
  ticketPool: bigint;
  random: bigint;
  winningNumber: string;
  winner: string;
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ROUND_FETCH_CAP = 240;
const MY_TICKET_SCAN_HARD_LIMIT = 5000;

const TOKEN_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function balanceOf(address owner) view returns (uint256)',
] as const;

function shortAddress(value: string): string {
  if (!value || value === ZERO_ADDRESS) return '--';
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function normalizeSafeNumber(value: bigint): number {
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value);
}

function formatTokenAmount(raw: bigint, decimals: number): string {
  const full = ethers.formatUnits(raw, decimals);
  const [intPart, fracPart = ''] = full.split('.');
  const trimmedFrac = fracPart.slice(0, 4).replace(/0+$/, '');
  return trimmedFrac ? `${intPart}.${trimmedFrac}` : intPart;
}

function buildNextDrawAtUTC8(baseMs: number): number {
  const utc8OffsetMs = 8 * 60 * 60 * 1000;
  const nowInUtc8 = new Date(baseMs + utc8OffsetMs);
  const y = nowInUtc8.getUTCFullYear();
  const m = nowInUtc8.getUTCMonth();
  const d = nowInUtc8.getUTCDate();
  const todayTargetUtcMs = Date.UTC(y, m, d, 14, 30, 0, 0);
  const nowUtcMs = nowInUtc8.getTime();
  const targetUtcMs = nowUtcMs <= todayTargetUtcMs ? todayTargetUtcMs : Date.UTC(y, m, d + 1, 14, 30, 0, 0);
  return targetUtcMs - utc8OffsetMs;
}

function formatCountdown(ms: number): string {
  const safe = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function LotteryPage(props: { account: string | null }) {
  const { account } = props;
  const { t } = useI18n();
  const [rows, setRows] = useState<RoundRow[]>([]);
  const [currentRound, setCurrentRound] = useState(1);
  const [closedRoundTotal, setClosedRoundTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchStartRound, setFetchStartRound] = useState(1);
  const [prizePoolRaw, setPrizePoolRaw] = useState<bigint | null>(null);
  const [prizePoolErr, setPrizePoolErr] = useState<string | null>(null);
  const [tokenDecimals, setTokenDecimals] = useState(18);
  const [tokenSymbol, setTokenSymbol] = useState(t('代币', 'Token'));
  const [myCurrentRoundTicketCount, setMyCurrentRoundTicketCount] = useState<number | null>(null);
  const [myCurrentRoundTickets, setMyCurrentRoundTickets] = useState<number[]>([]);
  const [myCurrentRoundTicketErr, setMyCurrentRoundTicketErr] = useState<string | null>(null);
  const [myTicketScanCutoff, setMyTicketScanCutoff] = useState<number | null>(null);
  const [currentRoundTicketPool, setCurrentRoundTicketPool] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [drawTargetMs, setDrawTargetMs] = useState(() => buildNextDrawAtUTC8(Date.now()));

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      setDrawTargetMs((prev) => (now > prev ? buildNextDrawAtUTC8(now) : prev));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const drawCountdownMs = Math.max(0, drawTargetMs - nowMs);
  const drawCountdownText = formatCountdown(drawCountdownMs);
  const drawTargetText = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(drawTargetMs));

  const statusToLabel = (status: RoundRow['status']): string => {
    return status === 'DRAWN' ? t('已开奖', 'Drawn') : t('进行中', 'Open');
  };

  const loadRounds = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setPrizePoolErr(null);
    setMyCurrentRoundTicketErr(null);
    setMyTicketScanCutoff(null);

    try {
      const provider = getReadProvider();
      const farm = new ethers.Contract(CHAIN_CONFIG.farmAddress, FARM_CONTRACT_ABI, provider);

      let tokenAddress = CHAIN_CONFIG.tokenAddress;
      try {
        const onChainToken = (await farm.ERC20_TOKEN()) as string;
        if (/^0x[a-fA-F0-9]{40}$/.test(onChainToken) && onChainToken !== ethers.ZeroAddress) {
          tokenAddress = onChainToken;
        }
      } catch {
        // use configured token address
      }

      try {
        const token = new ethers.Contract(tokenAddress, TOKEN_ABI, provider);
        const [decimalsRaw, symbolRaw] = await Promise.all([token.decimals(), token.symbol()]);
        setTokenDecimals(Number(decimalsRaw ?? 18));
        setTokenSymbol(String(symbolRaw ?? t('代币', 'Token')));
      } catch {
        setTokenDecimals(18);
        setTokenSymbol(t('代币', 'Token'));
      }

      try {
        const poolRaw = BigInt(await farm.getContractTokenBalance(tokenAddress));
        setPrizePoolRaw(poolRaw);
      } catch (poolErr) {
        try {
          const token = new ethers.Contract(tokenAddress, TOKEN_ABI, provider);
          const fallbackPoolRaw = BigInt(await token.balanceOf(CHAIN_CONFIG.farmAddress));
          setPrizePoolRaw(fallbackPoolRaw);
        } catch (fallbackErr) {
          setPrizePoolErr(fallbackErr instanceof Error ? fallbackErr.message : String(poolErr));
          setPrizePoolRaw(null);
        }
      }

      const currentRoundRaw = BigInt(await farm.currentLotteryRound());
      const closedRoundRaw = currentRoundRaw > 0n ? currentRoundRaw - 1n : 0n;
      const closedRoundCount = normalizeSafeNumber(closedRoundRaw);
      const endRound = closedRoundCount;
      const startRound = endRound > ROUND_FETCH_CAP ? endRound - ROUND_FETCH_CAP + 1 : 1;
      const currentRoundNum = normalizeSafeNumber(currentRoundRaw);

      setCurrentRound(currentRoundNum);
      setClosedRoundTotal(closedRoundCount);
      setFetchStartRound(startRound);
      try {
        const currentPoolRaw = BigInt(await farm.getRoundMaxLotteryNumber(currentRoundNum));
        setCurrentRoundTicketPool(normalizeSafeNumber(currentPoolRaw));
      } catch {
        setCurrentRoundTicketPool(null);
      }

      if (!account) {
        setMyCurrentRoundTicketCount(null);
        setMyCurrentRoundTickets([]);
        setMyCurrentRoundTicketErr(null);
      } else {
        try {
          const myCountRaw = BigInt(await farm.getUserLotteryCount(account, currentRoundNum));
          const myCount = normalizeSafeNumber(myCountRaw);
          setMyCurrentRoundTicketCount(myCount);

          if (myCount <= 0) {
            setMyCurrentRoundTickets([]);
          } else {
            const maxNumberRaw = BigInt(await farm.getRoundMaxLotteryNumber(currentRoundNum));
            const maxNumber = normalizeSafeNumber(maxNumberRaw);
            const scanTop = Math.min(maxNumber, MY_TICKET_SCAN_HARD_LIMIT);
            if (maxNumber > scanTop) {
              setMyTicketScanCutoff(scanTop);
            } else {
              setMyTicketScanCutoff(null);
            }

            const found: number[] = [];
            const owner = account.toLowerCase();
            const batchSize = 40;
            for (let high = scanTop; high >= 1 && found.length < myCount; high -= batchSize) {
              const low = Math.max(1, high - batchSize + 1);
              const batchNumbers = Array.from({ length: high - low + 1 }, (_, i) => high - i);
              const batchOwners = await Promise.all(batchNumbers.map((no) => farm.getLotteryOwner(currentRoundNum, no)));
              for (let i = 0; i < batchNumbers.length; i++) {
                if (String(batchOwners[i]).toLowerCase() === owner) {
                  found.push(batchNumbers[i]);
                  if (found.length >= myCount) break;
                }
              }
            }

            found.sort((a, b) => a - b);
            setMyCurrentRoundTickets(found);
          }
        } catch (ticketErr) {
          setMyCurrentRoundTicketErr(ticketErr instanceof Error ? ticketErr.message : String(ticketErr));
          setMyCurrentRoundTickets([]);
          setMyCurrentRoundTicketCount(null);
        }
      }

      const roundNumbers: number[] = [];
      for (let round = endRound; round >= startRound; round--) {
        roundNumbers.push(round);
      }

      const nextRows: RoundRow[] = [];
      const batchSize = 10;

      for (let i = 0; i < roundNumbers.length; i += batchSize) {
        const batch = roundNumbers.slice(i, i + batchSize);
        const chunk = await Promise.all(
          batch.map(async (round): Promise<RoundRow> => {
            const [drawnRaw, ticketPoolRaw, randomRaw] = await Promise.all([
              farm.roundDrawn(round),
              farm.getRoundMaxLotteryNumber(round),
              farm.roundWinnerRandom(round),
            ]);

            const drawn = Boolean(drawnRaw);
            const ticketPool = BigInt(ticketPoolRaw);
            const random = BigInt(randomRaw);

            if (!drawn || ticketPool <= 0n) {
              return {
                round,
                status: drawn ? 'DRAWN' : 'OPEN',
                ticketPool,
                random,
                winningNumber: '--',
                winner: ZERO_ADDRESS,
              };
            }

            const winningNumber = (random % ticketPool) + 1n;
            const winner = (await farm.getLotteryOwner(round, winningNumber)) as string;
            return {
              round,
              status: 'DRAWN',
              ticketPool,
              random,
              winningNumber: winningNumber.toString(),
              winner,
            };
          }),
        );

        nextRows.push(...chunk);
      }

      setRows(nextRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, [account, t]);

  useEffect(() => {
    void loadRounds();
  }, [loadRounds]);

  const winnerCount = useMemo(() => {
    if (!account) return 0;
    const a = account.toLowerCase();
    return rows.filter((row) => row.status === 'DRAWN' && row.winner.toLowerCase() === a).length;
  }, [account, rows]);

  const latestWinner = useMemo(() => rows.find((row) => row.status === 'DRAWN' && row.winner !== ZERO_ADDRESS) ?? null, [rows]);

  return (
    <div className="lottery-page-shell">
      <div className="lottery-page-inner">
        <section
          className="ga-card-surface lottery-hero-card"
        >
          <div>
            <h1
              style={{
                margin: 0,
                color: '#355537',
                fontFamily: "'Press Start 2P', cursive",
                fontSize: 'clamp(14px, 2vw, 22px)',
                lineHeight: 1.35,
              }}
            >
              {t('开奖中心 // 期数记录', 'Lottery Center // Round Records')}
            </h1>
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
              {t('查看每一期开奖状态、中奖号码和中奖地址', 'View every round status, winning number, and winner address')}
            </div>
          </div>

          <button
            className="ga-btn lottery-refresh-btn"
            onClick={() => void loadRounds()}
            disabled={isLoading}
          >
            {isLoading ? t('加载中...', 'Loading...') : t('刷新数据', 'Refresh')}
          </button>
        </section>

        <section className="lottery-section">
          <div className="lottery-section-head">
            <div className="lottery-section-title">{t('核心指标', 'Core Metrics')}</div>
            <div className="lottery-section-sub">{t('奖池、轮次和开奖节奏一览', 'Prize pool, round state, and draw cadence')}</div>
          </div>
          <div className="lottery-kpi-grid">
          <article className="ga-card-surface lottery-pool-card" style={{ padding: 12 }}>
            <div style={{ fontSize: 10, opacity: 0.75, fontFamily: "'Press Start 2P', cursive" }}>{t('奖池（合约余额）', 'Prize Pool (Contract Balance)')}</div>
            <div style={{ marginTop: 8, fontSize: 24, fontWeight: 800 }}>
              {prizePoolRaw !== null ? `${formatTokenAmount(prizePoolRaw, tokenDecimals)} ${tokenSymbol}` : '--'}
            </div>
            {prizePoolErr ? (
              <div style={{ marginTop: 6, fontSize: 11, color: '#b91c1c', wordBreak: 'break-all' }}>
                {t('奖池读取失败', 'Prize pool read failed')}: {prizePoolErr}
              </div>
            ) : null}
          </article>
          <article className="ga-card-surface" style={{ padding: 10 }}>
            <div style={{ fontSize: 10, opacity: 0.75, fontFamily: "'Press Start 2P', cursive" }}>{t('当前轮次', 'Current Round')}</div>
            <div style={{ marginTop: 8, fontSize: 20, fontWeight: 700 }}>#{currentRound}</div>
          </article>
          <article className="ga-card-surface" style={{ padding: 10 }}>
            <div style={{ fontSize: 10, opacity: 0.75, fontFamily: "'Press Start 2P', cursive" }}>{t('本期彩票总数', 'Current Round Total Tickets')}</div>
            <div style={{ marginTop: 8, fontSize: 20, fontWeight: 700 }}>
              {currentRoundTicketPool !== null ? currentRoundTicketPool : '--'}
            </div>
          </article>
          <article className="ga-card-surface lottery-countdown-card" style={{ padding: 10 }}>
            <div style={{ fontSize: 10, opacity: 0.75, fontFamily: "'Press Start 2P', cursive" }}>{t('开奖倒计时', 'Draw Countdown')}</div>
            <div style={{ marginTop: 8, fontSize: 20, fontWeight: 700 }}>
              {drawCountdownMs > 0 ? drawCountdownText : t('已到开奖时间', 'Draw time reached')}
            </div>
            <div style={{ marginTop: 4, fontSize: 11, opacity: 0.82 }}>
              {t('开奖时间（北京时间）', 'Draw at (UTC+8)')}: {drawTargetText}
            </div>
          </article>
          <article className="ga-card-surface" style={{ padding: 10 }}>
            <div style={{ fontSize: 10, opacity: 0.75, fontFamily: "'Press Start 2P', cursive" }}>{t('已开奖期数', 'Closed Rounds')}</div>
            <div style={{ marginTop: 8, fontSize: 20, fontWeight: 700 }}>{closedRoundTotal}</div>
          </article>
          <article className="ga-card-surface" style={{ padding: 10 }}>
            <div style={{ fontSize: 10, opacity: 0.75, fontFamily: "'Press Start 2P', cursive" }}>{t('我的中奖次数', 'My Wins')}</div>
            <div style={{ marginTop: 8, fontSize: 20, fontWeight: 700 }}>{account ? winnerCount : '--'}</div>
          </article>
          <article className="ga-card-surface" style={{ padding: 10 }}>
            <div style={{ fontSize: 10, opacity: 0.75, fontFamily: "'Press Start 2P', cursive" }}>{t('最新中奖地址', 'Latest Winner')}</div>
            <div style={{ marginTop: 8, fontSize: 14, fontWeight: 700, wordBreak: 'break-all' }}>
              {latestWinner ? shortAddress(latestWinner.winner) : '--'}
            </div>
          </article>
          </div>
        </section>

        <section className="ga-card-surface lottery-section-card" style={{ padding: 12 }}>
          <div className="lottery-section-head" style={{ marginBottom: 8 }}>
            <div className="lottery-section-title">{t('我的参与', 'My Participation')}</div>
            <div className="lottery-section-sub">{t('查看本期持有的彩票编号', 'Inspect your current round ticket numbers')}</div>
          </div>
          <div style={{ fontSize: 11, opacity: 0.78, fontFamily: "'Press Start 2P', cursive", marginBottom: 8 }}>
            {t('我的本期彩票编号', 'My Ticket Numbers (Current Round)')}
          </div>
          {!account ? (
            <div style={{ fontSize: 12, opacity: 0.82 }}>{t('请先连接钱包后查看你的本期彩票。', 'Connect your wallet to view your current-round tickets.')}</div>
          ) : (
            <>
              <div style={{ fontSize: 12, marginBottom: 8, opacity: 0.88 }}>
                {t('当前期数：#', 'Round #')}{currentRound}
                {t('，你持有 ', ', you hold ')}
                <strong>{myCurrentRoundTicketCount ?? '--'}</strong>
                {t(' 张彩票', ' tickets')}
              </div>
              {myCurrentRoundTicketErr ? (
                <div style={{ color: '#b91c1c', fontSize: 12, marginBottom: 8 }}>
                  {t('读取你的彩票编号失败：', 'Failed to read your ticket numbers: ')}{myCurrentRoundTicketErr}
                </div>
              ) : null}
              {account && myCurrentRoundTickets.length === 0 && !myCurrentRoundTicketErr ? (
                <div style={{ fontSize: 12, opacity: 0.78 }}>{t('当前暂无可展示的彩票编号。', 'No ticket numbers to display in this round yet.')}</div>
              ) : null}
              {myCurrentRoundTickets.length > 0 ? (
                <div className="lottery-ticket-list">
                  {myCurrentRoundTickets.map((ticketNo) => (
                    <span key={`my-ticket-${ticketNo}`} className="lottery-ticket-chip">
                      #{ticketNo}
                    </span>
                  ))}
                </div>
              ) : null}
              {myTicketScanCutoff !== null ? (
                <div style={{ marginTop: 8, fontSize: 11, opacity: 0.76 }}>
                  {t('当前期彩票池较大，已扫描到编号 #', 'Ticket pool is large; scanned up to #')}{myTicketScanCutoff}{t(' 为止。', '.')}
                </div>
              ) : null}
            </>
          )}
        </section>

        <section className="ga-card-surface lottery-section-card" style={{ padding: 12 }}>
          <div className="lottery-section-head" style={{ marginBottom: 8 }}>
            <div className="lottery-section-title">{t('开奖记录', 'Round History')}</div>
            <div className="lottery-section-sub">{t('按期次追踪中奖结果', 'Track winner data by rounds')}</div>
          </div>
          <div style={{ fontSize: 12, marginBottom: 8, opacity: 0.86 }}>
            {t('合约', 'Contract')}: {CHAIN_CONFIG.farmAddress}
          </div>
          <div style={{ fontSize: 12, marginBottom: 10, opacity: 0.82 }}>
            {t('当前展示区间: 第 #', 'Display range: Round #')}{fetchStartRound}
            {t(' 期 ~ 第 #', ' to #')}{Math.max(1, currentRound - 1)}
            {t(' 期', '')}
            {closedRoundTotal > ROUND_FETCH_CAP ? t(`（仅显示最近 ${ROUND_FETCH_CAP} 期）`, `(showing latest ${ROUND_FETCH_CAP} rounds)`) : ''}
          </div>
          {error ? (
            <div style={{ color: '#b91c1c', fontSize: 12, marginBottom: 8 }}>{t('读取失败', 'Read failed')}: {error}</div>
          ) : null}

          <div style={{ display: 'grid', gap: 8 }}>
            <div className="lottery-table-wrap">
              <div className="lottery-table-row lottery-table-head">
                <span>{t('期数', 'Round')}</span>
                <span>{t('状态', 'Status')}</span>
                <span>{t('中奖号', 'Winning #')}</span>
                <span>{t('中奖地址', 'Winner')}</span>
                <span>{t('随机数 / 票池', 'Random / Pool')}</span>
              </div>
            </div>

            {rows.length === 0 && !isLoading ? (
              <div style={{ fontSize: 12, opacity: 0.8, padding: '4px 2px' }}>{t('暂无开奖记录', 'No round history yet')}</div>
            ) : null}

            {rows.map((row) => {
              const isMyWin = account ? row.winner.toLowerCase() === account.toLowerCase() && row.status === 'DRAWN' : false;
              return (
                <div key={`round-${row.round}`} className="lottery-table-wrap">
                  <div className={`lottery-table-row ${isMyWin ? 'is-my-win' : ''}`}>
                    <span>#{row.round}</span>
                    <span>{statusToLabel(row.status)}</span>
                    <span>{row.winningNumber}</span>
                    <span style={{ wordBreak: 'break-all' }}>{shortAddress(row.winner)}</span>
                    <span style={{ wordBreak: 'break-all' }}>
                      {row.random.toString()} / {row.ticketPool.toString()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <style>{`
          .lottery-page-shell {
            width: 100%;
            min-height: 100%;
            box-sizing: border-box;
            padding: 18px 14px 30px;
            color: #2f4a31;
            font-family: 'Space Mono', monospace;
          }

          .lottery-page-inner {
            max-width: 1220px;
            margin: 0 auto;
            display: flex;
            flex-direction: column;
            gap: 12px;
          }

          .lottery-hero-card {
            padding: 12px 14px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 10px;
          }

          .lottery-refresh-btn {
            min-height: 36px;
            padding: 8px 12px;
            cursor: pointer;
          }

          .lottery-refresh-btn:disabled {
            cursor: not-allowed;
          }

          .lottery-section {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }

          .lottery-section-head {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            gap: 8px;
            flex-wrap: wrap;
            padding: 0 2px;
          }

          .lottery-section-title {
            font-family: 'Press Start 2P', cursive;
            font-size: 11px;
            color: #3b5b3d;
            letter-spacing: 0.03em;
          }

          .lottery-section-sub {
            font-size: 11px;
            color: #547158;
            opacity: 0.9;
          }

          .lottery-section-card {
            background:
              radial-gradient(circle at 100% 0%, rgba(255,255,255,0.32), transparent 28%),
              linear-gradient(180deg, rgba(251,255,242,0.92), rgba(233,248,200,0.9)) !important;
          }

          .lottery-kpi-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 10px;
          }

          .lottery-pool-card {
            grid-column: span 2;
            border: 2px solid #d2a23f !important;
            background: linear-gradient(180deg, rgba(255, 246, 198, 0.95), rgba(255, 234, 156, 0.86)) !important;
            box-shadow: 0 0 0 2px rgba(210, 162, 63, 0.18) inset;
          }

          .lottery-countdown-card {
            border: 2px solid #7aa36a !important;
            background: linear-gradient(180deg, rgba(239, 255, 216, 0.92), rgba(224, 247, 188, 0.86)) !important;
            box-shadow: 0 0 0 2px rgba(122, 163, 106, 0.14) inset;
          }

          .lottery-table-wrap {
            width: 100%;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
          }

          .lottery-ticket-list {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            max-height: 150px;
            overflow-y: auto;
            padding-right: 2px;
          }

          .lottery-ticket-chip {
            border: 1px solid #9dbf82;
            background: linear-gradient(180deg, #f6ffe2, #e8f7cb);
            color: #355537;
            padding: 4px 8px;
            font-size: 11px;
            line-height: 1;
          }

          .lottery-table-row {
            min-width: 820px;
            display: grid;
            grid-template-columns: 80px 90px 120px 1fr 1fr;
            gap: 8px;
            border: 1px solid #9fbc8f;
            background: linear-gradient(180deg, rgba(249, 255, 236, 0.9), rgba(238, 248, 213, 0.86));
            padding: 8px 10px;
            font-size: 12px;
            align-items: center;
          }

          .lottery-table-head {
            border-color: #8fb37a;
            background: linear-gradient(180deg, #f2ffd7, #e7f5c5);
            font-size: 11px;
            font-family: 'Press Start 2P', cursive;
            color: #3b5b3d;
          }

          .lottery-table-row.is-my-win {
            border-color: #d0a03b;
            background: linear-gradient(180deg, rgba(255, 242, 190, 0.88), rgba(247, 228, 160, 0.78));
          }

          @media (max-width: 940px) {
            .lottery-page-shell {
              padding: 14px 10px 26px;
            }

            .lottery-kpi-grid {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .lottery-pool-card {
              grid-column: span 2;
            }
          }

          @media (max-width: 560px) {
            .lottery-section-title {
              font-size: 10px;
            }

            .lottery-section-sub {
              font-size: 10px;
            }

            .lottery-kpi-grid {
              grid-template-columns: 1fr;
            }

            .lottery-pool-card {
              grid-column: span 1;
            }
          }
        `}</style>
      </div>
    </div>
  );
}
