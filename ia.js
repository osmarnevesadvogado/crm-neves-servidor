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
  }

  // Determinar próximo passo
  const temNome = lead && lead.nome && !lead.nome.startsWith('WhatsApp');
  const temAssunto = lead && lead.tese_interesse;

  let proximoPasso;
  if (!temAssunto) {
    proximoPasso = 'Descubra o ASSUNTO — pergunte como pode ajudar';
  } else if (!temNome) {
    proximoPasso = 'Peça o NOME para consultar a agenda';
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

  // Montar ficha do lead
  const fichaLead = buildFichaLead(lead);

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

module.exports = {
  generateResponse,
  trimResponse
};
