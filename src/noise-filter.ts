const NOISE_PATTERNS = [
  /^(lol|haha|hehe|kk+|rs+|ok|sim|nao|yes|no|sure|yep|nope|yeah|nah|hmm+|ah+|oh+|wow|nice|cool|great|thanks|thx|ty|np|gg|brb|omg|wtf|lmao|rofl)$/i,
  /^[\p{Emoji}\s]+$/u,                          // Emoji-only
  /^.{0,3}$/,                                    // 3 chars or less
  /^\?+$|^!+$/,                                  // Punctuation-only
];

const RELEVANT_SIGNALS = [
  /\b\d{1,2}[\/\-\.]\d{1,2}/,                   // Dates
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/i,
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  /\b(reuniao|meeting|call|deadline|entrega|appointment|evento|event)\b/i,
  /\b(mudou|changed|moved|cancelled|cancelou|adiou|postponed|rescheduled|updated|atualiz)/i,
  /\b(prefiro|prefer|favorite|favorit|gosto|like|want|quero|preciso|need)\b/i,
  /\b(decidimos|decided|agreed|combinamos|definimos|resolved)\b/i,
  /\b(telefone|phone|email|address|endereco|contato|contact)\b/i,
  /\b(lembr|remember|dont forget|nao esquec)\b/i,
];

export function isRelevantMessage(content: string): boolean {
  const trimmed = content.trim();

  // Discard obvious noise
  for (const pattern of NOISE_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }

  // Short messages without clear signals
  const words = trimmed.split(/\s+/);
  if (words.length < 4) return false;

  // Check for relevance signals
  for (const signal of RELEVANT_SIGNALS) {
    if (signal.test(trimmed)) return true;
  }

  // Long messages (7+ words) may be relevant — let the LLM decide
  if (words.length >= 7) return true;

  return false;
}
