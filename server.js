require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// ===== CONFIGURAÇÃO =====
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const ZAPI_INSTANCE = process.env.ZAPI_INSTANCE_ID;
const ZAPI_TOKEN = process.env.ZAPI_TOKEN;
const ZAPI_CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN;
const ZAPI_BASE = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}`;

const SYSTEM_PROMPT = `Você é a assistente virtual do escritório Neves Advocacia, do Dr. Osmar Neves, advogado tributarista em Belém/PA.

ÁREAS DE ATUAÇÃO:
1. IR Isenção - Isenção de IR para portadores de doenças graves (aposentados/pensionistas)
2. Equiparação Hospitalar - Redução tributária para clínicas (IRPJ de 32% para 8%)
3. TEA/Tema 324 - Dedução de despesas com terapias para dependentes com TEA
4. Trabalhista - Verbas rescisórias, horas extras, danos morais

SEU OBJETIVO PRINCIPAL: CONVERTER O LEAD EM CONSULTA AGENDADA.
Toda conversa deve caminhar para o agendamento. Você é simpática, mas estratégica.

FLUXO DE CONVERSÃO (siga esta ordem):
1. ACOLHER - Cumprimente, demonstre que entende a dor da pessoa
2. QUALIFICAR - Faça perguntas-chave da tese (UMA por vez)
3. GERAR VALOR - Mostre que o caso tem solução, cite resultados reais
4. CRIAR URGÊNCIA - Use escassez de agenda, prazos legais, ou perda financeira contínua
5. FECHAR - Proponha dia e horário específico para consulta

PERGUNTAS-CHAVE POR TESE:
- IR Isenção: É aposentado/pensionista? Qual doença? Paga IR? Desde quando?
- Equiparação: Qual CNAE? Regime tributário? Faturamento mensal?
- TEA: Tem dependente com TEA? Quais terapias? Quanto gasta por mês?

GATILHOS DE CONVERSÃO (use naturalmente, sem forçar):
- Prova social: "Tivemos um caso muito parecido com o seu recentemente, e o cliente conseguiu recuperar valores significativos."
- Escassez: "A agenda do Dr. Osmar essa semana ainda tem uns horários, mas costuma lotar rápido."
- Perda contínua: "Enquanto não regulariza, você continua pagando imposto que não deveria."
- Prazo legal: "Existe um prazo de 5 anos pra recuperar esses valores, então quanto antes, melhor."
- Autoridade: "O Dr. Osmar é especialista nessa área e já atuou em centenas de casos assim."

QUANDO O LEAD DEMONSTRAR INTERESSE EM AGENDAR:
- Proponha horário específico: "Que tal terça às 14h ou quarta às 10h?"
- Não pergunte "quando você pode?" - OFEREÇA opções
- Confirme: nome, data, horário, se presencial ou online
- Finalize: "Perfeito, {nome}! Consulta confirmada para {dia} às {hora} com o Dr. Osmar. Ele vai analisar seu caso pessoalmente. Qualquer coisa antes disso, pode me chamar aqui!"

DADOS A COLETAR (antes de agendar):
- Nome completo
- E-mail
- Informações da tese (doença/CNAE/dependente conforme o caso)

REGRAS DE COMUNICAÇÃO:
- Seja BREVE. Máximo 2-3 frases por mensagem.
- Faça UMA pergunta por vez.
- Tom simpático, acolhedor, mas com direcionamento comercial sutil.
- Use no máximo 1 emoji por mensagem.
- NÃO repita informações que já disse antes.
- NÃO dê consultoria jurídica. Oriente e qualifique.
- Preço/honorários: "O Dr. Osmar apresenta uma proposta personalizada na consulta, sem compromisso."
- NUNCA mande mensagens longas. É WhatsApp, não e-mail.
- Se o lead estiver indeciso, não pressione, mas reforce o valor: "Entendo, sem pressa. Só pra você ter ideia, muitos dos nossos clientes nessa situação conseguiram [benefício]. Fico aqui se precisar."

HORÁRIO COMERCIAL:
- Consultas/reuniões com Dr. Osmar: Segunda a Sexta, 9h às 18h (horário de Belém).
- Você (assistente) está disponível 24 horas para tirar dúvidas.
- Fora do horário comercial: continue respondendo normalmente, mas ao sugerir agendamento, informe que as reuniões com o Dr. Osmar especialista são dentro do horário comercial (Seg-Sex, 9h-18h).

REGRA CRÍTICA DE MEMÓRIA:
- SEMPRE releia todo o histórico antes de responder.
- NUNCA peça novamente informações que o lead já forneceu.
- Se o lead já disse dia/horário, CONFIRME sem perguntar de novo.
- Trate cada conversa como contínua - você TEM acesso ao histórico completo.`;

// Palavras que indicam lead quente (interesse em agendar/contratar)
const HOT_LEAD_KEYWORDS = [
  'quero agendar', 'quero marcar', 'como faço pra contratar', 'quero contratar',
  'quanto custa', 'qual o valor', 'vamos agendar', 'pode marcar', 'tenho interesse',
  'quero consulta', 'me agenda', 'fecha pra mim', 'vamos fechar', 'pode ser amanhã',
  'pode ser segunda', 'pode ser terça', 'pode ser quarta', 'pode ser quinta', 'pode ser sexta',
  'qual horário', 'horário disponível', 'quero sim', 'vamos lá', 'bora',
  'tô precisando', 'preciso muito', 'urgente', 'me ajuda com isso'
];

// ===== FUNÇÕES AUXILIARES =====

// Limpar número de telefone (formato: 5591999999999)
function cleanPhone(phone) {
  if (!phone) return null;
  let p = phone.replace(/\D/g, '');
  if (p.startsWith('55') && p.length >= 12) return p;
  if (p.length === 11) return '55' + p;
  if (p.length === 10) return '55' + p;
  return p;
}

// Enviar mensagem pelo WhatsApp via Z-API
async function sendWhatsApp(phone, text) {
  try {
    const res = await fetch(`${ZAPI_BASE}/send-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLIENT_TOKEN },
      body: JSON.stringify({ phone: cleanPhone(phone), message: text })
    });
    const json = await res.json();
    console.log('[ZAPI] Mensagem enviada:', phone, json);
    markBotSent(phone);
    return json;
  } catch (e) {
    console.error('[ZAPI] Erro ao enviar:', e.message);
    return null;
  }
}

// Buscar ou criar conversa no Supabase
async function getOrCreateConversa(phone) {
  let { data: conv } = await supabase
    .from('conversas')
    .select('*')
    .eq('telefone', cleanPhone(phone))
    .eq('status', 'ativa')
    .order('criado_em', { ascending: false })
    .limit(1)
    .single();

  if (conv) return conv;

  const { data: newConv } = await supabase
    .from('conversas')
    .insert({ telefone: cleanPhone(phone), titulo: 'WhatsApp' })
    .select()
    .single();

  return newConv;
}

// Buscar ou criar lead pelo telefone
async function getOrCreateLead(phone, nome) {
  const tel = cleanPhone(phone);

  let { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('telefone', tel)
    .limit(1)
    .single();

  if (lead) return lead;

  const { data: newLead } = await supabase
    .from('leads')
    .insert({
      nome: nome || 'WhatsApp ' + tel.slice(-4),
      telefone: tel,
      origem: 'WhatsApp',
      etapa_funil: 'novo',
      data_primeiro_contato: new Date().toISOString()
    })
    .select()
    .single();

  console.log('[LEAD] Novo lead criado:', newLead?.nome);
  return newLead;
}

// Buscar histórico de mensagens da conversa
async function getHistory(conversaId, limit = 50) {
  const { data: msgs } = await supabase
    .from('mensagens')
    .select('role, content')
    .eq('conversa_id', conversaId)
    .order('criado_em', { ascending: true })
    .limit(limit);

  return msgs || [];
}

// Salvar mensagem no Supabase
async function saveMessage(conversaId, role, content) {
  await supabase
    .from('mensagens')
    .insert({ conversa_id: conversaId, role, content });
}

// Resumir conversas longas para manter contexto sem estourar tokens
function buildSmartHistory(history) {
  // Se a conversa é curta, envia tudo
  if (history.length <= 20) {
    return history.map(m => ({ role: m.role, content: m.content }));
  }

  // Conversa longa: extrai dados importantes das mensagens antigas
  const oldMsgs = history.slice(0, -16);
  const recentMsgs = history.slice(-16);

  // Coleta informações-chave mencionadas nas mensagens antigas
  const allOldText = oldMsgs.map(m => `[${m.role}]: ${m.content}`).join('\n');

  const summaryMsg = {
    role: 'user',
    content: `[CONTEXTO DA CONVERSA ANTERIOR - Lembre-se destas informações]\n${allOldText}\n[FIM DO CONTEXTO - Continue a conversa normalmente sem repetir o que já foi dito]`
  };

  // Garantir que a sequência comece com 'user' (regra da API)
  const recent = recentMsgs.map(m => ({ role: m.role, content: m.content }));

  // Se o resumo vai como 'user' e a primeira mensagem recente também é 'user',
  // precisamos intercalar com uma resposta do assistant
  if (recent.length > 0 && recent[0].role === 'user') {
    return [summaryMsg, { role: 'assistant', content: 'Entendido, tenho todas as informações da conversa anterior.' }, ...recent];
  }

  return [summaryMsg, ...recent];
}

// Gerar resposta com Claude
async function generateResponse(history, userMessage) {
  const smartHistory = buildSmartHistory(history);
  const messages = [
    ...smartHistory,
    { role: 'user', content: userMessage }
  ];

  // Garantir alternância correta de roles (user/assistant)
  const cleanMessages = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const prev = cleanMessages[cleanMessages.length - 1];
    // Pular se mesmo role consecutivo (exceto o primeiro)
    if (prev && prev.role === msg.role) {
      prev.content += '\n' + msg.content;
    } else {
      cleanMessages.push({ ...msg });
    }
  }

  // Garantir que começa com 'user'
  if (cleanMessages.length > 0 && cleanMessages[0].role !== 'user') {
    cleanMessages.unshift({ role: 'user', content: 'Olá' });
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: cleanMessages
    });

    return response.content[0].text;
  } catch (e) {
    console.error('[CLAUDE] Erro:', e.message);
    return 'Desculpe, estou com uma dificuldade técnica no momento. Por favor, entre em contato pelo telefone do escritório.';
  }
}

// ===== DETECÇÃO DE LEAD QUENTE =====
function isHotLead(text) {
  const lower = text.toLowerCase();
  return HOT_LEAD_KEYWORDS.some(kw => lower.includes(kw));
}

// Notificar Dr. Osmar via WhatsApp quando lead está quente
async function notifyHotLead(leadName, phone, trigger) {
  const osmarPhone = process.env.OSMAR_PHONE || '5591981018757';
  const msg = `🔥 LEAD QUENTE!\n\n${leadName} (${phone}) demonstrou interesse alto.\n\nFrase: "${trigger}"\n\nResponda rápido ou a IA continua o atendimento.`;
  try {
    await fetch(`${ZAPI_BASE}/send-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLIENT_TOKEN },
      body: JSON.stringify({ phone: osmarPhone, message: msg })
    });
    console.log(`[HOT] Notificação enviada para Dr. Osmar sobre ${leadName}`);
  } catch (e) {
    console.error('[HOT] Erro ao notificar:', e.message);
  }
}

// Atualizar lead como quente no Supabase
async function markLeadHot(leadId) {
  await supabase
    .from('leads')
    .update({
      etapa_funil: 'proposta',
      atualizado_em: new Date().toISOString()
    })
    .eq('id', leadId);
}

// ===== MÉTRICAS DE CONVERSÃO =====
async function trackEvent(conversaId, leadId, evento, detalhes) {
  try {
    await supabase.from('metricas').insert({
      conversa_id: conversaId,
      lead_id: leadId,
      evento,
      detalhes,
      criado_em: new Date().toISOString()
    });
  } catch (e) {
    // Tabela pode não existir ainda, só loga
    console.log(`[METRIC] ${evento}: ${detalhes || ''}`);
  }
}

// ===== FOLLOW-UP AUTOMÁTICO =====
// Verifica leads que pararam de responder e envia follow-up
async function checkFollowUps() {
  try {
    // Buscar conversas ativas que não tiveram mensagem do lead nas últimas 24h
    const { data: conversas } = await supabase
      .from('conversas')
      .select('*, leads(id, nome, tese_interesse, etapa_funil, telefone)')
      .eq('status', 'ativa')
      .not('lead_id', 'is', null);

    if (!conversas || conversas.length === 0) return;

    const now = Date.now();

    for (const conv of conversas) {
      // Pular leads já convertidos ou perdidos
      if (!conv.leads || conv.leads.etapa_funil === 'convertido' || conv.leads.etapa_funil === 'perdido') continue;

      // Buscar última mensagem
      const { data: lastMsgs } = await supabase
        .from('mensagens')
        .select('role, criado_em')
        .eq('conversa_id', conv.id)
        .order('criado_em', { ascending: false })
        .limit(3);

      if (!lastMsgs || lastMsgs.length === 0) continue;

      const lastMsg = lastMsgs[0];
      const lastTime = new Date(lastMsg.criado_em).getTime();
      const hoursAgo = (now - lastTime) / (1000 * 60 * 60);

      // Se a última mensagem foi da IA (lead não respondeu) e já passaram 24-48h
      if (lastMsg.role === 'assistant' && hoursAgo >= 24 && hoursAgo < 48) {
        // Verificar se já mandou follow-up (olhando se as últimas 2 msgs são da IA)
        const lastTwoAssistant = lastMsgs.filter(m => m.role === 'assistant');
        if (lastTwoAssistant.length >= 2) continue; // Já mandou follow-up

        const nome = conv.leads.nome || 'amigo(a)';
        const tese = conv.leads.tese_interesse || 'sua questão jurídica';
        const followUp1 = `Olá, ${nome}! Tudo bem? 😊 Passando aqui porque vi que ficou alguma dúvida sobre ${tese}. O Dr. Osmar ainda tem horários essa semana. Posso te ajudar com algo mais?`;

        console.log(`[FOLLOWUP-24h] Enviando para ${conv.telefone} (${nome})`);
        await saveMessage(conv.id, 'assistant', followUp1);
        await sendWhatsApp(conv.telefone, followUp1);
        await trackEvent(conv.id, conv.leads.id, 'followup_24h', nome);
      }

      // Follow-up de 72h (último esforço)
      if (lastMsg.role === 'assistant' && hoursAgo >= 72 && hoursAgo < 96) {
        const lastTwoAssistant = lastMsgs.filter(m => m.role === 'assistant');
        if (lastTwoAssistant.length >= 3) continue; // Já mandou os 2 follow-ups

        const nome = conv.leads.nome || 'amigo(a)';
        const tese = conv.leads.tese_interesse;
        let followUp2 = '';

        if (tese === 'IR Isenção') {
          followUp2 = `${nome}, só pra lembrar: enquanto não entra com o pedido, o imposto continua sendo descontado todo mês. Se quiser, o Dr. Osmar pode fazer uma análise rápida do seu caso, sem compromisso. É só me chamar! 🙏`;
        } else if (tese === 'Equiparação Hospitalar') {
          followUp2 = `${nome}, sua clínica pode estar pagando até 4x mais imposto do que deveria. O Dr. Osmar pode avaliar isso em uma consulta rápida, sem compromisso. Me avisa se tiver interesse! 🙏`;
        } else if (tese === 'TEA/Tema 324') {
          followUp2 = `${nome}, lembrete: as despesas com terapias do seu dependente podem ser deduzidas no IR. O Dr. Osmar pode analisar quanto você pode recuperar. Sem compromisso! Me chama quando puder 🙏`;
        } else {
          followUp2 = `${nome}, caso mude de ideia, estamos à disposição. O Dr. Osmar pode fazer uma análise inicial do seu caso sem compromisso. É só me chamar aqui! 🙏`;
        }

        console.log(`[FOLLOWUP-72h] Enviando para ${conv.telefone} (${nome})`);
        await saveMessage(conv.id, 'assistant', followUp2);
        await sendWhatsApp(conv.telefone, followUp2);
        await trackEvent(conv.id, conv.leads.id, 'followup_72h', nome);
      }
    }
  } catch (e) {
    console.error('[FOLLOWUP] Erro:', e.message);
  }
}

// Rodar check de follow-up a cada 2 horas (entre 8h e 20h horário de Belém)
setInterval(() => {
  const belemHour = new Date().toLocaleString('en-US', { timeZone: 'America/Belem', hour: 'numeric', hour12: false });
  const hour = parseInt(belemHour);
  if (hour >= 8 && hour <= 20) {
    console.log('[FOLLOWUP] Verificando leads para follow-up...');
    checkFollowUps();
  }
}, 2 * 60 * 60 * 1000); // a cada 2 horas

// Rodar uma vez ao iniciar (após 60 segundos para dar tempo de conectar tudo)
setTimeout(() => checkFollowUps(), 60 * 1000);

// ===== CONTROLE DE DUPLICATAS E PAUSA =====
const processedMessages = new Set();
const pausedConversas = new Map(); // telefone -> timestamp da pausa
const recentBotSends = new Map(); // telefone -> timestamp do último envio da IA

// Limpar mensagens processadas a cada 10 minutos (evitar vazamento de memória)
setInterval(() => { processedMessages.clear(); }, 10 * 60 * 1000);

// Registrar que a IA acabou de enviar mensagem para este telefone
function markBotSent(phone) {
  recentBotSends.set(cleanPhone(phone), Date.now());
}

// Verificar se a IA enviou mensagem para este telefone nos últimos 30 segundos
function wasBotRecentSend(phone) {
  const ts = recentBotSends.get(cleanPhone(phone));
  if (!ts) return false;
  return (Date.now() - ts) < 30000; // 30 segundos
}

// Pausar IA para um telefone por X minutos (quando Dr. Osmar responde manualmente)
function pauseAI(phone, minutes = 30) {
  pausedConversas.set(cleanPhone(phone), Date.now() + minutes * 60 * 1000);
  console.log(`[PAUSE] IA pausada para ${phone} por ${minutes} min`);
}

function isAIPaused(phone) {
  const until = pausedConversas.get(cleanPhone(phone));
  if (!until) return false;
  if (Date.now() > until) {
    pausedConversas.delete(cleanPhone(phone));
    return false;
  }
  return true;
}

// ===== WEBHOOK Z-API (recebe mensagens do WhatsApp) =====
app.post('/webhook/zapi', async (req, res) => {
  try {
    const body = req.body;

    // Extrair ID da mensagem para evitar duplicatas
    const messageId = body.messageId || body.ids?.[0]?.serialized || body.id?.id || '';

    // Só processar mensagens de texto recebidas
    const isMessage = body.type === 'ReceivedCallback' || body.text?.message;
    const isFromMe = body.fromMe || body.isFromMe;

    // Se é mensagem ENVIADA por mim, verificar se foi a IA ou o Dr. Osmar
    if (isFromMe) {
      const phone = body.phone || body.to?.replace('@c.us', '') || '';
      if (phone && wasBotRecentSend(phone)) {
        // Foi a IA que enviou - ignorar
        console.log(`[BOT] Mensagem da IA detectada para ${phone} - ignorando`);
        return res.json({ status: 'bot_sent' });
      }
      if (phone) {
        // Foi o Dr. Osmar manualmente - pausar IA
        pauseAI(phone, 30);
        console.log(`[MANUAL] Dr. Osmar respondeu para ${phone} - IA pausada 30min`);
      }
      return res.json({ status: 'manual_detected' });
    }

    if (!isMessage) {
      return res.json({ status: 'ignored' });
    }

    // Evitar processar a mesma mensagem duas vezes
    if (messageId && processedMessages.has(messageId)) {
      console.log(`[DUP] Mensagem duplicada ignorada: ${messageId}`);
      return res.json({ status: 'duplicate' });
    }
    if (messageId) processedMessages.add(messageId);

    const phone = body.phone || body.from?.replace('@c.us', '') || '';
    const text = body.text?.message || body.body || '';
    const senderName = body.senderName || body.notifyName || '';

    if (!phone || !text) {
      return res.json({ status: 'no_content' });
    }

    // Verificar se IA está pausada para este telefone
    if (isAIPaused(phone)) {
      console.log(`[PAUSE] Mensagem de ${phone} ignorada - IA pausada (Dr. Osmar respondendo)`);
      // Ainda salva a mensagem no banco, mas não responde
      const conversa = await getOrCreateConversa(phone);
      await saveMessage(conversa.id, 'user', text);
      return res.json({ status: 'paused' });
    }

    console.log(`[MSG] De: ${phone} (${senderName}): ${text}`);

    const lead = await getOrCreateLead(phone, senderName);
    const conversa = await getOrCreateConversa(phone);

    if (lead && conversa && !conversa.lead_id) {
      await supabase
        .from('conversas')
        .update({ lead_id: lead.id, titulo: senderName || conversa.titulo })
        .eq('id', conversa.id);
    }

    await saveMessage(conversa.id, 'user', text);

    // Detectar se lead está quente
    if (lead && isHotLead(text)) {
      console.log(`[HOT] Lead quente detectado: ${senderName} - "${text.slice(0, 60)}"`);
      await markLeadHot(lead.id);
      await notifyHotLead(senderName || lead.nome, phone, text.slice(0, 100));
      await trackEvent(conversa.id, lead.id, 'lead_quente', text.slice(0, 100));
    }

    const history = await getHistory(conversa.id);
    const reply = await generateResponse(history, text);
    await saveMessage(conversa.id, 'assistant', reply);
    await sendWhatsApp(phone, reply);

    // Atualizar etapa do lead
    if (lead && lead.etapa_funil === 'novo') {
      await supabase
        .from('leads')
        .update({ etapa_funil: 'contato', atualizado_em: new Date().toISOString() })
        .eq('id', lead.id);
    }

    // Rastrear primeira resposta
    if (history.length <= 1) {
      await trackEvent(conversa.id, lead?.id, 'primeiro_contato', senderName);
    }

    console.log(`[REPLY] Para: ${phone}: ${reply.slice(0, 100)}...`);
    res.json({ status: 'ok', reply: reply.slice(0, 50) });

  } catch (e) {
    console.error('[WEBHOOK] Erro:', e);
    res.status(500).json({ error: e.message });
  }
});

// Pausar/retomar IA manualmente pelo CRM
app.post('/api/pausar', (req, res) => {
  const { phone, minutes } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone obrigatório' });
  pauseAI(phone, minutes || 30);
  res.json({ ok: true, msg: `IA pausada para ${phone} por ${minutes || 30} minutos` });
});

app.post('/api/retomar', (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone obrigatório' });
  pausedConversas.delete(cleanPhone(phone));
  console.log(`[RESUME] IA retomada para ${phone}`);
  res.json({ ok: true, msg: `IA retomada para ${phone}` });
});

// ===== API PARA O CRM (frontend) =====

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    services: {
      claude: !!process.env.ANTHROPIC_API_KEY,
      zapi: !!ZAPI_INSTANCE,
      supabase: !!process.env.SUPABASE_URL
    }
  });
});

// Testar conexão Z-API
app.get('/api/test/zapi', async (req, res) => {
  try {
    const r = await fetch(`${ZAPI_BASE}/status`, { headers: { 'Client-Token': ZAPI_CLIENT_TOKEN } });
    const json = await r.json();
    res.json(json);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Testar conexão Claude
app.get('/api/test/claude', async (req, res) => {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 20,
      messages: [{ role: 'user', content: 'Diga apenas: OK' }]
    });
    res.json({ ok: true, response: response.content[0].text });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Listar conversas recentes
app.get('/api/conversas', async (req, res) => {
  const { data } = await supabase
    .from('conversas')
    .select('*, leads(nome, tese_interesse, etapa_funil)')
    .order('criado_em', { ascending: false })
    .limit(50);
  res.json(data || []);
});

// Buscar mensagens de uma conversa
app.get('/api/conversas/:id/mensagens', async (req, res) => {
  const { data } = await supabase
    .from('mensagens')
    .select('*')
    .eq('conversa_id', req.params.id)
    .order('criado_em', { ascending: true });
  res.json(data || []);
});

// Enviar mensagem manual pelo CRM
app.post('/api/enviar', async (req, res) => {
  const { phone, message, conversaId } = req.body;
  if (!phone || !message) return res.status(400).json({ error: 'phone e message obrigatórios' });

  if (conversaId) {
    await saveMessage(conversaId, 'assistant', message);
  }

  const result = await sendWhatsApp(phone, message);
  res.json({ ok: true, result });
});

// Métricas de conversão
app.get('/api/metricas', async (req, res) => {
  try {
    // Total de leads por etapa
    const { data: leads } = await supabase.from('leads').select('etapa_funil, criado_em');
    const etapas = { novo: 0, contato: 0, proposta: 0, convertido: 0, perdido: 0 };
    (leads || []).forEach(l => { if (etapas[l.etapa_funil] !== undefined) etapas[l.etapa_funil]++; });

    // Conversas ativas
    const { data: conversas } = await supabase.from('conversas').select('id, criado_em').eq('status', 'ativa');

    // Métricas de eventos (se tabela existir)
    let eventos = [];
    try {
      const { data } = await supabase.from('metricas').select('evento, criado_em').order('criado_em', { ascending: false }).limit(100);
      eventos = data || [];
    } catch {}

    const followups24 = eventos.filter(e => e.evento === 'followup_24h').length;
    const followups72 = eventos.filter(e => e.evento === 'followup_72h').length;
    const leadsQuentes = eventos.filter(e => e.evento === 'lead_quente').length;

    res.json({
      leads_por_etapa: etapas,
      total_leads: (leads || []).length,
      conversas_ativas: (conversas || []).length,
      followups_24h: followups24,
      followups_72h: followups72,
      leads_quentes: leadsQuentes,
      taxa_conversao: (leads || []).length > 0
        ? ((etapas.convertido / (leads || []).length) * 100).toFixed(1) + '%'
        : '0%'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== INICIAR SERVIDOR =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('');
  console.log('CRM Neves Advocacia - Servidor');
  console.log(`Rodando em http://localhost:${PORT}`);
  console.log(`Claude: ${process.env.ANTHROPIC_API_KEY ? 'OK' : 'Faltando'}`);
  console.log(`Z-API: ${ZAPI_INSTANCE ? 'OK' : 'Faltando'}`);
  console.log(`Supabase: ${process.env.SUPABASE_URL ? 'OK' : 'Faltando'}`);
  console.log('');
  console.log(`Webhook Z-API: POST ${process.env.RENDER_EXTERNAL_URL || 'http://localhost:' + PORT}/webhook/zapi`);
  console.log('');
});
