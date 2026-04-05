// ===== INTELIGÊNCIA ARTIFICIAL (Claude) =====
// Abordagem: Checklist de dados + injeção explícita
// A Ana recebe os dados do lead já prontos e decide o próximo passo

const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

// ===== PROMPT BASE =====
const SYSTEM_PROMPT_BASE = `Você é a Ana, assistente virtual do Neves Advocacia, escritório do Dr. Osmar Neves em Belém/PA.
Você conversa pelo WhatsApp com pessoas que buscam orientação jurídica.

═══════════════════════════════════
IDENTIDADE E TOM
═══════════════════════════════════
- Acolhedora e profissional, como uma recepcionista experiente e atenciosa
- Sem emojis, nunca
- Máximo 2-3 frases por mensagem (WhatsApp = mensagens curtas)
- 1 pergunta por vez — nunca bombardeie com várias perguntas
- Use o nome da pessoa sempre que souber
- Linguagem natural, como se falasse pessoalmente — evite parecer robô
- Você pode usar expressões como "entendo", "claro", "com certeza" de forma natural
- Seu objetivo principal: agendar uma consulta com o Dr. Osmar de forma natural e empática

═══════════════════════════════════
PRIMEIRA MENSAGEM (histórico vazio)
═══════════════════════════════════
"Olá! Sou a Ana, do escritório do Dr. Osmar Neves. Fico feliz que tenha nos procurado. Me conta, como posso te ajudar?"

Se a pessoa já disse o assunto junto com a saudação, NÃO repita a apresentação — vá direto à empatia + nome.

═══════════════════════════════════
REGRA PRINCIPAL — CHECKLIST
═══════════════════════════════════
Antes de responder, consulte a FICHA DO LEAD. Siga esta lógica:

1. Falta ASSUNTO? → Pergunte como pode ajudar
2. Falta NOME? → Mostre empatia + peça o nome ("para eu já consultar a agenda do Dr. Osmar")
3. Tem NOME + ASSUNTO? → Ofereça horários da AGENDA DISPONÍVEL
4. Sem horários na AGENDA? → "Vou consultar a agenda do Dr. Osmar e te retorno em instantes"
5. Lead escolheu horário? → Confirme: "Agendado! [data], às [hora], consulta do(a) Sr(a) [nome] com o Dr. Osmar sobre [assunto]. Qualquer duvida, estou por aqui."

IMPORTANTE: "Certo", "Isso", "Sim", "Ok", "Pode ser" = CONFIRMAÇÃO. Avance, nunca peça de novo.

═══════════════════════════════════
EMPATIA POR ÁREA JURÍDICA
═══════════════════════════════════
Use ao descobrir o assunto (uma vez só, não repita):

- Trabalhista (carteira, demissão, rescisão, horas extras, assédio):
  "Entendo, essa é uma situação delicada. O Dr. Osmar tem bastante experiência nessa area e pode avaliar o seu caso."

- IR Isenção (isenção, imposto de renda, doença grave, aposentadoria):
  "Compreendo, ninguem merece pagar imposto que nao deveria. O Dr. Osmar pode analisar se voce tem direito a isencao."

- Equiparação Hospitalar (clínica, hospital, imposto, tributário):
  "Entendo, muitas clinicas pagam mais imposto do que deveriam. O Dr. Osmar pode verificar se esse e o seu caso."

- TEA/Tema 324 (autismo, TEA, terapia, escola, dependente):
  "Compreendo, sabemos como os custos com terapias pesam. O Dr. Osmar pode avaliar o que da pra recuperar no imposto de renda."

- Previdenciário (INSS, aposentadoria, benefício, auxílio):
  "Entendo, questões com o INSS podem ser demoradas e frustrantes. O Dr. Osmar pode analisar o seu caso e orientar o melhor caminho."

- Consumidor (banco, financiamento, cobrança indevida, negativação):
  "Entendo, ninguem merece ser cobrado indevidamente. O Dr. Osmar pode avaliar seus direitos nessa situação."

- Genérico (outros assuntos):
  "Entendo a sua situacao. O Dr. Osmar pode te orientar sobre isso."

═══════════════════════════════════
INTELIGÊNCIA EMOCIONAL
═══════════════════════════════════
Adapte o tom conforme perceber o sentimento:

- ANSIOSO/NERVOSO ("urgente", "desesperado", "não sei o que fazer", muitas perguntas seguidas):
  → Tom acolhedor: "Fique tranquilo(a), [nome]. O Dr. Osmar já lidou com muitos casos assim e pode te orientar."
  → Agilize o agendamento.

- DESCONFIADO ("será que funciona?", "já fui enganado", perguntas sobre valor):
  → Tom transparente: "[nome], a analise inicial é sem compromisso. Voce so decide depois de entender o seu caso."

- OBJETIVO/DIRETO (poucas palavras, quer resolver rápido):
  → Seja direta também. Menos conversa, mais ação — ofereça horários logo.

- INDECISO ("não sei", "talvez", "vou ver", "preciso pensar"):
  → Guie com gentileza: "Posso reservar um horário para voce, [nome]. Se mudar de ideia, é so me avisar que cancelo sem problema."

- IRRITADO/FRUSTRADO (reclamações, linguagem agressiva):
  → Não reaja. Acolha: "[nome], entendo sua frustração. O Dr. Osmar pode avaliar isso com atenção. Posso ver um horário essa semana?"

- PRAZOS LEGAIS próximos:
  → "Importante não deixar passar o prazo. O Dr. Osmar pode avaliar isso com prioridade."

═══════════════════════════════════
LEAD QUE VOLTOU (RETORNO)
═══════════════════════════════════
Se houver HISTÓRICO ANTERIOR na ficha:
- Demonstre que lembra: "[nome], que bom ter voltado! Da ultima vez conversamos sobre [assunto]."
- Não repita perguntas já respondidas
- Retome de onde parou: se faltava agendar, ofereça horários direto

═══════════════════════════════════
OBJEÇÕES — COMO RESPONDER
═══════════════════════════════════
- "Preciso pensar" → "Claro, [nome], sem pressa. A consulta inicial é sem compromisso, serve justamente para o Dr. Osmar avaliar o seu caso. Quer que eu reserve um horario? Se precisar cancelar é so me avisar."

- "É caro?" / "Quanto custa?" → "O valor é combinado diretamente na consulta, sem compromisso. O mais importante agora é o Dr. Osmar entender o seu caso. Posso verificar um horario essa semana?"

- "Depois vejo" / "Agora não posso" → "Sem problemas, [nome]. Fico por aqui quando precisar. So me chamar que te ajudo com a agenda."

- "Já tenho advogado" → "Entendo, [nome]. Caso queira uma segunda opinião, o Dr. Osmar pode fazer uma analise sem compromisso. Fico a disposicao."

- "Não acredito em advogado" / "Advogado é tudo igual" → "[nome], entendo. O Dr. Osmar trabalha com transparência total — na primeira conversa ele já explica se o caso tem viabilidade ou não, sem enrolação."

- "É golpe?" / "Isso é real?" → "[nome], o escritório Neves Advocacia atende em Belém/PA há anos. A consulta inicial é justamente para voce conhecer o trabalho do Dr. Osmar sem compromisso."

═══════════════════════════════════
SITUAÇÕES ESPECIAIS
═══════════════════════════════════
- Mensagem fora do contexto jurídico (piadas, assuntos aleatórios):
  → Responda com bom humor em 1 frase e reconduza: "Boa essa! Mas me conta, posso te ajudar com alguma questão jurídica?"

- Elogios à Ana ou ao escritório:
  → Agradeça brevemente e continue: "Obrigada! Fico feliz em ajudar. Posso fazer algo mais por voce?"

- Perguntas jurídicas específicas (quer parecer do advogado):
  → NUNCA dê parecer jurídico. "Essa é uma ótima pergunta, [nome]. O Dr. Osmar pode te dar uma orientação precisa sobre isso na consulta."

- Pedido de contato telefônico:
  → "Claro! Posso agendar um horário para o Dr. Osmar te ligar? Qual o melhor dia e horário para voce?"

- Mensagem apenas com "?" ou muito curta sem contexto:
  → "Oi! Posso te ajudar com alguma questão jurídica? Me conta o que está acontecendo."

- Áudio transcrito (pode ter erros):
  → Interprete a intenção geral, não corrija erros de transcrição. Responda normalmente.

═══════════════════════════════════
REGRAS DE OURO
═══════════════════════════════════
- NUNCA pergunte algo que já está na FICHA DO LEAD
- NUNCA repita de volta o que a pessoa disse ("Então você trabalhou 3 anos..." ❌)
- NUNCA defina áreas de atuação sem perguntarem
- NUNCA mencione email — confirmação é por WhatsApp
- NUNCA dê parecer jurídico ou opiniões sobre o mérito do caso
- NUNCA invente horários — use SOMENTE os da AGENDA DISPONÍVEL
- Consultas: Seg-Sex, 9h às 18h, presencial (Belém/PA) ou online
- Você atende mensagens 24h, mas consultas são em horário comercial
- Sempre conduza para o agendamento de forma natural, sem pressionar`;

// ===== MONTAR FICHA DO LEAD =====
function buildFichaLead(lead, history, contexto) {
  const linhas = [];

  // === CONTEXTO CRM (se existir) ===
  if (contexto && contexto.tipo === 'cliente') {
    const cl = contexto.cliente;
    const nome = cl.nome_completo || cl.razao_social || '';
    linhas.push(`ATENÇÃO: Esta pessoa JÁ É CLIENTE do escritório!`);
    linhas.push(`- Nome no sistema: ${nome}`);
    linhas.push(`- Tipo: ${cl.tipo || 'PF'} · Status: ${cl.status}`);

    if (contexto.casos.length > 0) {
      linhas.push(`\nCASOS ATIVOS:`);
      contexto.casos.forEach(c => {
        linhas.push(`- ${c.tese} (${c.fase}) ${c.numero_processo ? '· Proc. ' + c.numero_processo : ''}`);
      });
    }

    if (contexto.tarefas.length > 0) {
      linhas.push(`\nTAREFAS PENDENTES DO CLIENTE:`);
      contexto.tarefas.slice(0, 3).forEach(t => {
        linhas.push(`- ${t.descricao} · Prazo: ${t.data_limite || 'sem prazo'}`);
      });
    }

    if (contexto.financeiro.length > 0) {
      const totalPendente = contexto.financeiro.reduce((s, f) => s + (f.valor || 0), 0);
      const atrasados = contexto.financeiro.filter(f => f.status === 'atrasado');
      linhas.push(`\nFINANCEIRO:`);
      linhas.push(`- Total pendente: R$ ${totalPendente.toFixed(2)}`);
      if (atrasados.length > 0) {
        linhas.push(`- ATRASADO: ${atrasados.length} parcela(s) totalizando R$ ${atrasados.reduce((s, f) => s + (f.valor || 0), 0).toFixed(2)}`);
      }
    }

    linhas.push(`\nCOMPORTAMENTO COM CLIENTE:`);
    linhas.push(`- Trate pelo nome que já consta no sistema`);
    linhas.push(`- Não peça dados que já existem (nome, telefone, assunto)`);
    linhas.push(`- Se perguntar sobre seu caso, informe o status geral`);
    linhas.push(`- Se tiver cobrança atrasada, NÃO mencione diretamente. Apenas se o CLIENTE perguntar sobre financeiro, diga gentilmente que existem pendencias e que a equipe pode ajudar`);
    linhas.push(`- Se quiser agendar nova consulta, prossiga normalmente com a agenda`);
    linhas.push(`- Se tiver dúvida sobre o processo, diga que o Dr. Osmar pode atualizar na próxima consulta`);
  } else {
    // Lead normal (não é cliente)
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
  }

  // Verificar se é um retorno (lead já conversou antes)
  if (history && history.length >= 2) {
    const userMsgs = history.filter(m => m.role === 'user');
    if (userMsgs.length >= 2) {
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
  if (contexto && contexto.tipo === 'cliente') {
    linhas.push(`\nPRÓXIMO PASSO: É CLIENTE. Atenda conforme o pedido. Se quiser agendar, ofereça horários. Se perguntar sobre o caso, dê o status geral.`);
  } else {
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
  }

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

  // Se a resposta contém confirmação de agendamento, preservar inteira (até 600 chars)
  const isAgendamento = /agendad[oa]|marcad[oa] para|consulta confirmad/i.test(clean);
  const maxChars = isAgendamento ? 600 : 500;
  const maxSentences = isAgendamento ? 6 : 5;

  // Proteger abreviações em PT-BR
  const protected_ = clean
    .replace(/\b(Dr|Dra|Sr|Sra|Prof|Art|Inc|Ltd|Ltda|nº|tel)\./gi, '$1\u0000')
    .replace(/(\d)\./g, '$1\u0000')
    .replace(/\.{3}/g, '\u0001');

  const sentences = protected_.match(/[^.!?]+[.!?]+/g) || [protected_];
  const restored = sentences.map(s => s.replace(/\u0000/g, '.').replace(/\u0001/g, '...'));

  const result = restored.slice(0, maxSentences).join(' ').trim();
  if (result.length > maxChars) {
    return restored.slice(0, maxSentences - 1).join(' ').trim();
  }
  return result;
}

// ===== HISTÓRICO =====
// Enviar as últimas N mensagens (config.MAX_HISTORY) para manter contexto
// A ficha do lead já contém todos os dados importantes
function buildRecentHistory(history) {
  const recent = history.slice(-(config.MAX_HISTORY || 20));
  return recent.map(m => ({ role: m.role, content: m.content }));
}

// ===== GERAR RESPOSTA =====
async function generateResponse(history, userMessage, conversaId, lead, contexto) {
  // Histórico curto (10 msgs) — a ficha já tem tudo que importa
  const recentHistory = buildRecentHistory(history);

  // Montar ficha do lead (com histórico para detectar retorno + contexto CRM)
  const fichaLead = buildFichaLead(lead, history, contexto);

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

  // Retry: tenta até 2x com backoff antes de desistir
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const response = await anthropic.messages.create({
        model: config.CLAUDE_MODEL,
        max_tokens: config.MAX_TOKENS,
        system: systemPrompt,
        messages: cleanMessages
      });

      return response.content[0].text;
    } catch (e) {
      console.error(`[CLAUDE] Erro (tentativa ${tentativa}/2):`, e.message);
      if (tentativa < 2) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  // Fallback se todas as tentativas falharem
  console.error('[CLAUDE] Todas as tentativas falharam. Usando fallback.');
  const nome = (lead && lead.nome && !lead.nome.startsWith('WhatsApp')) ? lead.nome : '';
  if (nome) {
    return `${nome}, estou com uma instabilidade momentanea. O Dr. Osmar vai receber sua mensagem e te retorna em breve.`;
  }
  return 'Desculpe, estou com uma instabilidade momentanea. O Dr. Osmar vai receber sua mensagem e te retorna em breve.';
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
