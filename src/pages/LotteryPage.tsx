import { useCallback, useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import { CHAIN_CONFIG } from '../config/chain';
import { getReadProvider } from '../core/chain/readProvider';

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

const LOTTERY_ABI = [
  'function currentLotteryRound() view returns (uint256)',
  'function roundDrawn(uint256) view returns (bool)',
  'function roundWinnerRandom(uint256) view returns (uint256)',
  'function getRoundMaxLotteryNumber(uint256) view returns (uint256)',
  'function getLotteryOwner(uint256,uint256) view returns (address)',
] as const;

function shortAddress(value: string): string {
  if (!value || value === ZERO_ADDRESS) return '--';
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function normalizeSafeNumber(value: bigint): number {
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value);
}

export function LotteryPage(props: { account: string | null }) {
  const { account } = props;
  const [rows, setRows] = useState<RoundRow[]>([]);
  const [currentRound, setCurrentRound] = useState(1);
  const [closedRoundTotal, setClosedRoundTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchStartRound, setFetchStartRound] = useState(1);

  const loadRounds = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const provider = getReadProvider();
      const farm = new ethers.Contract(CHAIN_CONFIG.farmAddress, LOTTERY_ABI, provider);

      const currentRoundRaw = BigInt(await farm.currentLotteryRound());
      const closedRoundRaw = currentRoundRaw > 0n ? currentRoundRaw - 1n : 0n;
      const closedRoundCount = normalizeSafeNumber(closedRoundRaw);
      const endRound = closedRoundCount;
      const startRound = endRound > ROUND_FETCH_CAP ? endRound - ROUND_FETCH_CAP + 1 : 1;

      setCurrentRound(normalizeSafeNumber(currentRoundRaw));
      setClosedRoundTotal(closedRoundCount);
      setFetchStartRound(startRound);

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
  }, []);

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
    <div
      style={{
        width: '100%',
        minHeight: '100%',
        boxSizing: 'border-box',
        padding: '18px 14px 28px',
        color: '#2f4a31',
        fontFamily: "'Space Mono', monospace",
      }}
    >
      <div style={{ maxWidth: 1220, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <section
          className="ga-card-surface"
          style={{
            padding: '12px 14px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
          }}
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
              LOTTERY // ROUND HISTORY
            </h1>
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
              查看每一期开奖状态、中奖号码和中奖地址
            </div>
          </div>

          <button
            className="ga-btn"
            onClick={() => void loadRounds()}
            disabled={isLoading}
            style={{ minHeight: 36, padding: '8px 12px', cursor: isLoading ? 'not-allowed' : 'pointer' }}
          >
            {isLoading ? 'LOADING...' : 'REFRESH'}
          </button>
        </section>

        <section className="lottery-kpi-grid">
          <article className="ga-card-surface" style={{ padding: 10 }}>
            <div style={{ fontSize: 10, opacity: 0.75, fontFamily: "'Press Start 2P', cursive" }}>CURRENT ROUND</div>
            <div style={{ marginTop: 8, fontSize: 20, fontWeight: 700 }}>#{currentRound}</div>
          </article>
          <article className="ga-card-surface" style={{ padding: 10 }}>
            <div style={{ fontSize: 10, opacity: 0.75, fontFamily: "'Press Start 2P', cursive" }}>CLOSED ROUNDS</div>
            <div style={{ marginTop: 8, fontSize: 20, fontWeight: 700 }}>{closedRoundTotal}</div>
          </article>
          <article className="ga-card-surface" style={{ padding: 10 }}>
            <div style={{ fontSize: 10, opacity: 0.75, fontFamily: "'Press Start 2P', cursive" }}>YOUR WINS</div>
            <div style={{ marginTop: 8, fontSize: 20, fontWeight: 700 }}>{account ? winnerCount : '--'}</div>
          </article>
          <article className="ga-card-surface" style={{ padding: 10 }}>
            <div style={{ fontSize: 10, opacity: 0.75, fontFamily: "'Press Start 2P', cursive" }}>LATEST WINNER</div>
            <div style={{ marginTop: 8, fontSize: 14, fontWeight: 700, wordBreak: 'break-all' }}>
              {latestWinner ? shortAddress(latestWinner.winner) : '--'}
            </div>
          </article>
        </section>

        <section className="ga-card-surface" style={{ padding: 12 }}>
          <div style={{ fontSize: 12, marginBottom: 8, opacity: 0.86 }}>
            合约: {CHAIN_CONFIG.farmAddress}
          </div>
          <div style={{ fontSize: 12, marginBottom: 10, opacity: 0.82 }}>
            当前展示区间: Round #{fetchStartRound} ~ #{Math.max(1, currentRound - 1)}
            {closedRoundTotal > ROUND_FETCH_CAP ? `（仅显示最近 ${ROUND_FETCH_CAP} 期）` : ''}
          </div>
          {error ? (
            <div style={{ color: '#b91c1c', fontSize: 12, marginBottom: 8 }}>读取失败: {error}</div>
          ) : null}

          <div style={{ display: 'grid', gap: 8 }}>
            <div className="lottery-table-wrap">
              <div className="lottery-table-row lottery-table-head">
                <span>ROUND</span>
                <span>STATUS</span>
                <span>WIN NO.</span>
                <span>WINNER</span>
                <span>RANDOM / POOL</span>
              </div>
            </div>

            {rows.length === 0 && !isLoading ? (
              <div style={{ fontSize: 12, opacity: 0.8, padding: '4px 2px' }}>暂无开奖记录</div>
            ) : null}

            {rows.map((row) => {
              const isMyWin = account ? row.winner.toLowerCase() === account.toLowerCase() && row.status === 'DRAWN' : false;
              return (
                <div key={`round-${row.round}`} className="lottery-table-wrap">
                  <div className={`lottery-table-row ${isMyWin ? 'is-my-win' : ''}`}>
                    <span>#{row.round}</span>
                    <span>{row.status}</span>
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
          .lottery-kpi-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 10px;
          }

          .lottery-table-wrap {
            width: 100%;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
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
            .lottery-kpi-grid {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }
          }

          @media (max-width: 560px) {
            .lottery-kpi-grid {
              grid-template-columns: 1fr;
            }
          }
        `}</style>
      </div>
    </div>
  );
}
