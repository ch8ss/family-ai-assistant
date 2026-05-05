import Groq from 'groq-sdk';
import { supabase } from './supabase';
import { Message, Profile } from './types';

const groq = new Groq({
  apiKey: process.env.EXPO_PUBLIC_GROQ_API_KEY!,
  dangerouslyAllowBrowser: true,
});

const MODEL = 'llama-3.3-70b-versatile';
const MAX_HISTORY = 20;
const DAILY_TOKEN_LIMIT = 50000;

export async function getDailyTokensUsed(): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('usage')
    .select('tokens_used')
    .eq('date', today)
    .maybeSingle();
  return data?.tokens_used ?? 0;
}

async function updateDailyTokens(newTokens: number) {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('usage')
    .select('id, tokens_used')
    .eq('date', today)
    .maybeSingle();

  if (data) {
    await supabase
      .from('usage')
      .update({ tokens_used: data.tokens_used + newTokens })
      .eq('id', data.id);
  } else {
    await supabase.from('usage').insert({ date: today, tokens_used: newTokens });
  }
}

export async function sendMessage(
  profile: Profile,
  userMessage: string,
  history: Message[]
): Promise<string> {
  const used = await getDailyTokensUsed();
  if (used >= DAILY_TOKEN_LIMIT) {
    throw new Error("Daily limit reached. Try again tomorrow.");
  }

  const systemPrompt = `You are ${profile.ai_name}, a personal AI assistant for ${profile.name}. You adapt to whatever ${profile.name} needs — health, business, studying, or just chatting. Use the conversation history to give personalized, contextual responses. Be warm, smart, and genuinely helpful.`;

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...history.slice(-MAX_HISTORY).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user' as const, content: userMessage },
  ];

  const response = await groq.chat.completions.create({
    model: MODEL,
    messages,
    max_tokens: 1024,
  });

  const content = response.choices[0].message.content ?? '';
  if (response.usage) {
    await updateDailyTokens(response.usage.total_tokens);
  }
  return content;
}
