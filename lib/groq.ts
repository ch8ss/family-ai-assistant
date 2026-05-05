import Groq from 'groq-sdk';
import { supabase } from './supabase';
import { Message, Profile } from './types';

const groq = new Groq({
  apiKey: process.env.EXPO_PUBLIC_GROQ_API_KEY!,
  dangerouslyAllowBrowser: true,
});

const MODEL = 'llama-3.3-70b-versatile';
const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
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

function buildSystemPrompt(profile: Profile) {
  return `You are ${profile.ai_name}, ${profile.name}'s personal AI and ride-or-die. You're like that one friend who's somehow good at everything — you'll help with health, business, studying, life decisions, or just vibe and chat. You're warm, witty, and a little sassy (in a loveable way). You keep it real, you're never boring, and you genuinely care about ${profile.name}.

IMPORTANT: Only reference past conversations if they actually appear in the chat history provided to you. NEVER invent, assume, or fabricate past interactions, memories, or things ${profile.name} has said before. If there's no chat history, this is literally your first conversation — act like it. When history IS provided, use it naturally to be more personal and thoughtful.

No corporate speak, no robotic answers — just you, being the best AI bestie possible.`;
}

export async function sendMessage(
  profile: Profile,
  userMessage: string,
  history: Message[]
): Promise<string> {
  const used = await getDailyTokensUsed();
  if (used >= DAILY_TOKEN_LIMIT) throw new Error('Daily limit reached. Try again tomorrow.');

  const response = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: buildSystemPrompt(profile) },
      ...history.slice(-MAX_HISTORY).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user', content: userMessage },
    ],
    max_tokens: 1024,
  });

  const content = response.choices[0].message.content ?? '';
  if (response.usage) await updateDailyTokens(response.usage.total_tokens);
  return content;
}

export async function sendMessageWithImage(
  profile: Profile,
  userMessage: string,
  imageBase64: string,
  history: Message[]
): Promise<string> {
  const used = await getDailyTokensUsed();
  if (used >= DAILY_TOKEN_LIMIT) throw new Error('Daily limit reached. Try again tomorrow.');

  const userContent: any[] = [
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
  ];
  if (userMessage.trim()) userContent.unshift({ type: 'text', text: userMessage });

  const response = await groq.chat.completions.create({
    model: VISION_MODEL,
    messages: [
      { role: 'system', content: buildSystemPrompt(profile) },
      ...history.slice(-MAX_HISTORY).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user', content: userContent },
    ],
    max_tokens: 1024,
  });

  const content = response.choices[0].message.content ?? '';
  if (response.usage) await updateDailyTokens(response.usage.total_tokens);
  return content;
}

export async function transcribeAudio(audioUri: string): Promise<string> {
  const formData = new FormData();
  formData.append('file', { uri: audioUri, type: 'audio/m4a', name: 'recording.m4a' } as any);
  formData.append('model', 'whisper-large-v3');
  formData.append('language', 'en');

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.EXPO_PUBLIC_GROQ_API_KEY}` },
    body: formData,
  });

  const data = await response.json();
  return data.text ?? '';
}
