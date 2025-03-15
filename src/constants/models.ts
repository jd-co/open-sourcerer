export interface AIModel {
  id: string;
  name: string;
  provider: string;
  isCustom?: boolean;
}

export const DEFAULT_MODELS: AIModel[] = [
  {
    id: "openai/gpt-4",
    name: "GPT-4",
    provider: "OpenAI"
  },
  {
    id: "openai/gpt-3.5-turbo",
    name: "GPT-3.5 Turbo",
    provider: "OpenAI"
  },
  {
    id: "anthropic/claude-3-opus",
    name: "Claude 3 Opus",
    provider: "Anthropic"
  },
  {
    id: "anthropic/claude-3-sonnet",
    name: "Claude 3 Sonnet",
    provider: "Anthropic"
  },
  {
    id: "google/gemini-pro",
    name: "Gemini Pro",
    provider: "Google"
  },
  {
    id: "meta/llama-3.1-70b",
    name: "Llama 3.1 70B",
    provider: "Meta"
  }
]; 