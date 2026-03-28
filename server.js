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

Áreas de atuação:
1. IR Isenção - Isenção de IR para portadores de doenças graves (aposentados/pensionistas)
2. Equiparação Hospitalar - Redução tributária para clínicas (IRPJ de 32% para 8%)
3. TEA/Tema 324 - Dedução de despesas com terapias para dependentes com TEA
4. Trabalhista - Verbas rescisórias, horas extras, danos morais

Seu objetivo:
- Qualificar o lead rapidamente com perguntas diretas
- Coletar: nome completo, e-mail
- Sugerir agendamento com Dr. Osmar (Seg-Sex, 9h-18h, Belém/PA, presencial ou online)

Perguntas-chave por tese:
- IR Isenção: É aposentado/pensionista? Qual doença? Paga IR?
- Equiparação: Qual CNAE? Regime tributário? Faturamento mensal?
- TEA: Tem dependente com TEA? Quais terapias? Quanto gasta por mês?

REGRAS DE COMUNICAÇÃO:
- Seja BREVE. Máximo 2-3 frases por mensagem. Nada de textos longos.
- Faça UMA pergunta por vez, não várias de uma só vez.
- Tom simpático mas direto, como um WhatsApp normal.
- Use no máximo 1 emoji por mensagem.
- NÃO repita informações que já disse antes na conversa.
- NÃO dê consultoria jurídica, apenas oriente e qualifique.
- Se perguntarem preço/honorários: "Isso o Dr. Osmar apresenta na consulta."
- Se não souber algo: "O Dr. Osmar pode esclarecer na consulta."
- NUNCA mande mensagens longas. Pense que é WhatsApp, não e-mail.`;

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
async function getHistory(conversaId, limit = 20) {
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

// Gerar resposta com Claude
async function generateResponse(history, userMessage) {
  const messages = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage }
  ];

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages
    });

    return response.content[0].text;
  } catch (e) {
    console.error('[CLAUDE] Erro:', e.message);
    return 'Desculpe, estou com uma dificuldade técnica no momento. Por favor, entre em contato pelo telefone do escritório.';
  }
}

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
    const history = await getHistory(conversa.id);
    const reply = await generateResponse(history, text);
    await saveMessage(conversa.id, 'assistant', reply);
    await sendWhatsApp(phone, reply);

    if (lead && lead.etapa_funil === 'novo') {
      await supabase
        .from('leads')
        .update({ etapa_funil: 'contato', atualizado_em: new Date().toISOString() })
        .eq('id', lead.id);
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
