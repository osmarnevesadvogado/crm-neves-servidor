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

const SYSTEM_PROMPT = `Você é a Ana, atendente da Neves Advocacia (Dr. Osmar Neves, tributarista, Belém/PA). Você conversa por WhatsApp igual uma pessoa real.

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

// Cortar mensagens longas - garante brevidade independente do modelo
function trimResponse(text) {
  // Remover bullet points e listas
  let clean = text.replace(/^[\s]*[-•·*]\s*/gm, '').replace(/^[\s]*\d+[.)]\s*/gm, '');
  // Remover linhas vazias extras e emojis sozinhos em linha
  clean = clean.replace(/\n{2,}/g, '\n').trim();

  // Proteger abreviações e valores antes de separar frases
  // Substituir pontos que NÃO são fim de frase por placeholder
  const protected_ = clean
    .replace(/\b(Dr|Dra|Sr|Sra|Prof|Art|Inc|Ltd|Ltda|nº|tel)\./gi, '$1\u0000')  // abreviações
    .replace(/(\d)\./g, '$1\u0000')  // números decimais (R$1.000, 14.5)
    .replace(/\.{3}/g, '\u0001');     // reticências → placeholder único

  // Separar em frases pelo ponto/!/? real
  const sentences = protected_.match(/[^.!?]+[.!?]+/g) || [protected_];

  // Restaurar pontos protegidos
  const restored = sentences.map(s => s.replace(/\u0000/g, '.').replace(/\u0001/g, '...'));

  // Pegar no máximo 3 frases
  const result = restored.slice(0, 3).join(' ').trim();
  // Se ainda ficou muito longo (mais de 300 chars), cortar
  if (result.length > 300) {
    return restored.slice(0, 2).join(' ').trim();
  }
  return result;
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
// Cache de resumos para não resumir a mesma conversa toda vez
const summaryCache = new Map(); // conversaId -> { msgCount, summary }

async function buildSmartHistory(history, conversaId) {
  // Se a conversa é curta, envia tudo
  if (history.length <= 20) {
    return history.map(m => ({ role: m.role, content: m.content }));
  }

  const recentMsgs = history.slice(-12);
  const oldMsgs = history.slice(0, -12);

  // Verificar se já temos um resumo cacheado para este tamanho de conversa
  const cached = summaryCache.get(conversaId);
  let summary;

  if (cached && cached.msgCount >= oldMsgs.length - 2) {
    // Cache válido (tolerância de 2 msgs novas)
    summary = cached.summary;
  } else {
    // Gerar resumo real via Claude (usando modelo barato e rápido)
    const oldText = oldMsgs.map(m => `${m.role === 'user' ? 'Lead' : 'Ana'}: ${m.content}`).join('\n');
    try {
      const res = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: 'Você extrai dados-chave de conversas. Responda APENAS com os dados encontrados, sem explicação.',
        messages: [{ role: 'user', content: `Extraia desta conversa: nome do lead, problema/tese jurídica, email, telefone, dia/horário mencionado, qualquer informação pessoal relevante. Se não encontrou, omita.\n\n${oldText}` }]
      });
      summary = res.content[0].text;
    } catch (e) {
      // Fallback: extrair dados-chave manualmente
      summary = extractKeyInfo(oldMsgs);
    }

    // Cachear
    if (conversaId) {
      summaryCache.set(conversaId, { msgCount: oldMsgs.length, summary });
      // Limpar cache antigo (máx 100 conversas)
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

// Fallback: extração manual de dados-chave (sem chamar IA)
function extractKeyInfo(messages) {
  const allText = messages.map(m => m.content).join(' ');
  const info = [];

  // Nome (padrão: "me chamo X", "meu nome é X", "sou o/a X")
  const nomeMatch = allText.match(/(?:me chamo|meu nome é|sou o |sou a |meu nome:|nome:)\s*([A-ZÀ-Ú][a-zà-ú]+(?: [A-ZÀ-Ú][a-zà-ú]+)*)/i);
  if (nomeMatch) info.push(`Nome: ${nomeMatch[1]}`);

  // Email
  const emailMatch = allText.match(/[\w.-]+@[\w.-]+\.\w+/);
  if (emailMatch) info.push(`Email: ${emailMatch[0]}`);

  // Tese/problema mencionado
  const teses = ['isenção', 'imposto de renda', 'equiparação', 'hospitalar', 'tea', 'autismo', 'trabalhista', 'pensão', 'aposentadoria'];
  const teseFound = teses.filter(t => allText.toLowerCase().includes(t));
  if (teseFound.length) info.push(`Interesse: ${teseFound.join(', ')}`);

  // Dia/horário
  const diaMatch = allText.match(/(?:segunda|terça|quarta|quinta|sexta|sábado|amanhã|hoje)\s*(?:às?\s*)?(\d{1,2}[h:]?\d{0,2})?/gi);
  if (diaMatch) info.push(`Horário mencionado: ${diaMatch[diaMatch.length - 1]}`);

  return info.length > 0 ? info.join('\n') : 'Nenhum dado específico extraído ainda.';
}

// Gerar resposta com Claude
async function generateResponse(history, userMessage, conversaId) {
  const smartHistory = await buildSmartHistory(history, conversaId);
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
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
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

// Extrair dados do lead automaticamente das mensagens
async function extractAndUpdateLead(leadId, text) {
  if (!leadId || !text) return;
  const updates = {};

  // Extrair email
  const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w{2,}/);
  if (emailMatch) updates.email = emailMatch[0];

  // Extrair nome (padrões comuns em português)
  const nomePatterns = [
    /(?:me chamo|meu nome é|sou o |sou a |pode me chamar de )\s*([A-ZÀ-Ú][a-zà-ú]+(?: [A-ZÀ-Ú][a-zà-ú]+){0,3})/i,
    /(?:^|\n)([A-ZÀ-Ú][a-zà-ú]+ [A-ZÀ-Ú][a-zà-ú]+)(?:\s*$)/m // nome próprio sozinho na linha
  ];
  for (const pattern of nomePatterns) {
    const match = text.match(pattern);
    if (match && match[1].length > 3 && match[1].length < 50) {
      updates.nome = match[1].trim();
      break;
    }
  }

  // Detectar tese de interesse
  const lower = text.toLowerCase();
  if (!updates.tese_interesse) {
    if (lower.includes('isenção') || lower.includes('isençao') || lower.includes('imposto de renda') || lower.includes('aposentad'))
      updates.tese_interesse = 'IR Isenção';
    else if (lower.includes('equiparação') || lower.includes('hospitalar') || lower.includes('clínica') || lower.includes('clinica'))
      updates.tese_interesse = 'Equiparação Hospitalar';
    else if (lower.includes('tea') || lower.includes('autis') || lower.includes('escola especial') || lower.includes('terapia') || lower.includes('tema 324'))
      updates.tese_interesse = 'TEA/Tema 324';
    else if (lower.includes('trabalhist') || lower.includes('demissão') || lower.includes('demissao') || lower.includes('rescisão'))
      updates.tese_interesse = 'Trabalhista';
  }

  // Só atualizar se encontrou algo novo
  if (Object.keys(updates).length > 0) {
    updates.atualizado_em = new Date().toISOString();
    try {
      await supabase.from('leads').update(updates).eq('id', leadId);
      console.log(`[LEAD] Dados atualizados para ${leadId}:`, Object.keys(updates).join(', '));
    } catch (e) {
      console.error('[LEAD] Erro ao atualizar dados:', e.message);
    }
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
    // Buscar conversas ativas com leads que não sejam convertidos/perdidos
    const { data: conversas } = await supabase
      .from('conversas')
      .select('id, telefone, lead_id, leads(id, nome, tese_interesse, etapa_funil, telefone)')
      .eq('status', 'ativa')
      .not('lead_id', 'is', null);

    if (!conversas || conversas.length === 0) return;

    // Filtrar leads elegíveis
    const eligible = conversas.filter(c =>
      c.leads && c.leads.etapa_funil !== 'convertido' && c.leads.etapa_funil !== 'perdido'
    );

    if (eligible.length === 0) return;

    // Buscar últimas 3 mensagens de TODAS as conversas elegíveis de uma vez
    // Usando RPC ou query por conversa_ids (Supabase não suporta GROUP BY fácil, mas podemos filtrar por IDs)
    const conversaIds = eligible.map(c => c.id);
    const { data: allMsgs } = await supabase
      .from('mensagens')
      .select('conversa_id, role, criado_em')
      .in('conversa_id', conversaIds)
      .order('criado_em', { ascending: false })
      .limit(conversaIds.length * 3); // 3 msgs por conversa no máximo

    if (!allMsgs) return;

    // Agrupar mensagens por conversa (pegando no máximo 3 por conversa)
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
      const lastTime = new Date(lastMsg.criado_em).getTime();
      const hoursAgo = (now - lastTime) / (1000 * 60 * 60);

      // Se a última mensagem foi da IA (lead não respondeu) e já passaram 24-48h
      if (lastMsg.role === 'assistant' && hoursAgo >= 24 && hoursAgo < 48) {
        const lastAssistantCount = lastMsgs.filter(m => m.role === 'assistant').length;
        if (lastAssistantCount >= 2) continue; // Já mandou follow-up

        const nome = conv.leads.nome || 'amigo(a)';
        const tese = conv.leads.tese_interesse || 'sua questão jurídica';
        const followUp1 = `Olá, ${nome}! Tudo bem? Passando aqui sobre ${tese}. O Dr. Osmar ainda tem horários essa semana, posso te ajudar?`;

        console.log(`[FOLLOWUP-24h] Enviando para ${conv.telefone} (${nome})`);
        await saveMessage(conv.id, 'assistant', followUp1);
        await sendWhatsApp(conv.telefone, followUp1);
        await trackEvent(conv.id, conv.leads.id, 'followup_24h', nome);
      }

      // Follow-up de 72h (último esforço)
      if (lastMsg.role === 'assistant' && hoursAgo >= 72 && hoursAgo < 96) {
        const lastAssistantCount = lastMsgs.filter(m => m.role === 'assistant').length;
        if (lastAssistantCount >= 3) continue;

        const nome = conv.leads.nome || 'amigo(a)';
        const tese = conv.leads.tese_interesse;
        let followUp2 = '';

        if (tese === 'IR Isenção') {
          followUp2 = `${nome}, enquanto não entra com o pedido, o imposto continua sendo descontado. O Dr. Osmar pode analisar sem compromisso, é só me chamar!`;
        } else if (tese === 'Equiparação Hospitalar') {
          followUp2 = `${nome}, sua clínica pode estar pagando até 4x mais imposto. O Dr. Osmar avalia sem compromisso, me avisa se tiver interesse!`;
        } else if (tese === 'TEA/Tema 324') {
          followUp2 = `${nome}, os gastos com seu dependente podem ser deduzidos no IR. O Dr. Osmar pode ver quanto dá pra recuperar, me chama quando puder!`;
        } else {
          followUp2 = `${nome}, caso mude de ideia, estamos à disposição. O Dr. Osmar pode fazer uma análise inicial sem compromisso!`;
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

// ===== BUFFER DE MENSAGENS (espera lead terminar de digitar) =====
const messageBuffer = new Map(); // telefone -> { messages: [], timer: null, senderName: '', resolve: null }
const BUFFER_DELAY = 8000; // 8 segundos de espera

function bufferMessage(phone, text, senderName) {
  const cleanP = cleanPhone(phone);
  const existing = messageBuffer.get(cleanP);

  if (existing) {
    // Já existe buffer para este telefone — só acumula
    existing.messages.push(text);
    existing.senderName = senderName || existing.senderName;
    // Reinicia o timer (mais 8 segundos)
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => flushBuffer(cleanP), BUFFER_DELAY);
    // Retorna null = "não processe, já tem alguém esperando"
    return Promise.resolve(null);
  }

  // Primeira mensagem deste telefone — cria buffer e retorna Promise que resolve quando o timer disparar
  return new Promise((resolve) => {
    const entry = {
      messages: [text],
      senderName: senderName || '',
      timer: setTimeout(() => flushBuffer(cleanP), BUFFER_DELAY),
      resolve // guardar a função resolve para chamar quando o timer disparar
    };
    messageBuffer.set(cleanP, entry);
  });
}

function flushBuffer(cleanP) {
  const entry = messageBuffer.get(cleanP);
  if (!entry) return;
  messageBuffer.delete(cleanP);
  // Resolve a Promise da primeira mensagem com todas as mensagens combinadas
  entry.resolve({
    combined: entry.messages.join('\n'),
    senderName: entry.senderName
  });
}

// ===== CONTROLE DE DUPLICATAS E PAUSA =====
const processedMessages = new Set();
const pausedConversas = new Map(); // telefone -> timestamp da pausa
const recentBotSends = new Map(); // telefone -> timestamp do último envio da IA

// Limpar caches a cada 10 minutos (evitar vazamento de memória)
setInterval(() => {
  processedMessages.clear();
  // Limpar recentBotSends com mais de 2 minutos
  const now = Date.now();
  for (const [phone, ts] of recentBotSends) {
    if (now - ts > 120000) recentBotSends.delete(phone);
  }
  // Limpar pausas expiradas
  for (const [phone, until] of pausedConversas) {
    if (now > until) pausedConversas.delete(phone);
  }
}, 10 * 60 * 1000);

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

// ===== SEGURANÇA DO WEBHOOK =====

// Rate limit simples por IP (máx 30 requests por minuto)
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
  return entry.count <= 30;
}
// Limpar rate limit a cada 5 minutos
setInterval(() => { rateLimitMap.clear(); }, 5 * 60 * 1000);

// ===== WEBHOOK Z-API (recebe mensagens do WhatsApp) =====
app.post('/webhook/zapi', async (req, res) => {
  try {
    // Rate limit
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (!checkRateLimit(clientIp)) {
      console.warn(`[RATE] Rate limit excedido para ${clientIp}`);
      return res.status(429).json({ error: 'Too many requests' });
    }

    // Validar token Z-API (se configurado)
    const zapiWebhookToken = process.env.ZAPI_WEBHOOK_TOKEN;
    if (zapiWebhookToken) {
      const receivedToken = req.headers['x-api-key'] || req.headers['authorization'] || req.query.token;
      if (receivedToken !== zapiWebhookToken) {
        console.warn(`[AUTH] Token inválido no webhook de ${clientIp}`);
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

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
      console.log(`[PAUSE] Mensagem de ${phone} salva - IA pausada (Dr. Osmar respondendo)`);
      // Salvar mensagem mesmo durante pausa (mantém histórico completo)
      try {
        const conversa = await getOrCreateConversa(phone);
        await saveMessage(conversa.id, 'user', text);
      } catch (e) {
        console.error('[PAUSE] Erro ao salvar msg pausada:', e.message);
      }
      return res.json({ status: 'paused' });
    }

    console.log(`[MSG] De: ${phone} (${senderName}): ${text}`);

    // Responder imediatamente ao webhook (Z-API não precisa esperar)
    res.json({ status: 'buffered' });

    // Processar de forma assíncrona (resposta HTTP já foi enviada)
    processBufferedMessage(phone, text, senderName).catch(err => {
      console.error('[ASYNC] Erro no processamento assíncrono:', err.message);
    });

  } catch (e) {
    console.error('[WEBHOOK] Erro:', e);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message });
    }
  }
});

// Processamento assíncrono após buffer (sem acesso ao res)
async function processBufferedMessage(phone, text, senderName) {
  try {
    // Adicionar ao buffer e esperar 8 segundos por mais mensagens
    const result = await bufferMessage(phone, text, senderName);

    // null = mensagem acumulada no buffer de outra chamada, não processar
    if (!result) return;

    // Agora sim, processar todas as mensagens juntas
    const combinedText = result.combined;
    const finalName = result.senderName;

    console.log(`[BUFFER] Processando ${combinedText.split('\n').length} msg(s) de ${phone}: "${combinedText.slice(0, 100)}"`);

    const lead = await getOrCreateLead(phone, finalName);
    const conversa = await getOrCreateConversa(phone);

    if (lead && conversa && !conversa.lead_id) {
      await supabase
        .from('conversas')
        .update({ lead_id: lead.id, titulo: finalName || conversa.titulo })
        .eq('id', conversa.id);
    }

    // Salvar todas as mensagens do buffer como uma entrada
    await saveMessage(conversa.id, 'user', combinedText);

    // Extrair dados do lead (nome, email, tese) automaticamente
    if (lead) {
      await extractAndUpdateLead(lead.id, combinedText);
    }

    // Detectar se lead está quente
    if (lead && isHotLead(combinedText)) {
      console.log(`[HOT] Lead quente detectado: ${finalName} - "${combinedText.slice(0, 60)}"`);
      await markLeadHot(lead.id);
      await notifyHotLead(finalName || lead.nome, phone, combinedText.slice(0, 100));
      await trackEvent(conversa.id, lead.id, 'lead_quente', combinedText.slice(0, 100));
    }

    const history = await getHistory(conversa.id);
    const rawReply = await generateResponse(history, combinedText, conversa.id);
    const reply = trimResponse(rawReply);
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
  } catch (e) {
    console.error('[PROCESS] Erro ao processar mensagem:', e.message);
  }
}

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
      model: 'claude-haiku-4-5-20251001',
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
  try {
    const { data } = await supabase
      .from('conversas')
      .select('*, leads(nome, tese_interesse, etapa_funil)')
      .order('criado_em', { ascending: false })
      .limit(50);
    res.json(data || []);
  } catch (e) {
    console.error('[API] Erro /api/conversas:', e.message);
    res.status(500).json({ error: 'Erro ao buscar conversas' });
  }
});

// Buscar mensagens de uma conversa
app.get('/api/conversas/:id/mensagens', async (req, res) => {
  try {
    const { data } = await supabase
      .from('mensagens')
      .select('*')
      .eq('conversa_id', req.params.id)
      .order('criado_em', { ascending: true });
    res.json(data || []);
  } catch (e) {
    console.error('[API] Erro /api/mensagens:', e.message);
    res.status(500).json({ error: 'Erro ao buscar mensagens' });
  }
});

// Enviar mensagem manual pelo CRM
app.post('/api/enviar', async (req, res) => {
  try {
    const { phone, message, conversaId } = req.body;
    if (!phone || !message) return res.status(400).json({ error: 'phone e message obrigatórios' });

    if (conversaId) {
      await saveMessage(conversaId, 'assistant', message);
    }

    const result = await sendWhatsApp(phone, message);
    res.json({ ok: true, result });
  } catch (e) {
    console.error('[API] Erro /api/enviar:', e.message);
    res.status(500).json({ error: 'Erro ao enviar mensagem' });
  }
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
