export type OpenAICompatibleSettings = {
  baseURL: string; // e.g. https://api.openai.com/v1
  apiKey: string;
  model: string;
};

export type AppSettings = {
  llm: OpenAICompatibleSettings;
  ui: {
    scale: number;
    layerMode: '__ALL__' | '__VISIBLE__' | string;
  };
};

export const DEFAULT_SETTINGS: AppSettings = {
  llm: {
    baseURL: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
  },
  ui: {
    scale: 1,
    layerMode: '__ALL__',
  },
};
