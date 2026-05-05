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

export type ChatMode = 'academics' | 'business' | null;

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
    await supabase.from('usage').update({ tokens_used: data.tokens_used + newTokens }).eq('id', data.id);
  } else {
    await supabase.from('usage').insert({ date: today, tokens_used: newTokens });
  }
}

function buildSystemPrompt(profile: Profile, mode: ChatMode): string {
  const base = `You are ${profile.ai_name}, ${profile.name}'s personal AI and ride-or-die. You're like that one friend who's somehow good at everything — you'll help with health, business, studying, life decisions, or just vibe and chat. You're warm, witty, and a little sassy (in a loveable way). You keep it real, you're never boring, and you genuinely care about ${profile.name}.

IMPORTANT: Only reference past conversations if they actually appear in the chat history provided to you. NEVER invent, assume, or fabricate past interactions, memories, or things ${profile.name} has said before. If there's no chat history, this is literally your first conversation — act like it. When history IS provided, use it naturally to be more personal and thoughtful.

No corporate speak, no robotic answers — just you, being the best AI bestie possible.`;

  if (mode === 'academics') {
    return base + `\n\nACADEMICS MODE ON: Right now, focus entirely on academics and math. Be precise and methodical. Show full working for math problems step by step. Be the best study partner ${profile.name} could ask for — rigorous, clear, and encouraging.`;
  }
  if (mode === 'business') {
    return base + `\n\nBUSINESS MODE ON: Right now, focus on business and decisions. Be sharp, strategic, and practical. Think like a senior advisor — weigh tradeoffs, consider risks, give ${profile.name} clear recommendations they can act on.`;
  }
  return base;
}

export async function sendMessage(
  profile: Profile,
  userMessage: string,
  history: Message[],
  mode: ChatMode = null
): Promise<string> {
  const used = await getDailyTokensUsed();
  if (used >= DAILY_TOKEN_LIMIT) throw new Error('Daily limit reached. Try again tomorrow.');

  const response = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: buildSystemPrompt(profile, mode) },
      ...history.slice(-MAX_HISTORY).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
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
  history: Message[],
  mode: ChatMode = null
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
      { role: 'system', content: buildSystemPrompt(profile, mode) },
      ...history.slice(-MAX_HISTORY).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
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

  if (audioUri.startsWith('blob:') || audioUri.startsWith('http')) {
    // Web: fetch the blob, then append it
    const res = await fetch(audioUri);
    const blob = await res.blob();
    formData.append('file', blob, 'recording.webm');
  } else {
    // Native: use file URI directly
    formData.append('file', { uri: audioUri, type: 'audio/m4a', name: 'recording.m4a' } as any);
  }

  formData.append('model', 'whisper-large-v3');
  formData.append('language', 'en');

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.EXPO_PUBLIC_GROQ_API_KEY}` },
    body: formData,
  });

  const data = await response.json();
  if (!data.text) throw new Error(data.error?.message ?? 'Transcription failed');
  return data.text;
}
