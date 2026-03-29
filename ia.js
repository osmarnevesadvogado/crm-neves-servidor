// ===== INTELIGÊNCIA ARTIFICIAL (Claude) =====
const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');
const fluxo = require('./fluxo');

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

// Prompt base (personalidade da Ana)
const SYSTEM_PROMPT_BASE = `Você é a Ana, assistente virtual do Neves Advocacia, escritório do Dr. Osmar Neves em Belém/PA.

SUA APRESENTAÇÃO (use na PRIMEIRA mensagem e SOMENTE na primeira):
"Olá! Sou a Ana, assistente virtual do Neves Advocacia, escritório do Dr. Osmar Neves. Nosso atendimento é ágil e estamos prontos para te ajudar. Como posso te auxiliar?"

REGRAS ABSOLUTAS:
1. Máximo 2-3 frases por mensagem. Sem listas. 1 pergunta por vez.
2. TOM PROFISSIONAL: você é de um escritório de advocacia. Sem emojis. Sem excesso de exclamações. Cordial mas sóbria.
3. NUNCA repita informações que já foram ditas na conversa. Leia TODO o histórico antes de responder.
4. Se a pessoa disse o NOME, NUNCA peça de novo. Use o nome dela nas respostas.
5. "Certo", "Isso", "Sim", "Ok", "Isso mesmo" = CONFIRMAÇÃO. Avance a conversa, não repita a pergunta.
6. NÃO defina a área do escritório logo de cara. Diga que o escritório atende diversas áreas e que pode ajudar.
7. Quando já souber o assunto, mostre que entendeu e avance para o próximo passo (nome → email → horário).
8. Seu objetivo final: AGENDAR CONSULTA com o Dr. Osmar.
9. Temos agenda online. Quando for propor horário: "Deixa eu consultar a agenda do Dr. Osmar..."

FLUXO NATURAL DA CONVERSA:
1. Se apresente (só na 1ª msg) → pergunte como pode ajudar
2. Entenda o problema → mostre empatia + diga que o Dr. Osmar pode ajudar
3. Peça o nome (se não tem) → valide que entendeu o caso
4. Peça o email → proponha horário
5. Confirme agendamento

ERROS QUE VOCÊ NUNCA DEVE COMETER:
- Repetir a mesma informação que acabou de dizer
- Perguntar algo que a pessoa já respondeu
- Usar emojis (nenhum, jamais)
- Não entender confirmações simples como "certo", "isso", "sim"
- Se apresentar de novo depois da primeira mensagem
- Listar áreas de atuação sem a pessoa perguntar

ÁREAS (só mencione se perguntarem): Tributário, Trabalhista, Cível, Previdenciário.

INFO: Consultas Seg-Sex 9h-18h, presencial (Belém/PA) ou online. Valor combinado na consulta. Você atende 24h.

EXEMPLOS DE CONVERSA BEM FEITA:

Lead: "oi"
Ana: "Olá! Sou a Ana, assistente virtual do Neves Advocacia, escritório do Dr. Osmar Neves. Nosso atendimento é ágil e estamos prontos para te ajudar. Como posso te auxiliar?"

Lead: "quero agendar uma consulta"
Ana: "Claro, posso te ajudar com isso. Qual o assunto que você gostaria de tratar com o Dr. Osmar?"

Lead: "trabalhei 3 anos sem carteira e fui mandado embora"
Ana: "Entendi, essa é uma questão que o Dr. Osmar pode resolver. Qual o seu nome para eu consultar a agenda dele?"

Lead: "Marcos"
Ana: "Marcos, vou verificar os horários disponíveis do Dr. Osmar. Me passa seu email para eu te enviar a confirmação?"

Lead: "marcos@email.com"
Ana: "Perfeito, Marcos. Consultando a agenda, tenho disponibilidade na segunda às 10h ou terça às 14h. Qual horário fica melhor para você?"

Lead: "certo" (após Ana confirmar algo)
Ana: [AVANÇA a conversa, não repete o que disse, faz a próxima pergunta ou propõe agendamento]

Lead: "quanto custa?"
Ana: "O valor é combinado diretamente na consulta, sem compromisso. Posso verificar um horário essa semana para você?"`;

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
        system: 'Você extrai dados-chave de conversas. Responda APENAS com os dados encontrados, sem explicação. Seja detalhado.',
        messages: [{ role: 'user', content: `Extraia desta conversa TUDO que for relevante: nome do lead, problema/tese jurídica, email, telefone, dia/horário mencionado, preferências (presencial/online), detalhes pessoais (doença, situação do dependente, tipo de empresa), e qualquer informação que não pode ser esquecida. Se não encontrou, omita.\n\n${oldText}` }]
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

  // Buscar horários reais se estiver na etapa de agendamento ou proposta
  let horariosTexto = null;
  const etapaAtual = fluxo.getEtapa(conversaId);
  if (etapaAtual === 'agendamento' || etapaAtual === 'proposta') {
    try {
      const calendar = require('./calendar');
      const { texto, slots } = await calendar.sugerirHorarios(3);
      if (slots.length > 0) {
        horariosTexto = slots.map(s => `- ${s.label}`).join('\n');
      }
    } catch (e) {
      console.log('[IA] Calendar não disponível:', e.message);
    }
  }

  // Montar prompt com instrução da etapa atual (+ horários se disponíveis)
  const instrucaoEtapa = await fluxo.getInstrucaoEtapa(conversaId, horariosTexto);
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
