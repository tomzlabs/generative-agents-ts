export type PersistedAgent = {
  id: string;
  name: string;
  tx: number;
  ty: number;
  status: string;
};

export type WorldEvent = {
  t: number; // tick
  ts: number; // unix ms
  message: string;
};

export type PersistedWorldState = {
  version: 1;
  tick: number;
  agents: PersistedAgent[];
  events: WorldEvent[];
};

export const DEFAULT_WORLD_STATE: PersistedWorldState = {
  version: 1,
  tick: 0,
  agents: [
    { id: 'tom', name: 'Tom', tx: 8, ty: 8, status: 'idle' },
    { id: 'mei', name: 'Mei', tx: 10, ty: 8, status: 'idle' },
    { id: 'sam', name: 'Sam', tx: 12, ty: 8, status: 'idle' },
  ],
  events: [],
};
