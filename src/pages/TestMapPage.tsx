import { VillageMap } from '../components/Map/VillageMap';

export function TestMapPage(props: { account: string | null }) {
  const { account } = props;
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <VillageMap mode="test" account={account} />
    </div>
  );
}
