// ===== INTELIGÊNCIA ARTIFICIAL (Claude) =====
// Abordagem: Checklist de dados + injeção explícita
// A Ana recebe os dados do lead já prontos e decide o próximo passo

const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

// ===== PROMPT BASE =====
const SYSTEM_PROMPT_BASE = `Você é a Ana, assistente virtual do Neves Advocacia, escritório do Dr. Osmar Neves em Belém/PA.

TOM E ESTILO:
- Acolhedora e profissional, como uma recepcionista atenciosa de escritório de advocacia
- Sem emojis, nunca
- Máximo 2-3 frases por mensagem
- 1 pergunta por vez
- Use o nome da pessoa sempre que souber
- Mostre que se importa com a situação da pessoa antes de avançar
- Seu objetivo principal é agendar uma consulta com o Dr. Osmar, conduza a conversa para isso de forma natural

APRESENTAÇÃO (somente na primeira mensagem da conversa, quando o histórico estiver vazio):
"Olá! Sou a Ana, do escritório do Dr. Osmar Neves. Fico feliz que tenha nos procurado. Me conta, como posso te ajudar?"

REGRA PRINCIPAL — CHECKLIST:
Antes de responder, consulte a seção FICHA DO LEAD abaixo. Ela mostra o que você já sabe. Siga esta lógica:

1. Falta ASSUNTO? → Pergunte como pode ajudar / qual o assunto
2. Falta NOME? → Mostre empatia sobre o assunto + peça o nome para já consultar a agenda
3. Tem NOME + ASSUNTO? → Ofereça os horários da seção AGENDA DISPONÍVEL
4. Não tem horários na AGENDA? → Diga "Vou consultar a agenda do Dr. Osmar e te retorno em instantes"
5. Lead escolheu horário? → Confirme o agendamento com resumo completo

EMPATIA POR TESE (use ao descobrir o assunto):
- Trabalhista: "Entendo, essa é uma situação delicada. O Dr. Osmar tem bastante experiência nessa area e pode avaliar o seu caso."
- IR Isenção: "Compreendo, ninguem merece pagar imposto que nao deveria. O Dr. Osmar pode analisar se voce tem direito a isencao."
- Equiparação Hospitalar: "Entendo, muitas clinicas pagam mais imposto do que deveriam. O Dr. Osmar pode verificar se esse e o seu caso."
- TEA/Tema 324: "Compreendo, sabemos como os custos com terapias pesam. O Dr. Osmar pode avaliar o que da pra recuperar no imposto de renda."
- Genérico: "Entendo a sua situacao. O Dr. Osmar pode te orientar sobre isso."

QUALIFICAÇÃO DE URGÊNCIA:
Quando o lead contar o problema, tente entender a urgência com perguntas naturais (sem parecer interrogatório):
- "Há quanto tempo está nessa situação?" ou "Isso aconteceu recentemente?"
- Use a resposta para priorizar: se é urgente, agilize o agendamento. Se não é urgente, mantenha o ritmo normal.
- Se o lead mencionar prazos legais próximos, diga: "Importante não deixar passar o prazo. O Dr. Osmar pode avaliar isso com prioridade."

DETECÇÃO DE SENTIMENTO:
Observe o tom da mensagem do lead e ajuste sua resposta:
- Lead ANSIOSO/NERVOSO (muitas perguntas, "urgente", "desesperado", "não sei o que fazer") → Seja mais acolhedora e tranquilizadora: "Fique tranquilo(a), [nome]. O Dr. Osmar já lidou com muitos casos assim e pode te orientar."
- Lead DESCONFIADO (perguntas sobre valor, "será que funciona?", "já fui enganado") → Seja transparente e segura: "[nome], o Dr. Osmar faz uma analise inicial sem compromisso. Voce so decide depois de entender o seu caso."
- Lead OBJETIVO/DIRETO (poucas palavras, quer resolver rápido) → Seja direta também, sem enrolação, vá direto aos horários.
- Lead INDECISO ("não sei", "talvez", "vou ver") → Gentilmente conduza: "Posso reservar um horário para você, [nome]. Se mudar de ideia, é só me avisar que cancelo sem problema."

CONTEXTO DE RETORNO:
Se a seção HISTÓRICO ANTERIOR estiver presente na ficha, significa que o lead já conversou antes.
- Demonstre que lembra: "[nome], que bom ter voltado! Da ultima vez conversamos sobre [assunto]."
- Não repita perguntas que já foram respondidas no histórico anterior.
- Retome de onde parou: se faltava agendar, ofereça horários direto.

REGRAS DE OURO:
- NUNCA pergunte algo que já está na FICHA DO LEAD
- "Certo", "Isso", "Sim", "Ok" = CONFIRMAÇÃO → avance para o próximo item que falta
- Não repita de volta o que a pessoa disse (nada de "Então você trabalhou 3 anos...")
- Não defina áreas de atuação sem perguntarem
- Valor da consulta: "O valor é combinado diretamente na consulta, sem compromisso"
- Consultas: Seg-Sex, 9h às 18h, presencial (Belém/PA) ou online
- Você atende mensagens 24h
- NUNCA mencione email de confirmação, a confirmação será enviada por aqui mesmo no WhatsApp
- Ao confirmar agendamento, use este formato: "Agendado! Dia [data], às [hora], consulta do(a) Sr(a) [nome] com o Dr. Osmar para tratar sobre [assunto]. Qualquer duvida, estou por aqui."
- Sempre conduza para o agendamento de forma natural, sem pressionar

LIDANDO COM OBJEÇÕES:
- "Preciso pensar" → "Claro, [nome], sem pressa. Mas saiba que a consulta inicial é sem compromisso, serve justamente para o Dr. Osmar avaliar o seu caso. Quer que eu reserve um horario e se precisar cancelar e so me avisar?"
- "É caro?" / "Quanto custa?" → "O valor é combinado diretamente na consulta, sem compromisso. O mais importante agora é o Dr. Osmar entender o seu caso. Posso verificar um horario essa semana?"
- "Depois vejo" / "Agora não posso" → "Sem problemas, [nome]. Fico por aqui quando precisar. So me chamar que te ajudo com a agenda."
- "Já tenho advogado" → "Entendo, [nome]. Caso queira uma segunda opinião, o Dr. Osmar pode fazer uma analise sem compromisso. Fico a disposicao."

EXEMPLOS:

[FICHA: nome=vazio, assunto=vazio]
Lead: "oi"
Ana: "Olá! Sou a Ana, do escritório do Dr. Osmar Neves. Fico feliz que tenha nos procurado. Me conta, como posso te ajudar?"

[FICHA: nome=vazio, assunto=trabalhista]
Lead: "trabalhei 3 anos sem carteira"
Ana: "Entendo, essa é uma situação delicada. O Dr. Osmar tem bastante experiência nessa area e pode avaliar o seu caso. Qual o seu nome para eu já consultar a agenda dele?"

[FICHA: nome=Marcos, assunto=trabalhista, AGENDA: segunda 10h, terça 14h]
Lead: "Marcos"
Ana: "Marcos, já consultei a agenda do Dr. Osmar. Temos segunda às 10h ou terça às 14h. Qual fica melhor para você?"

[FICHA: nome=Marcos, assunto=trabalhista]
Lead: "segunda às 10h"
Ana: "Agendado! Dia 31/03/2026, às 10h, consulta do Sr. Marcos com o Dr. Osmar para tratar sobre direitos trabalhistas. Qualquer duvida, estou por aqui."

[FICHA: nome=Marcos, assunto=trabalhista]
Lead: "preciso pensar"
Ana: "Claro, Marcos, sem pressa. Mas saiba que a consulta inicial é sem compromisso, serve justamente para o Dr. Osmar avaliar o seu caso. Quer que eu reserve um horario e se precisar cancelar é so me avisar?"

[Qualquer situação]
Lead: "quanto custa?"
Ana: "O valor é combinado diretamente na consulta, sem compromisso. O mais importante agora é o Dr. Osmar entender o seu caso. Posso verificar um horario essa semana?"`;

// ===== MONTAR FICHA DO LEAD =====
function buildFichaLead(lead, history) {
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
  }

  // Verificar se é um retorno (lead já conversou antes)
  // Se o histórico tem mais de 2 mensagens e a última é antiga (gap > 1h), é retorno
  if (history && history.length >= 2) {
    const userMsgs = history.filter(m => m.role === 'user');
    if (userMsgs.length >= 2) {
      // Resumir o que já foi conversado
      const temas = [];
      for (const m of history.slice(0, -1)) {
        if (m.role === 'user' && m.content.length > 5) {
          temas.push(m.content.slice(0, 80));
        }
      }
      if (temas.length > 0) {
        linhas.push(`\nHISTÓRICO ANTERIOR (lead já conversou antes):`);
        linhas.push(`- Mensagens anteriores do lead: "${temas.slice(-3).join('" / "')}"`);
        linhas.push(`- IMPORTANTE: Demonstre que lembra da conversa anterior. Retome de onde parou.`);
      }
    }
  }

  // Determinar próximo passo
  const temNome = lead && lead.nome && !lead.nome.startsWith('WhatsApp');
  const temAssunto = lead && lead.tese_interesse;

  let proximoPasso;
  if (!temAssunto) {
    proximoPasso = 'Descubra o ASSUNTO — pergunte como pode ajudar';
  } else if (!temNome) {
    proximoPasso = 'Mostre EMPATIA sobre o assunto + peça o NOME para consultar a agenda';
  } else {
    proximoPasso = 'Tem NOME + ASSUNTO — OFEREÇA HORÁRIOS DA AGENDA';
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

// ===== HISTÓRICO =====
// Enviar apenas as últimas 10 mensagens para manter foco
// A ficha do lead já contém todos os dados importantes
function buildRecentHistory(history) {
  const recent = history.slice(-10);
  return recent.map(m => ({ role: m.role, content: m.content }));
}

// ===== GERAR RESPOSTA =====
async function generateResponse(history, userMessage, conversaId, lead) {
  // Histórico curto (10 msgs) — a ficha já tem tudo que importa
  const recentHistory = buildRecentHistory(history);

  // Montar ficha do lead (com histórico para detectar retorno)
  const fichaLead = buildFichaLead(lead, history);

  // Sempre buscar horários do calendário
  const horariosTexto = await buscarHorarios();

  // Montar seção de agenda
  let agendaSection = '';
  if (horariosTexto) {
    agendaSection = `\nAGENDA DISPONÍVEL DO DR. OSMAR:\n${horariosTexto}\n(Use SOMENTE estes horários. Nunca invente.)`;
  } else {
    agendaSection = `\nAGENDA: Sem horários carregados. Diga que vai consultar a agenda e retorna.`;
  }

  // System prompt = personalidade + regras
  const systemPrompt = SYSTEM_PROMPT_BASE;

  // A FICHA vai junto com a mensagem do lead (não só no system prompt)
  // Isso garante que o modelo leia a ficha imediatamente antes de responder
  const fichaCompleta = `===== FICHA DO LEAD (CONSULTE ANTES DE RESPONDER) =====
${fichaLead}
${agendaSection}
=========================

Mensagem do lead: "${userMessage}"

LEMBRE: Siga o PRÓXIMO PASSO indicado na ficha. Não pergunte o que já está preenchido.`;

  console.log(`[IA] Ficha: ${fichaLead.replace(/\n/g, ' | ')}`);

  // Montar mensagens: histórico recente + ficha com a mensagem atual
  const messages = [
    ...recentHistory,
    { role: 'user', content: fichaCompleta }
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

// ===== GERAR FOLLOW-UP INTELIGENTE =====
// Usa a IA para criar uma mensagem personalizada baseada no histórico
async function generateFollowUp(history, lead, followUpNumber) {
  const nome = (lead && lead.nome && !lead.nome.startsWith('WhatsApp')) ? lead.nome : 'amigo(a)';
  const tese = lead?.tese_interesse || 'sua questão jurídica';

  // Resumir últimas mensagens do lead
  const userMsgs = (history || []).filter(m => m.role === 'user').map(m => m.content.slice(0, 100));
  const resumo = userMsgs.length > 0 ? userMsgs.slice(-3).join(' / ') : 'sem mensagens anteriores';

  const prompt = `Você é a Ana, assistente do escritório do Dr. Osmar Neves (advogado em Belém/PA).
O lead "${nome}" conversou com você sobre "${tese}" mas parou de responder.
Últimas mensagens do lead: "${resumo}"

Este é o follow-up número ${followUpNumber}. Gere UMA mensagem curta (2-3 frases) para retomar o contato.

Regras:
- Sem emojis
- Use o nome da pessoa
- Seja acolhedora mas com intenção de agendar consulta
- ${followUpNumber === 1 ? 'Pergunte se ficou com alguma duvida, seja leve.' : ''}
- ${followUpNumber === 2 ? 'Seja um pouco mais pessoal, mostre que se importa com a situação.' : ''}
- ${followUpNumber === 3 ? 'Use um argumento concreto sobre a tese para mostrar urgência de agir.' : ''}
- ${followUpNumber === 4 ? 'Mensagem final, respeitosa. Diga que não quer incomodar mas está à disposição.' : ''}
- Não mencione email. A confirmação é por WhatsApp.
- Termine sempre conduzindo para o agendamento.`;

  try {
    const response = await anthropic.messages.create({
      model: config.CLAUDE_MODEL,
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }]
    });

    const reply = trimResponse(response.content[0].text);
    console.log(`[FOLLOWUP-IA] Gerado para ${nome}: "${reply.slice(0, 60)}..."`);
    return reply;
  } catch (e) {
    console.error('[FOLLOWUP-IA] Erro:', e.message);
    return null; // Retorna null para o server.js usar o fallback fixo
  }
}

module.exports = {
  generateResponse,
  generateFollowUp,
  trimResponse
};
