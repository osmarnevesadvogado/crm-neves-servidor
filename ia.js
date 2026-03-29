// ===== INTELIGÊNCIA ARTIFICIAL (Claude) =====
// Abordagem: Checklist de dados + injeção explícita
// A Ana recebe os dados do lead já prontos e decide o próximo passo

const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

// ===== PROMPT BASE =====
const SYSTEM_PROMPT_BASE = `Você é a Ana, assistente virtual do Neves Advocacia, escritório do Dr. Osmar Neves em Belém/PA.

TOM E ESTILO:
- Profissional e cordial, como uma recepcionista de escritório de advocacia
- Sem emojis, nunca
- Máximo 2-3 frases por mensagem
- 1 pergunta por vez
- Use o nome da pessoa sempre que souber

APRESENTAÇÃO (somente na primeira mensagem da conversa, quando o histórico estiver vazio):
"Olá! Sou a Ana, assistente virtual do Neves Advocacia, escritório do Dr. Osmar Neves. Nosso atendimento é ágil e estamos prontos para te ajudar. Como posso te auxiliar?"

REGRA PRINCIPAL — CHECKLIST:
Antes de responder, consulte a seção FICHA DO LEAD abaixo. Ela mostra o que você já sabe. Siga esta lógica:

1. Falta ASSUNTO? → Pergunte como pode ajudar / qual o assunto
2. Falta NOME? → Pergunte o nome para consultar a agenda
3. Falta EMAIL? → Peça o email para enviar a confirmação
4. Tem NOME + ASSUNTO + EMAIL? → Ofereça os horários da seção AGENDA DISPONÍVEL
5. Não tem horários na AGENDA? → Diga "Vou consultar a agenda do Dr. Osmar e te retorno"

REGRAS DE OURO:
- NUNCA pergunte algo que já está na FICHA DO LEAD
- "Certo", "Isso", "Sim", "Ok" = CONFIRMAÇÃO → avance para o próximo item que falta
- Quando a pessoa conta o problema, mostre empatia em 1 frase e avance: "Entendi, o Dr. Osmar pode te ajudar com isso."
- Não repita de volta o que a pessoa disse (nada de "Então você trabalhou 3 anos...")
- Não defina áreas de atuação sem perguntarem
- Valor da consulta: "É combinado diretamente na consulta, sem compromisso"
- Consultas: Seg-Sex, 9h às 18h, presencial (Belém/PA) ou online
- Você atende mensagens 24h

EXEMPLOS:

[FICHA: nome=vazio, assunto=vazio, email=vazio]
Lead: "oi"
Ana: "Olá! Sou a Ana, assistente virtual do Neves Advocacia, escritório do Dr. Osmar Neves. Nosso atendimento é ágil e estamos prontos para te ajudar. Como posso te auxiliar?"

[FICHA: nome=vazio, assunto=trabalhista, email=vazio]
Lead: "trabalhei 3 anos sem carteira"
Ana: "Entendi, o Dr. Osmar pode te ajudar com isso. Qual o seu nome para eu verificar a agenda dele?"

[FICHA: nome=Marcos, assunto=trabalhista, email=vazio]
Lead: "Marcos"
Ana: "Marcos, me passa seu email para eu te enviar a confirmação do agendamento?"

[FICHA: nome=Marcos, assunto=trabalhista, email=marcos@email.com, AGENDA: segunda 10h, terça 14h]
Lead: "marcos@email.com"
Ana: "Marcos, consultei a agenda do Dr. Osmar. Tenho segunda às 10h ou terça às 14h. Qual fica melhor para você?"

[FICHA: nome=Marcos, assunto=trabalhista, email=marcos@email.com]
Lead: "certo" / "isso" / "sim"
Ana: [Avança para o próximo passo — NÃO repete o que disse, NÃO confirma de volta]

[Qualquer situação]
Lead: "quanto custa?"
Ana: "O valor é combinado diretamente na consulta, sem compromisso. Posso verificar um horário essa semana para você?"`;

// ===== MONTAR FICHA DO LEAD =====
function buildFichaLead(lead) {
  const linhas = [];

  if (lead && lead.nome && !lead.nome.startsWith('WhatsApp')) {
    linhas.push(`- Nome: ${lead.nome}`);
  } else {
    linhas.push(`- Nome: (não informado ainda)`);
  }

  if (lead && lead.tese_interesse) {
    linhas.push(`- Assunto: ${lead.tese_interesse}`);
  } else {
    linhas.push(`- Assunto: (não informado ainda)`);
  }

  if (lead && lead.email) {
    linhas.push(`- Email: ${lead.email}`);
  } else {
    linhas.push(`- Email: (não informado ainda)`);
  }

  // Determinar próximo passo
  const temNome = lead && lead.nome && !lead.nome.startsWith('WhatsApp');
  const temAssunto = lead && lead.tese_interesse;
  const temEmail = lead && lead.email;

  let proximoPasso;
  if (!temAssunto) {
    proximoPasso = 'Descubra o ASSUNTO — pergunte como pode ajudar';
  } else if (!temNome) {
    proximoPasso = 'Peça o NOME para consultar a agenda';
  } else if (!temEmail) {
    proximoPasso = 'Peça o EMAIL para enviar confirmação';
  } else {
    proximoPasso = 'Todos os dados coletados — OFEREÇA HORÁRIOS DA AGENDA';
  }

  linhas.push(`\nPRÓXIMO PASSO: ${proximoPasso}`);

  return linhas.join('\n');
}

// ===== BUSCAR HORÁRIOS DO CALENDÁRIO =====
async function buscarHorarios() {
  try {
    const calendar = require('./calendar');
    const { texto, slots } = await calendar.sugerirHorarios(3);
    if (slots.length > 0) {
      return slots.map(s => `- ${s.label}`).join('\n');
    }
  } catch (e) {
    console.log('[IA] Calendar não disponível:', e.message);
  }
  return null;
}

// ===== CORTAR RESPOSTAS LONGAS =====
function trimResponse(text) {
  // Remover listas e bullets
  let clean = text.replace(/^[\s]*[-•·*]\s*/gm, '').replace(/^[\s]*\d+[.)]\s*/gm, '');
  clean = clean.replace(/\n{2,}/g, '\n').trim();

  // Remover emojis
  clean = clean.replace(/[\u{1F300}-\u{1FAF8}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu, '').trim();

  // Proteger abreviações em PT-BR
  const protected_ = clean
    .replace(/\b(Dr|Dra|Sr|Sra|Prof|Art|Inc|Ltd|Ltda|nº|tel)\./gi, '$1\u0000')
    .replace(/(\d)\./g, '$1\u0000')
    .replace(/\.{3}/g, '\u0001');

  const sentences = protected_.match(/[^.!?]+[.!?]+/g) || [protected_];
  const restored = sentences.map(s => s.replace(/\u0000/g, '.').replace(/\u0001/g, '...'));

  const result = restored.slice(0, 4).join(' ').trim();
  if (result.length > 400) {
    return restored.slice(0, 3).join(' ').trim();
  }
  return result;
}

// ===== HISTÓRICO INTELIGENTE =====
const summaryCache = new Map();

async function buildSmartHistory(history, conversaId) {
  if (history.length <= 40) {
    return history.map(m => ({ role: m.role, content: m.content }));
  }

  const recentMsgs = history.slice(-30);
  const oldMsgs = history.slice(0, -30);

  const cached = summaryCache.get(conversaId);
  let summary;

  if (cached && cached.msgCount >= oldMsgs.length - 2) {
    summary = cached.summary;
  } else {
    const oldText = oldMsgs.map(m => `${m.role === 'user' ? 'Lead' : 'Ana'}: ${m.content}`).join('\n');
    try {
      const res = await anthropic.messages.create({
        model: config.CLAUDE_MODEL,
        max_tokens: 500,
        system: 'Extraia dados-chave: nome, problema jurídico, email, preferências. Só os dados, sem explicação.',
        messages: [{ role: 'user', content: `Extraia os dados relevantes:\n\n${oldText}` }]
      });
      summary = res.content[0].text;
    } catch (e) {
      summary = 'Conversa anterior sem dados específicos extraídos.';
    }

    if (conversaId) {
      summaryCache.set(conversaId, { msgCount: oldMsgs.length, summary });
      if (summaryCache.size > 100) {
        const oldest = summaryCache.keys().next().value;
        summaryCache.delete(oldest);
      }
    }
  }

  const summaryMsg = { role: 'user', content: `[Resumo da conversa anterior]\n${summary}` };
  const recent = recentMsgs.map(m => ({ role: m.role, content: m.content }));

  if (recent.length > 0 && recent[0].role === 'user') {
    return [summaryMsg, { role: 'assistant', content: 'Entendi, vou continuar o atendimento.' }, ...recent];
  }

  return [summaryMsg, ...recent];
}

// ===== GERAR RESPOSTA =====
async function generateResponse(history, userMessage, conversaId, lead) {
  const smartHistory = await buildSmartHistory(history, conversaId);

  // Montar ficha do lead (dados que a Ana já tem)
  const fichaLead = buildFichaLead(lead);

  // Sempre buscar horários do calendário
  const horariosTexto = await buscarHorarios();

  // Montar seção de agenda
  let agendaSection = '';
  if (horariosTexto) {
    agendaSection = `\nAGENDA DISPONÍVEL DO DR. OSMAR:\n${horariosTexto}\n(Use SOMENTE estes horários. Nunca invente horários.)`;
  } else {
    agendaSection = `\nAGENDA DISPONÍVEL: Sem horários carregados. Diga que vai consultar a agenda e retorna.`;
  }

  // Montar system prompt completo
  const systemPrompt = `${SYSTEM_PROMPT_BASE}\n\n===== FICHA DO LEAD =====\n${fichaLead}\n${agendaSection}\n=========================`;

  console.log(`[IA] Ficha: ${fichaLead.replace(/\n/g, ' | ')}`);

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
