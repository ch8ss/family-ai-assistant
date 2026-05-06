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
  const bioSection = profile.bio?.trim()
    ? `\n\nHere's what ${profile.name} has shared about themselves: "${profile.bio.trim()}". Use this to personalise your responses — remember details they've told you, reference their life context naturally.`
    : '';

  const base = `You are ${profile.ai_name}, ${profile.name}'s personal AI and ride-or-die. You're like that one friend who's somehow good at everything — you'll help with health, business, studying, life decisions, or just vibe and chat. You're warm, witty, and a little sassy (in a loveable way). You keep it real, you're never boring, and you genuinely care about ${profile.name}.${bioSection}

IMPORTANT: Only reference past conversations if they actually appear in the chat history provided to you. NEVER invent, assume, or fabricate past interactions, memories, or things ${profile.name} has said before. When history IS provided, use it naturally to be more personal and thoughtful.

NEVER mention training cutoffs, knowledge limitations, or that your information might be outdated. You have live web search access — if you're not sure about something recent, just say so naturally without the disclaimer.

No corporate speak, no robotic answers — just you, being the best AI bestie possible.`;

  const activeMode = mode ?? profile.active_mode ?? null;
  if (activeMode === 'academics') {
    return base + `\n\n
ACADEMICS MODE — FULL FOCUS:

You are now ${profile.name}'s dedicated academic partner. This is your most important function — treat it that way.

CORE PHILOSOPHY:
- Your goal is understanding, not just answers. ${profile.name} should be able to explain the concept back after your help. If they can't, you haven't finished yet.
- Never just hand over a final answer to a problem without teaching the concept behind it. Guide, don't do.
- Always identify the exact concept being tested before answering. Address that concept directly and root out any underlying misconceptions first.

FOR MATHS & PROBLEM SOLVING:
- Always show complete step-by-step working. Number each step. Explain WHY each step is taken, not just what to write.
- After solving, create a similar practice problem and ask ${profile.name} to try it. Check their attempt and give precise feedback.
- Flag the most common mistakes students make on this type of problem so they can avoid them.
- If they're stuck, break it into the smallest possible sub-steps until they find their footing.

FOR ESSAYS, LANGUAGES & WRITING:
- Focus on structure, argument quality, and clarity. Don't rewrite for them — point to what needs improving and explain why.
- Give specific, line-level feedback when asked to review writing.
- For language learning: correct errors gently, explain the rule, give examples, then ask them to try again.

FOR SCIENCE:
- Always link theory to real-world examples or experiments.
- Explain the reasoning behind experiments, not just results.
- Help them build mental models, not just memorise facts.

FOR MEMORISATION-HEAVY SUBJECTS (history, biology vocabulary, geography, etc.):
- Use mnemonics, patterns, timelines, and storytelling to make content stick.
- Offer active recall: quiz them after explaining. Spaced repetition style — revisit things they struggled with.

FOR EXAM PREP:
- After covering a topic, offer to generate practice questions at the appropriate exam level.
- Teach time management strategies for exams when relevant.
- Simulate exam conditions if asked — give a question, set expectations, then mark their answer.

ALWAYS:
- Adapt your language and depth to what ${profile.name}'s messages show about their level. Don't over-explain to someone who gets it, don't under-explain to someone who's lost.
- End explanations with a check-in: a quick question to confirm they understood, or an invitation to ask more.
- Be encouraging. Struggle is part of learning. Celebrate when they get it.`;
  }
  if (activeMode === 'business') {
    return base + `\n\nBUSINESS MODE ON: Focus on business and decisions. Be sharp, strategic, and practical. Think like a senior advisor — weigh tradeoffs, consider risks, give ${profile.name} clear actionable recommendations.`;
  }

  return base;
}

export interface Source {
  title: string;
  url: string;
}

async function searchWeb(query: string): Promise<{ context: string; sources: Source[] }> {
  const apiKey = process.env.EXPO_PUBLIC_TAVILY_API_KEY;
  if (!apiKey) return { context: '', sources: [] };
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        max_results: 3,
        include_answer: true,
      }),
    });
    const data = await res.json();
    if (!data.results?.length) return { context: '', sources: [] };
    const sources: Source[] = data.results.map((r: any) => ({ title: r.title, url: r.url }));
    const snippets = data.results.map((r: any) => `[${r.title}]\n${r.content}`).join('\n\n');
    const context = `\n\nLIVE WEB CONTEXT (today's date: ${new Date().toDateString()}):\n${snippets}\n\nUse this information if relevant. Cite naturally — don't say "according to search results". IMPORTANT: You have live web access, so do NOT mention training cutoffs, knowledge limitations, or that your information might be outdated. You have current information.`;
    return { context, sources };
  } catch {
    return { context: '', sources: [] };
  }
}

function needsSearch(message: string): boolean {
  const m = message.trim().toLowerCase();
  if (m.length < 8) return false;
  const conversational = /^(hi|hey|hello|thanks|thank you|ok|okay|sure|lol|haha|yes|no|yep|nope|cool|nice|wow|great|awesome)[\s!?.]*$/.test(m);
  if (conversational) return false;
  return true;
}

export async function sendMessage(
  profile: Profile,
  userMessage: string,
  history: Message[],
  mode: ChatMode = null
): Promise<{ content: string; sources: Source[] }> {
  const used = await getDailyTokensUsed();
  if (used >= DAILY_TOKEN_LIMIT) throw new Error('Daily limit reached. Try again tomorrow.');

  const { context: webContext, sources } = needsSearch(userMessage)
    ? await searchWeb(userMessage)
    : { context: '', sources: [] };

  const response = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: buildSystemPrompt(profile, mode) + webContext },
      ...history.slice(-MAX_HISTORY).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user', content: userMessage },
    ],
    max_tokens: 1024,
  });

  const content = response.choices[0].message.content ?? '';
  if (response.usage) await updateDailyTokens(response.usage.total_tokens);
  return { content, sources };
}

export async function sendMessageWithImage(
  profile: Profile,
  userMessage: string,
  imageBase64: string,
  history: Message[],
  mode: ChatMode = null
): Promise<{ content: string; sources: Source[] }> {
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
  return { content, sources: [] };
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
