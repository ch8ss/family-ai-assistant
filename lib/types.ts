export interface Profile {
  id: string;
  slot: number;
  name: string;
  ai_name: string;
  pin: string;
  created_at: string;
}

export interface Conversation {
  id: string;
  profile_id: string;
  title: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  profile_id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}
