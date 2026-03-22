const NOISE_PATTERNS = [
  /^(lol|haha|hehe|kk+|rs+|ok|sim|nao|yes|no|sure|yep|nope|yeah|nah|hmm+|ah+|oh+|wow|nice|cool|great|thanks|thx|ty|np|gg|brb|omg|wtf|lmao|rofl)$/i,
  /^[\p{Emoji}\s]+$/u,                          // So emojis
  /^.{0,3}$/,                                    // 3 chars ou menos
  /^\?+$|^!+$/,                                  // So pontuacao
];

const RELEVANT_SIGNALS = [
  /\b\d{1,2}[\/\-\.]\d{1,2}/,                   // Datas
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

  // Descarta ruido obvio
  for (const pattern of NOISE_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }

  // Mensagens muito curtas sem sinais claros
  const words = trimmed.split(/\s+/);
  if (words.length < 4) return false;

  // Verifica sinais de relevancia
  for (const signal of RELEVANT_SIGNALS) {
    if (signal.test(trimmed)) return true;
  }

  // Mensagens longas (7+ palavras) tem chance de ser relevantes
  // Deixa o LLM decidir
  if (words.length >= 7) return true;

  return false;
}