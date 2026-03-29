// ===== INTELIGÊNCIA ARTIFICIAL (Claude) =====
const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');
const fluxo = require('./fluxo');

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

// Prompt base (personalidade da Ana)
const SYSTEM_PROMPT_BASE = `Você é a Ana, atendente da Neves Advocacia (Dr. Osmar Neves, tributarista, Belém/PA). Você conversa por WhatsApp igual uma pessoa real.

REGRAS ABSOLUTAS:
- Máximo 2 frases por mensagem
- Zero listas, zero bullet points
- 1 pergunta por vez
- Use as palavras que a pessoa usou
- Nunca pergunte o que já foi dito
- Leia os DADOS DO LEAD antes de responder

ÁREAS: IR Isenção (aposentados doentes), Equiparação Hospitalar (clínicas), TEA/Tema 324 (escola, terapia, tudo sobre dependentes TEA), Trabalhista.

INFO: Consultas Seg-Sex 9h-18h, presencial ou online. Você atende 24h. Preço só na consulta.

EXEMPLOS DE COMO RESPONDER:

Lead: "oi, queria saber sobre isenção de imposto de renda"
Ana: "Oi! O Dr. Osmar é especialista nisso. Você é aposentado ou pensionista?"

Lead: "sou aposentado e tenho diabetes"
Ana: "Diabetes dá direito sim à isenção, já tivemos vários casos parecidos que deram certo. Qual seu nome?"

Lead: "João Silva"
Ana: "Prazer, João! Me passa seu email que te mando os detalhes da consulta?"

Lead: "joao@email.com"
Ana: "Anotado! Que tal quarta às 14h com o Dr. Osmar? Pode ser presencial ou online."

Lead: "meu filho tem autismo e gasto muito com escola especial"
Ana: "Esses gastos com escola do seu filho podem ser deduzidos no IR, tem decisão judicial sobre isso. Quer agendar uma consulta pra ver quanto dá pra recuperar?"

Lead: "quanto custa a consulta?"
Ana: "O valor a gente combina na própria consulta, sem compromisso. Posso te encaixar essa semana ainda, quer?"`;

// Cache de resumos de conversas longas
const summaryCache = new Map();

// Cortar mensagens longas (protegendo abreviações em PT-BR)
function trimResponse(text) {
  let clean = text.replace(/^[\s]*[-•·*]\s*/gm, '').replace(/^[\s]*\d+[.)]\s*/gm, '');
  clean = clean.replace(/\n{2,}/g, '\n').trim();

  const protected_ = clean
    .replace(/\b(Dr|Dra|Sr|Sra|Prof|Art|Inc|Ltd|Ltda|nº|tel)\./gi, '$1\u0000')
    .replace(/(\d)\./g, '$1\u0000')
    .replace(/\.{3}/g, '\u0001');

  const sentences = protected_.match(/[^.!?]+[.!?]+/g) || [protected_];
  const restored = sentences.map(s => s.replace(/\u0000/g, '.').replace(/\u0001/g, '...'));

  const result = restored.slice(0, 3).join(' ').trim();
  if (result.length > 300) {
    return restored.slice(0, 2).join(' ').trim();
  }
  return result;
}

// Construir histórico inteligente (com resumo para conversas longas)
async function buildSmartHistory(history, conversaId) {
  if (history.length <= 20) {
    return history.map(m => ({ role: m.role, content: m.content }));
  }

  const recentMsgs = history.slice(-12);
  const oldMsgs = history.slice(0, -12);

  const cached = summaryCache.get(conversaId);
  let summary;

  if (cached && cached.msgCount >= oldMsgs.length - 2) {
    summary = cached.summary;
  } else {
    const oldText = oldMsgs.map(m => `${m.role === 'user' ? 'Lead' : 'Ana'}: ${m.content}`).join('\n');
    try {
      const res = await anthropic.messages.create({
        model: config.CLAUDE_MODEL,
        max_tokens: 200,
        system: 'Você extrai dados-chave de conversas. Responda APENAS com os dados encontrados, sem explicação.',
        messages: [{ role: 'user', content: `Extraia desta conversa: nome do lead, problema/tese jurídica, email, telefone, dia/horário mencionado, qualquer informação pessoal relevante. Se não encontrou, omita.\n\n${oldText}` }]
      });
      summary = res.content[0].text;
    } catch (e) {
      summary = extractKeyInfoFallback(oldMsgs);
    }

    if (conversaId) {
      summaryCache.set(conversaId, { msgCount: oldMsgs.length, summary });
      if (summaryCache.size > 100) {
        const oldest = summaryCache.keys().next().value;
        summaryCache.delete(oldest);
      }
    }
  }

  const summaryMsg = {
    role: 'user',
    content: `[DADOS DO LEAD - use estas informações, nunca pergunte de novo]\n${summary}\n[FIM DOS DADOS]`
  };

  const recent = recentMsgs.map(m => ({ role: m.role, content: m.content }));

  if (recent.length > 0 && recent[0].role === 'user') {
    return [summaryMsg, { role: 'assistant', content: 'Ok, tenho os dados do lead.' }, ...recent];
  }

  return [summaryMsg, ...recent];
}

// Fallback: extração manual sem IA
function extractKeyInfoFallback(messages) {
  const allText = messages.map(m => m.content).join(' ');
  const info = [];

  const nomeMatch = allText.match(/(?:me chamo|meu nome é|sou o |sou a |meu nome:|nome:)\s*([A-ZÀ-Ú][a-zà-ú]+(?: [A-ZÀ-Ú][a-zà-ú]+)*)/i);
  if (nomeMatch) info.push(`Nome: ${nomeMatch[1]}`);

  const emailMatch = allText.match(/[\w.-]+@[\w.-]+\.\w+/);
  if (emailMatch) info.push(`Email: ${emailMatch[0]}`);

  const teses = ['isenção', 'imposto de renda', 'equiparação', 'hospitalar', 'tea', 'autismo', 'trabalhista'];
  const teseFound = teses.filter(t => allText.toLowerCase().includes(t));
  if (teseFound.length) info.push(`Interesse: ${teseFound.join(', ')}`);

  const diaMatch = allText.match(/(?:segunda|terça|quarta|quinta|sexta|sábado|amanhã|hoje)\s*(?:às?\s*)?(\d{1,2}[h:]?\d{0,2})?/gi);
  if (diaMatch) info.push(`Horário mencionado: ${diaMatch[diaMatch.length - 1]}`);

  return info.length > 0 ? info.join('\n') : 'Nenhum dado específico extraído ainda.';
}

// Gerar resposta da Ana
async function generateResponse(history, userMessage, conversaId) {
  const smartHistory = await buildSmartHistory(history, conversaId);

  // Montar prompt com instrução da etapa atual
  const instrucaoEtapa = fluxo.getInstrucaoEtapa(conversaId);
  const systemPrompt = `${SYSTEM_PROMPT_BASE}\n\n${instrucaoEtapa}`;

  const messages = [
    ...smartHistory,
    { role: 'user', content: userMessage }
  ];

  // Garantir alternância correta de roles
  const cleanMessages = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const prev = cleanMessages[cleanMessages.length - 1];
    if (prev && prev.role === msg.role) {
      prev.content += '\n' + msg.content;
    } else {
      cleanMessages.push({ ...msg });
    }
  }

  if (cleanMessages.length > 0 && cleanMessages[0].role !== 'user') {
    cleanMessages.unshift({ role: 'user', content: 'Olá' });
  }

  try {
    const response = await anthropic.messages.create({
      model: config.CLAUDE_MODEL,
      max_tokens: config.MAX_TOKENS,
      system: systemPrompt,
      messages: cleanMessages
    });

    return response.content[0].text;
  } catch (e) {
    console.error('[CLAUDE] Erro:', e.message);
    return 'Desculpe, estou com uma dificuldade técnica. Entre em contato pelo telefone do escritório.';
  }
}

module.exports = {
  generateResponse,
  trimResponse
};
