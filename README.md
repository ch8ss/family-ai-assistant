# Family AI

A personalized AI companion app for three — built for real daily use, not a demo.

Each family member gets their own AI that remembers them, adapts to what they need, and gets better the more you use it. No shared chat, no generic responses — yours is yours.

---

## What it does

- **Netflix-style profile picker** — three profiles, each unlocked with a PIN
- **Adaptive AI personality** — warm, witty, and a little sassy. Feels like texting a smart friend
- **Persistent memory** — the AI reads your full conversation history across all chats, not just the current one
- **Conversation sidebar** — full chat history per profile, delete by hovering (web) or long pressing (mobile)
- **Image understanding** — attach a photo and the AI can see and respond to it
- **Voice input** — tap the mic, speak, and your words appear as text
- **Read aloud** — tap the speaker on any AI message to hear it spoken
- **Custom AI voice** — pick from all available browser voices per profile
- **Academics mode** — a deeply effective study partner: step-by-step math, essay feedback, exam prep, active recall, and more
- **Business mode** — sharp, strategic advice for decisions and planning
- **About you** — write a bio so your AI knows your life context from day one
- **Settings** — change PIN, edit AI name, toggle memory and modes, pick voice

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React Native + Expo (web via Metro) |
| AI — chat | Groq API — Llama 3.3 70B Versatile |
| AI — vision | Groq API — Llama 4 Scout (image messages) |
| AI — voice | Groq API — Whisper Large V3 (transcription) |
| Database | Supabase (Postgres) |
| Auth | PIN-based per profile (no email required) |
| Cost | $0 |

---

## Getting started

### 1. Clone and install

```bash
git clone https://github.com/ch8ss/family-ai-assistant.git
cd family-ai-assistant
npm install
npx expo install react-native-web react-dom @expo/metro-runtime
```

### 2. Environment variables

Create a `.env` file in the root:

```env
EXPO_PUBLIC_SUPABASE_URL=your_supabase_project_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
EXPO_PUBLIC_GROQ_API_KEY=your_groq_api_key
```

- Supabase keys: [supabase.com](https://supabase.com) → Project Settings → API
- Groq key: [console.groq.com](https://console.groq.com) → API Keys

### 3. Database setup

Run this in your Supabase SQL editor:

```sql
create table profiles (
  id uuid primary key default gen_random_uuid(),
  slot integer unique not null check (slot in (1, 2, 3)),
  name text not null,
  ai_name text not null,
  pin text not null,
  bio text,
  persistent_memory boolean default true,
  active_mode text,
  voice_preference text,
  created_at timestamptz default now()
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete cascade,
  title text,
  created_at timestamptz default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz default now()
);

create table usage (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  tokens_used integer not null default 0
);

alter table profiles enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table usage enable row level security;

create policy "open" on profiles for all using (true) with check (true);
create policy "open" on conversations for all using (true) with check (true);
create policy "open" on messages for all using (true) with check (true);
create policy "open" on usage for all using (true) with check (true);
```

### 4. Run

```bash
npx expo start
```

Press `w` to open in browser. Scan the QR code with the Expo Go app to run on your phone.

---

## Project structure

```
app/
  _layout.tsx     navigation stack
  index.tsx       profile picker
  pin.tsx         PIN entry + new profile creation
  chat.tsx        main chat screen with sidebar
  settings.tsx    per-profile settings

lib/
  supabase.ts     Supabase client
  groq.ts         Groq API — chat, vision, transcription, system prompts
  types.ts        TypeScript interfaces
```

---

## Usage limits

Soft cap at **50,000 tokens/day** across all profiles, staying safely within Groq's free tier. Resets daily. Users see a friendly message if the limit is hit.

---

## Honest notes

- PINs are stored as plain text — fine for a private family app, hash them before any public release
- API keys are client-side — acceptable for a known private group, move behind a backend proxy for public release
- For best read-aloud voice quality, use Safari (gives access to Apple's neural voices)
- No App Store yet — validating with real family use first before the $99/year investment
