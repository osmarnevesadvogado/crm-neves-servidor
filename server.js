// ===== CRM NEVES ADVOCACIA - SERVIDOR =====
// Arquivo principal: rotas, webhook, segurança
// Módulos: config, whatsapp, database, ia, fluxo

const express = require('express');
const cors = require('cors');
const config = require('./config');
const whatsapp = require('./whatsapp');
const db = require('./database');
const ia = require('./ia');
const fluxo = require('./fluxo');
let calendar;
try { calendar = require('./calendar'); } catch (e) { console.log('[INIT] Calendar não disponível'); }

const app = express();
app.use(cors());
app.use(express.json());

// ===== BUFFER DE MENSAGENS =====
const messageBuffer = new Map();

function bufferMessage(phone, text, senderName) {
  const cleanP = whatsapp.cleanPhone(phone);
  const existing = messageBuffer.get(cleanP);

  if (existing) {
    existing.messages.push(text);
    existing.senderName = senderName || existing.senderName;
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => flushBuffer(cleanP), config.BUFFER_DELAY);
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const entry = {
      messages: [text],
      senderName: senderName || '',
      timer: setTimeout(() => flushBuffer(cleanP), config.BUFFER_DELAY),
      resolve
    };
    messageBuffer.set(cleanP, entry);
  });
}

function flushBuffer(cleanP) {
  const entry = messageBuffer.get(cleanP);
  if (!entry) return;
  messageBuffer.delete(cleanP);
  entry.resolve({
    combined: entry.messages.join('\n'),
    senderName: entry.senderName
  });
}

// ===== CONTROLE DE PAUSA =====
const pausedConversas = new Map();
const processedMessages = new Set();

function pauseAI(phone, minutes = 30) {
  pausedConversas.set(whatsapp.cleanPhone(phone), Date.now() + minutes * 60 * 1000);
  console.log(`[PAUSE] IA pausada para ${phone} por ${minutes} min`);
}

function isAIPaused(phone) {
  const until = pausedConversas.get(whatsapp.cleanPhone(phone));
  if (!until) return false;
  if (Date.now() > until) {
    pausedConversas.delete(whatsapp.cleanPhone(phone));
    return false;
  }
  return true;
}

// ===== LIMPEZA PERIÓDICA =====
setInterval(() => {
  processedMessages.clear();
  whatsapp.cleanup();
  fluxo.cleanup();
  const now = Date.now();
  for (const [phone, until] of pausedConversas) {
    if (now > until) pausedConversas.delete(phone);
  }
}, 10 * 60 * 1000);

// ===== RATE LIMIT =====
const rateLimitMap = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, resetAt: now + 60000 };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + 60000;
  }
  entry.count++;
  rateLimitMap.set(ip, entry);
  return entry.count <= config.RATE_LIMIT_MAX;
}
setInterval(() => { rateLimitMap.clear(); }, 5 * 60 * 1000);

// ===== PROCESSAMENTO ASSÍNCRONO =====
async function processBufferedMessage(phone, text, senderName) {
  try {
    const result = await bufferMessage(phone, text, senderName);
    if (!result) return; // Mensagem acumulada em buffer existente

    const combinedText = result.combined;
    const finalName = result.senderName;

    console.log(`[BUFFER] Processando ${combinedText.split('\n').length} msg(s) de ${phone}`);

    const lead = await db.getOrCreateLead(phone, finalName);
    const conversa = await db.getOrCreateConversa(phone);

    // Vincular lead à conversa
    if (lead && conversa && !conversa.lead_id) {
      await db.updateConversa(conversa.id, { lead_id: lead.id, titulo: finalName || conversa.titulo });
    }

    // Salvar mensagem
    await db.saveMessage(conversa.id, 'user', combinedText);

    // Extrair dados do lead (nome, email, tese)
    if (lead) {
      await db.extractAndUpdateLead(lead.id, combinedText);
    }

    // Processar etapa do fluxo de conversa
    // Carregar etapa salva se existir
    if (conversa.etapa_conversa) {
      fluxo.setEtapa(conversa.id, conversa.etapa_conversa);
    }
    const etapaAntes = fluxo.getEtapa(conversa.id);

    // Buscar lead atualizado (com dados recém-extraídos)
    const leadAtualizado = await db.getOrCreateLead(phone, finalName);
    const etapaDepois = fluxo.processarEtapa(conversa.id, combinedText, leadAtualizado);

    // Persistir etapa no banco se mudou
    if (etapaAntes !== etapaDepois) {
      await db.updateConversa(conversa.id, { etapa_conversa: etapaDepois });
      await db.trackEvent(conversa.id, lead?.id, 'etapa_avancou', `${etapaAntes} → ${etapaDepois}`);

      // Se avançou para pós-agendamento, tentar criar evento no Google Calendar
      if (etapaDepois === 'pos_agendamento' && calendar) {
        try {
          const slot = await calendar.encontrarSlot(combinedText);
          if (slot && leadAtualizado) {
            const evento = await calendar.criarConsulta(
              leadAtualizado.nome || finalName || 'Lead',
              phone,
              leadAtualizado.email || '',
              slot.inicio,
              combinedText.toLowerCase().includes('presencial') ? 'presencial' : 'online'
            );
            if (evento) {
              await db.trackEvent(conversa.id, lead?.id, 'consulta_agendada', evento.inicio);
              await db.updateLead(lead.id, { etapa_funil: 'convertido' });
              console.log(`[CALENDAR] Consulta agendada: ${evento.inicio}`);
            }
          }
        } catch (e) {
          console.error('[CALENDAR] Erro ao agendar:', e.message);
        }
      }
    }

    // Detectar lead quente
    if (lead && isHotLead(combinedText)) {
      console.log(`[HOT] Lead quente: ${finalName}`);
      await db.markLeadHot(lead.id);
      await whatsapp.notifyHotLead(finalName || lead.nome, phone, combinedText.slice(0, 100));
      await db.trackEvent(conversa.id, lead.id, 'lead_quente', combinedText.slice(0, 100));
    }

    // Gerar e enviar resposta
    const history = await db.getHistory(conversa.id);
    const rawReply = await ia.generateResponse(history, combinedText, conversa.id);
    const reply = ia.trimResponse(rawReply);
    await db.saveMessage(conversa.id, 'assistant', reply);
    await whatsapp.sendText(phone, reply);

    // Atualizar etapa do funil
    if (lead && lead.etapa_funil === 'novo') {
      await db.updateLead(lead.id, { etapa_funil: 'contato' });
    }

    // Métrica de primeiro contato
    if (history.length <= 1) {
      await db.trackEvent(conversa.id, lead?.id, 'primeiro_contato', senderName);
    }

    console.log(`[REPLY] Para ${phone}: ${reply.slice(0, 80)}...`);
  } catch (e) {
    console.error('[PROCESS] Erro:', e.message);
  }
}

function isHotLead(text) {
  const lower = text.toLowerCase();
  return config.HOT_LEAD_KEYWORDS.some(kw => lower.includes(kw));
}

// ===== FOLLOW-UP AUTOMÁTICO =====
async function checkFollowUps() {
  try {
    const eligible = await db.getEligibleConversas();
    if (eligible.length === 0) return;

    const conversaIds = eligible.map(c => c.id);
    const allMsgs = await db.getRecentMessages(conversaIds, 3);

    const msgsByConv = {};
    for (const msg of allMsgs) {
      if (!msgsByConv[msg.conversa_id]) msgsByConv[msg.conversa_id] = [];
      if (msgsByConv[msg.conversa_id].length < 3) {
        msgsByConv[msg.conversa_id].push(msg);
      }
    }

    const now = Date.now();

    for (const conv of eligible) {
      const lastMsgs = msgsByConv[conv.id];
      if (!lastMsgs || lastMsgs.length === 0) continue;

      const lastMsg = lastMsgs[0];
      const hoursAgo = (now - new Date(lastMsg.criado_em).getTime()) / (1000 * 60 * 60);

      // Follow-up 24h
      if (lastMsg.role === 'assistant' && hoursAgo >= 24 && hoursAgo < 48) {
        if (lastMsgs.filter(m => m.role === 'assistant').length >= 2) continue;

        const nome = conv.leads.nome || 'amigo(a)';
        const tese = conv.leads.tese_interesse || 'sua questão jurídica';
        const msg = `Olá, ${nome}! Tudo bem? Passando aqui sobre ${tese}. O Dr. Osmar ainda tem horários essa semana, posso te ajudar?`;

        console.log(`[FOLLOWUP-24h] ${conv.telefone} (${nome})`);
        await db.saveMessage(conv.id, 'assistant', msg);
        await whatsapp.sendText(conv.telefone, msg);
        await db.trackEvent(conv.id, conv.leads.id, 'followup_24h', nome);
      }

      // Follow-up 72h
      if (lastMsg.role === 'assistant' && hoursAgo >= 72 && hoursAgo < 96) {
        if (lastMsgs.filter(m => m.role === 'assistant').length >= 3) continue;

        const nome = conv.leads.nome || 'amigo(a)';
        const tese = conv.leads.tese_interesse;
        let msg = '';

        if (tese === 'IR Isenção')
          msg = `${nome}, enquanto não entra com o pedido, o imposto continua sendo descontado. O Dr. Osmar pode analisar sem compromisso, é só me chamar!`;
        else if (tese === 'Equiparação Hospitalar')
          msg = `${nome}, sua clínica pode estar pagando até 4x mais imposto. O Dr. Osmar avalia sem compromisso, me avisa se tiver interesse!`;
        else if (tese === 'TEA/Tema 324')
          msg = `${nome}, os gastos com seu dependente podem ser deduzidos no IR. O Dr. Osmar pode ver quanto dá pra recuperar, me chama quando puder!`;
        else
          msg = `${nome}, caso mude de ideia, estamos à disposição. O Dr. Osmar pode fazer uma análise inicial sem compromisso!`;

        console.log(`[FOLLOWUP-72h] ${conv.telefone} (${nome})`);
        await db.saveMessage(conv.id, 'assistant', msg);
        await whatsapp.sendText(conv.telefone, msg);
        await db.trackEvent(conv.id, conv.leads.id, 'followup_72h', nome);
      }
    }
  } catch (e) {
    console.error('[FOLLOWUP] Erro:', e.message);
  }
}

// Agendar follow-ups (8h-20h Belém, a cada 2 horas)
setInterval(() => {
  const belemHour = new Date().toLocaleString('en-US', { timeZone: 'America/Belem', hour: 'numeric', hour12: false });
  if (parseInt(belemHour) >= 8 && parseInt(belemHour) <= 20) {
    console.log('[FOLLOWUP] Verificando...');
    checkFollowUps();
  }
}, 2 * 60 * 60 * 1000);
setTimeout(() => checkFollowUps(), 60 * 1000);

// ===== WEBHOOK Z-API =====
app.post('/webhook/zapi', async (req, res) => {
  try {
    // Rate limit
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (!checkRateLimit(clientIp)) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    // Validar token (se configurado)
    if (config.ZAPI_WEBHOOK_TOKEN) {
      const received = req.headers['x-api-key'] || req.headers['authorization'] || req.query.token;
      if (received !== config.ZAPI_WEBHOOK_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const body = req.body;
    const messageId = body.messageId || body.ids?.[0]?.serialized || body.id?.id || '';
    const isMessage = body.type === 'ReceivedCallback' || body.text?.message;
    const isFromMe = body.fromMe || body.isFromMe;

    // Mensagem enviada: detectar se foi IA ou Dr. Osmar
    if (isFromMe) {
      const phone = body.phone || body.to?.replace('@c.us', '') || '';
      if (phone && whatsapp.wasBotRecentSend(phone)) {
        return res.json({ status: 'bot_sent' });
      }
      if (phone) {
        pauseAI(phone, 30);
        console.log(`[MANUAL] Dr. Osmar respondeu para ${phone} - IA pausada 30min`);
      }
      return res.json({ status: 'manual_detected' });
    }

    if (!isMessage) return res.json({ status: 'ignored' });

    // Deduplicação
    if (messageId && processedMessages.has(messageId)) {
      return res.json({ status: 'duplicate' });
    }
    if (messageId) processedMessages.add(messageId);

    const phone = body.phone || body.from?.replace('@c.us', '') || '';
    const text = body.text?.message || body.body || '';
    const senderName = body.senderName || body.notifyName || '';

    if (!phone || !text) return res.json({ status: 'no_content' });

    // IA pausada: salvar mas não responder
    if (isAIPaused(phone)) {
      console.log(`[PAUSE] Msg de ${phone} salva - IA pausada`);
      try {
        const conversa = await db.getOrCreateConversa(phone);
        await db.saveMessage(conversa.id, 'user', text);
      } catch (e) {
        console.error('[PAUSE] Erro ao salvar:', e.message);
      }
      return res.json({ status: 'paused' });
    }

    console.log(`[MSG] De: ${phone} (${senderName}): ${text.slice(0, 80)}`);

    // Responder ao webhook imediatamente
    res.json({ status: 'buffered' });

    // Processar assincronamente
    processBufferedMessage(phone, text, senderName).catch(err => {
      console.error('[ASYNC] Erro:', err.message);
    });

  } catch (e) {
    console.error('[WEBHOOK] Erro:', e);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message });
    }
  }
});

// ===== ROTAS DO CRM =====

app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    services: {
      claude: !!config.ANTHROPIC_API_KEY,
      zapi: !!config.ZAPI_INSTANCE,
      supabase: !!config.SUPABASE_URL,
      calendar: !!calendar
    }
  });
});

app.get('/api/test/zapi', async (req, res) => {
  try {
    const r = await fetch(`${config.ZAPI_BASE}/status`, { headers: { 'Client-Token': config.ZAPI_CLIENT_TOKEN } });
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/test/calendar', async (req, res) => {
  try {
    if (!calendar) return res.status(500).json({ ok: false, error: 'Módulo calendar não carregado' });
    const slots = await calendar.getHorariosDisponiveis(3);
    const sugestao = await calendar.sugerirHorarios(2);
    res.json({
      ok: true,
      slotsDisponiveis: slots.length,
      proximosHorarios: slots.slice(0, 5).map(s => s.label),
      sugestaoAna: sugestao.texto
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/test/claude', async (req, res) => {
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: config.CLAUDE_MODEL,
      max_tokens: 20,
      messages: [{ role: 'user', content: 'Diga apenas: OK' }]
    });
    res.json({ ok: true, response: response.content[0].text });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/conversas', async (req, res) => {
  try {
    res.json(await db.listConversas());
  } catch (e) {
    res.status(500).json({ error: 'Erro ao buscar conversas' });
  }
});

app.get('/api/conversas/:id/mensagens', async (req, res) => {
  try {
    res.json(await db.getConversaMensagens(req.params.id));
  } catch (e) {
    res.status(500).json({ error: 'Erro ao buscar mensagens' });
  }
});

app.post('/api/enviar', async (req, res) => {
  try {
    const { phone, message, conversaId } = req.body;
    if (!phone || !message) return res.status(400).json({ error: 'phone e message obrigatórios' });
    if (conversaId) await db.saveMessage(conversaId, 'assistant', message);
    const result = await whatsapp.sendText(phone, message);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao enviar' });
  }
});

app.post('/api/pausar', (req, res) => {
  const { phone, minutes } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone obrigatório' });
  pauseAI(phone, minutes || 30);
  res.json({ ok: true, msg: `IA pausada para ${phone} por ${minutes || 30} minutos` });
});

app.post('/api/retomar', (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone obrigatório' });
  pausedConversas.delete(whatsapp.cleanPhone(phone));
  res.json({ ok: true, msg: `IA retomada para ${phone}` });
});

app.get('/api/metricas', async (req, res) => {
  try {
    res.json(await db.getMetricas());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== INICIAR =====
app.listen(config.PORT, () => {
  console.log('');
  console.log('CRM Neves Advocacia - Servidor v2');
  console.log(`Rodando em http://localhost:${config.PORT}`);
  console.log(`Claude: ${config.ANTHROPIC_API_KEY ? 'OK' : 'Faltando'}`);
  console.log(`Z-API: ${config.ZAPI_INSTANCE ? 'OK' : 'Faltando'}`);
  console.log(`Supabase: ${config.SUPABASE_URL ? 'OK' : 'Faltando'}`);
  console.log(`Calendar: ${calendar ? 'OK' : 'Não configurado'}`);
  console.log(`Webhook: POST ${config.RENDER_URL || 'http://localhost:' + config.PORT}/webhook/zapi`);
  console.log('');
});
