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
let email;
try { email = require('./email'); } catch (e) { console.log('[INIT] Email não disponível'); }
let audio;
try { audio = require('./audio'); } catch (e) { console.log('[INIT] Audio n��o disponível'); }
let assistentePessoal;
try { assistentePessoal = require('./assistente-pessoal'); } catch (e) { console.log('[INIT] Assistente pessoal não disponível'); }
let arquivos;
try { arquivos = require('./arquivos'); } catch (e) { console.log('[INIT] Módulo arquivos não disponível'); }

const app = express();

// CORS restrito — aceita apenas origens confiáveis
const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length > 0
    ? (origin, cb) => (!origin || allowedOrigins.includes(origin)) ? cb(null, true) : cb(new Error('CORS bloqueado'))
    : false
}));

app.use(express.json());

// Middleware de autenticação para rotas administrativas
function requireAdmin(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '') || req.headers['x-admin-token'];
  if (!config.ADMIN_TOKEN || token !== config.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

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

// ===== ENVIAR MENSAGEM LONGA (divide em blocos de 4000 chars) =====
async function sendLongText(phone, text) {
  if (text.length <= 4000) {
    await whatsapp.sendText(phone, text);
  } else {
    const partes = text.match(/[\s\S]{1,4000}/g) || [text];
    for (const parte of partes) {
      await whatsapp.sendText(phone, parte.trim());
    }
  }
}

// ===== VERIFICAR SE É O DR. OSMAR =====
function isOsmar(phone) {
  if (!config.OSMAR_PHONE) return false;
  const cleanIncoming = whatsapp.cleanPhone(phone);
  const cleanOsmar = whatsapp.cleanPhone(config.OSMAR_PHONE);
  // Comparação direta
  if (cleanIncoming === cleanOsmar) return true;
  // Formato brasileiro: às vezes o 9º dígito é omitido (5591XXXXXXXX vs 55919XXXXXXXX)
  // Compara os últimos 8 dígitos do telefone (parte local sem o 9 extra)
  if (cleanIncoming && cleanOsmar && cleanIncoming.slice(-8) === cleanOsmar.slice(-8)) return true;
  return false;
}

// ===== LEMBRETES =====

// Parser: detecta [LEMBRETE: descricao="..." horario="HH:MM" recorrencia="..."] na resposta da Ana
async function processarLembretes(resposta, telefone) {
  const regex = /\[LEMBRETE:\s*descricao="([^"]+)"\s*horario="([^"]+)"\s*recorrencia="([^"]+)"\]/gi;
  let match;

  while ((match = regex.exec(resposta)) !== null) {
    const descricao = match[1];
    const horarioStr = match[2]; // "HH:MM"
    const recorrencia = match[3]; // "diario", "semanal", "unico"

    // Converter "HH:MM" para datetime de hoje (horário de Belém)
    const [horas, minutos] = horarioStr.split(':').map(Number);
    const agora = new Date();
    // Criar data em UTC ajustando para Belém (UTC-3)
    const horario = new Date(agora);
    horario.setUTCHours(horas + 3, minutos, 0, 0); // Belém = UTC-3

    // Se o horário já passou hoje, agendar para amanhã
    if (horario <= agora) {
      horario.setDate(horario.getDate() + 1);
    }

    const lembrete = await db.criarLembrete({
      descricao,
      horario: horario.toISOString(),
      recorrencia: recorrencia === 'unico' ? null : recorrencia,
      telefone: whatsapp.cleanPhone(telefone)
    });

    if (lembrete) {
      console.log(`[LEMBRETE] Criado: "${descricao}" às ${horarioStr} (${recorrencia})`);
    }
  }
}

// Agendador: verifica lembretes a cada minuto e envia no horário certo
async function checkLembretes() {
  try {
    const lembretes = await db.getLembretesAtivos();
    if (lembretes.length === 0) return;

    const agora = new Date();

    for (const lembrete of lembretes) {
      const horarioLembrete = new Date(lembrete.horario);

      // Verificar se está na janela de envio (até 2 minutos de atraso tolerado)
      const diffMs = agora - horarioLembrete;
      if (diffMs >= 0 && diffMs < 2 * 60 * 1000) {
        const telefone = lembrete.telefone || config.OSMAR_PHONE;
        const msg = `Dr. Osmar, seu lembrete: ${lembrete.descricao}`;

        await whatsapp.sendText(telefone, msg);
        await db.marcarLembreteEnviado(lembrete.id, lembrete.recorrencia);
        console.log(`[LEMBRETE] Enviado: "${lembrete.descricao}" para ${telefone}`);
      }
    }
  } catch (e) {
    console.error('[LEMBRETE] Erro no agendador:', e.message);
  }
}

// Verificar lembretes a cada 1 minuto
setInterval(() => {
  checkLembretes().catch(e => console.error('[LEMBRETE] Erro:', e.message));
}, 60 * 1000);
// Verificar na inicialização (após 30 segundos)
setTimeout(() => {
  console.log('[LEMBRETE] Agendador de lembretes iniciado (a cada 1 min)');
  checkLembretes().catch(e => console.error('[LEMBRETE] Erro:', e.message));
}, 30 * 1000);

// ===== PROCESSAMENTO MODO PESSOAL (DR. OSMAR) =====
async function processOsmarMessage(phone, text, respondComAudio = false) {
  try {
    console.log(`[PESSOAL] Dr. Osmar: ${text.slice(0, 80)}`);

    const conversa = await db.getOrCreateConversa(phone);
    await db.saveMessage(conversa.id, 'user', text);

    if (!assistentePessoal) {
      await whatsapp.sendText(phone, 'Modulo assistente pessoal nao disponivel. Verifique o servidor.');
      return;
    }

    const history = await db.getHistory(conversa.id);
    const rawReply = await assistentePessoal.generateResponse(history, text);

    // Detectar e criar lembretes na resposta da Ana
    const temLembrete = /\[LEMBRETE:/i.test(rawReply);
    if (temLembrete) {
      await processarLembretes(rawReply, phone);
    }

    // Limpar o comando de lembrete da mensagem antes de enviar
    const reply = rawReply.replace(/\[LEMBRETE:.*?\]/g, '').trim();
    await db.saveMessage(conversa.id, 'assistant', reply);

    // Enviar resposta (dividir se for longa)
    if (respondComAudio && audio) {
      const audioReply = reply.length > 500 ? reply.slice(0, 500) : reply;
      const audioBase64 = await audio.gerarAudio(audioReply);
      if (audioBase64) {
        await whatsapp.sendAudio(phone, audioBase64);
        // Se cortou para áudio, enviar o restante por texto
        if (reply.length > 500) {
          await whatsapp.sendText(phone, reply);
        }
      } else {
        await sendLongText(phone, reply);
      }
    } else {
      await sendLongText(phone, reply);
    }

    console.log(`[PESSOAL] Resposta: ${reply.slice(0, 80)}...`);
  } catch (e) {
    console.error('[PESSOAL] Erro:', e.message);
  }
}

// ===== PROCESSAR ARQUIVO DO DR. OSMAR =====
async function processOsmarFile(phone, fileUrl, fileName, caption) {
  try {
    if (!arquivos) {
      await whatsapp.sendText(phone, 'Modulo de arquivos nao disponivel. Verifique o servidor.');
      return;
    }

    console.log(`[ARQUIVOS] Recebido de Dr. Osmar: ${fileName || 'arquivo'}`);

    // 1. Salvar na gaveta
    const resultado = await arquivos.salvarArquivo(fileUrl, fileName, caption);

    // 2. Extrair texto do documento (reutiliza buffer do download, evita baixar 2x)
    const textoExtraido = resultado ? await arquivos.extrairTexto(resultado.buffer, resultado.contentType) : null;

    const conversa = await db.getOrCreateConversa(phone);

    if (resultado) {
      const tamanhoKB = (resultado.tamanho / 1024).toFixed(1);
      await db.saveMessage(conversa.id, 'user', `[Arquivo enviado: ${resultado.nome}] ${caption || ''}`);

      // 3. Se extraiu texto E tem pedido (caption), analisar com a Ana
      if (textoExtraido && caption) {
        await whatsapp.sendText(phone, `Recebi o ${resultado.nome}. Analisando...`);

        const perguntaComDocumento = `O Dr. Osmar enviou o documento "${fileName || 'arquivo'}" e pediu: "${caption}"

===== CONTEÚDO DO DOCUMENTO =====
${textoExtraido}
=================================

Analise o documento e responda ao pedido do Dr. Osmar. Seja detalhado e útil.`;

        const history = await db.getHistory(conversa.id);
        const rawReply = await assistentePessoal.generateResponse(history, perguntaComDocumento);
        // Não usar trimResponse para análises — precisa da resposta completa
        // Respostas longas: dividir em mensagens de até 4000 chars (limite do WhatsApp)
        const reply = rawReply;
        await db.saveMessage(conversa.id, 'assistant', reply);
        await sendLongText(phone, reply);
        console.log(`[ARQUIVOS] Análise enviada: ${reply.length} chars`);

      // 4. Se extraiu texto mas NÃO tem pedido, confirmar e oferecer análise
      } else if (textoExtraido) {
        const resumoPreview = textoExtraido.slice(0, 200).replace(/\n/g, ' ');
        const msg = `Salvo na gaveta, Dr. Osmar. ${resultado.nome} (${tamanhoKB} KB). Li o conteudo e posso analisar, resumir ou elaborar algo com base nele. E so pedir.`;
        await db.saveMessage(conversa.id, 'assistant', msg);
        await whatsapp.sendText(phone, msg);

        // Guardar o texto extraído na conversa para consultas futuras
        await db.saveMessage(conversa.id, 'user', `[Documento ${fileName} - conteúdo extraído para análise]: ${textoExtraido.slice(0, 50000)}`);

      // 5. Não conseguiu extrair texto (imagem, formato não suportado)
      } else {
        const msg = `Salvo na gaveta, Dr. Osmar. ${resultado.nome} (${resultado.tipo}, ${tamanhoKB} KB).`;
        await db.saveMessage(conversa.id, 'assistant', msg);
        await whatsapp.sendText(phone, msg);
      }
    } else {
      await whatsapp.sendText(phone, 'Dr. Osmar, nao consegui salvar o arquivo. Pode tentar novamente?');
    }
  } catch (e) {
    console.error('[ARQUIVOS] Erro:', e.message);
    await whatsapp.sendText(phone, 'Erro ao processar o arquivo. Tente novamente.');
  }
}

// ===== PROCESSAMENTO ASSÍNCRONO =====
async function processBufferedMessage(phone, text, senderName, respondComAudio = false) {
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

    // Buscar contexto CRM completo (cliente, casos, tarefas, financeiro)
    let contexto = null;
    try {
      contexto = await db.getContextoCompleto(phone);
      if (contexto.tipo === 'cliente') {
        console.log(`[CRM] ${phone} é CLIENTE: ${contexto.cliente.nome_completo || contexto.cliente.razao_social} | ${contexto.casos.length} caso(s) | ${contexto.financeiro.length} pendência(s)`);
      }
    } catch (e) {
      console.log('[CRM] Erro ao buscar contexto:', e.message);
    }

    // Gerar e enviar resposta (passa lead atualizado + contexto CRM para a IA montar a ficha)
    const history = await db.getHistory(conversa.id);
    const rawReply = await ia.generateResponse(history, combinedText, conversa.id, leadAtualizado, contexto);
    const reply = ia.trimResponse(rawReply);
    await db.saveMessage(conversa.id, 'assistant', reply);

    // Se veio de áudio, responder com áudio + texto
    if (respondComAudio && audio) {
      const audioBase64 = await audio.gerarAudio(reply);
      if (audioBase64) {
        await whatsapp.sendAudio(phone, audioBase64);
        console.log(`[AUDIO] Resposta em áudio enviada para ${phone}`);
      } else {
        // Fallback: se falhar gerar áudio, envia texto
        await whatsapp.sendText(phone, reply);
      }
    } else {
      await whatsapp.sendText(phone, reply);
    }

    // Detectar se a Ana confirmou agendamento na resposta
    // Se sim, criar evento no Google Calendar automaticamente
    if (calendar && leadAtualizado) {
      const replyLower = reply.toLowerCase();
      const confirmouAgendamento = replyLower.includes('agendei') || replyLower.includes('agendada') ||
        replyLower.includes('consulta marcada') || replyLower.includes('marcada para') ||
        replyLower.includes('está agendad') || replyLower.includes('confirmad');

      if (confirmouAgendamento) {
        try {
          // Tentar encontrar o slot mencionado na conversa
          const textoCompleto = combinedText + ' ' + reply;
          const slot = await calendar.encontrarSlot(textoCompleto);
          if (slot) {
            const evento = await calendar.criarConsulta(
              leadAtualizado.nome || finalName || 'Lead',
              phone,
              leadAtualizado.email || '',
              slot.inicio,
              textoCompleto.toLowerCase().includes('presencial') ? 'presencial' : 'online'
            );
            if (evento) {
              await db.trackEvent(conversa.id, lead?.id, 'consulta_agendada', evento.inicio);
              await db.updateLead(lead.id, { etapa_funil: 'convertido' });
              console.log(`[CALENDAR] Consulta agendada automaticamente: ${evento.inicio}`);

              // Enviar confirmação por áudio + texto no WhatsApp
              const nomeCliente = leadAtualizado.nome || finalName || 'Cliente';
              const assunto = leadAtualizado.tese_interesse || 'consulta jurídica';
              const formato = textoCompleto.toLowerCase().includes('presencial') ? 'presencial' : 'online';
              const resumo = `Consulta confirmada! ${evento.inicio}, ${formato === 'presencial' ? 'presencial no escritório em Belém' : 'online'}. Cliente: Sr(a) ${nomeCliente}. Assunto: ${assunto}. Consulta com o Dr. Osmar Neves. Qualquer duvida, me chame por aqui.`;

              // Enviar texto com resumo
              await whatsapp.sendText(phone, resumo);
              await db.saveMessage(conversa.id, 'assistant', resumo);

              // Enviar áudio da confirmação
              if (audio) {
                const audioConfirm = await audio.gerarAudio(resumo);
                if (audioConfirm) {
                  await whatsapp.sendAudio(phone, audioConfirm);
                  console.log(`[AUDIO] Confirmação de agendamento em áudio enviada para ${phone}`);
                }
              }

              // Criar tarefa automática para a consulta
              try {
                // Tentar vincular a um caso existente
                const cliente = await db.findClienteByPhone(phone);
                const caso = cliente ? await db.findCasoByCliente(cliente.id) : null;

                // Extrair data da consulta para a tarefa
                const dataConsulta = slot.inicio ? new Date(slot.inicio).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

                await db.createTarefa({
                  caso_id: caso?.id || null,
                  descricao: `Consulta agendada: ${nomeCliente} - ${assunto} (${formato})`,
                  data_limite: dataConsulta,
                  prioridade: 'alta',
                  responsavel: 'Osmar',
                  status: 'pendente'
                });
                console.log(`[TAREFA] Tarefa de consulta criada para ${nomeCliente}`);
              } catch (e) {
                console.error('[TAREFA] Erro ao criar tarefa:', e.message);
              }
            }
          }
        } catch (e) {
          console.error('[CALENDAR] Erro ao agendar automático:', e.message);
        }
      }
    }

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
// Estratégia:
// 1º follow-up: 2h sem resposta → texto perguntando se tem dúvidas
// 2º follow-up: 4h sem resposta → áudio mais acolhedor
// 3º follow-up: 24h → texto com argumento da tese
// 4º follow-up: 72h → áudio final com gatilho de urgência
async function checkFollowUps() {
  try {
    const eligible = await db.getEligibleConversas();
    if (eligible.length === 0) return;

    const conversaIds = eligible.map(c => c.id);
    const allMsgs = await db.getRecentMessages(conversaIds, 5);

    const msgsByConv = {};
    for (const msg of allMsgs) {
      if (!msgsByConv[msg.conversa_id]) msgsByConv[msg.conversa_id] = [];
      if (msgsByConv[msg.conversa_id].length < 5) {
        msgsByConv[msg.conversa_id].push(msg);
      }
    }

    const now = Date.now();

    for (const conv of eligible) {
      // NUNCA fazer follow-up para o número do Dr. Osmar
      if (isOsmar(conv.telefone)) continue;

      const lastMsgs = msgsByConv[conv.id];
      if (!lastMsgs || lastMsgs.length === 0) continue;

      const lastMsg = lastMsgs[0];
      const hoursAgo = (now - new Date(lastMsg.criado_em).getTime()) / (1000 * 60 * 60);

      // Só faz follow-up se a última mensagem foi da Ana (lead não respondeu)
      if (lastMsg.role !== 'assistant') continue;

      // Contar quantos follow-ups já foram feitos (msgs consecutivas da Ana)
      let followUpCount = 0;
      for (const m of lastMsgs) {
        if (m.role === 'assistant') followUpCount++;
        else break;
      }

      const nome = conv.leads?.nome || 'amigo(a)';
      const tese = conv.leads?.tese_interesse || 'sua questão jurídica';

      // Helper: tentar IA primeiro, fallback para msg fixa
      async function getSmartMsg(fixedMsg, followUpNum) {
        try {
          const history = await db.getHistory(conv.id);
          const smart = await ia.generateFollowUp(history, conv.leads, followUpNum);
          if (smart && smart.length > 10) return smart;
        } catch (e) {
          console.log(`[FOLLOWUP] IA falhou, usando fixo: ${e.message}`);
        }
        return fixedMsg;
      }

      // Helper: enviar como áudio ou texto
      async function sendFollowUp(msg, asAudio) {
        if (asAudio && audio) {
          const audioBase64 = await audio.gerarAudio(msg);
          if (audioBase64) {
            await whatsapp.sendAudio(conv.telefone, audioBase64);
          } else {
            await whatsapp.sendText(conv.telefone, msg);
          }
        } else {
          await whatsapp.sendText(conv.telefone, msg);
        }
        await db.saveMessage(conv.id, 'assistant', msg);
      }

      // 1º FOLLOW-UP: 2h sem resposta → texto inteligente
      if (followUpCount === 1 && hoursAgo >= 2 && hoursAgo < 4) {
        const fixo = `${nome}, tudo bem? Ficou com alguma duvida? Estou aqui para te ajudar com ${tese}. Pode me perguntar qualquer coisa.`;
        const msg = await getSmartMsg(fixo, 1);

        console.log(`[FOLLOWUP-2h] ${conv.telefone} (${nome}) — texto`);
        await sendFollowUp(msg, false);
        await db.trackEvent(conv.id, conv.leads?.id, 'followup_2h', nome);
      }

      // 2º FOLLOW-UP: 4h sem resposta → áudio inteligente
      if (followUpCount === 2 && hoursAgo >= 2 && hoursAgo < 20) {
        const fixo = `${nome}, aqui é a Ana do escritório do Dr. Osmar. Passando para saber se posso te ajudar. O Dr. Osmar tem horarios disponiveis essa semana e a consulta inicial e sem compromisso. Me chama quando puder, estou por aqui.`;
        const msg = await getSmartMsg(fixo, 2);

        console.log(`[FOLLOWUP-4h] ${conv.telefone} (${nome}) — áudio`);
        await sendFollowUp(msg, true);
        await db.trackEvent(conv.id, conv.leads?.id, 'followup_4h_audio', nome);
      }

      // 3º FOLLOW-UP: 24h → texto inteligente com argumento da tese
      if (followUpCount === 3 && hoursAgo >= 20 && hoursAgo < 48) {
        let fixo = '';
        if (tese === 'IR Isenção')
          fixo = `${nome}, enquanto nao entra com o pedido, o imposto continua sendo descontado do seu salario. O Dr. Osmar pode analisar sem compromisso, e so me chamar.`;
        else if (tese === 'Equiparação Hospitalar')
          fixo = `${nome}, sua clinica pode estar pagando ate 4 vezes mais imposto do que deveria. O Dr. Osmar avalia sem compromisso, me avisa se tiver interesse.`;
        else if (tese === 'TEA/Tema 324')
          fixo = `${nome}, os gastos com terapias do seu dependente podem ser deduzidos no imposto de renda. O Dr. Osmar pode ver quanto da pra recuperar, me chama quando puder.`;
        else
          fixo = `${nome}, o Dr. Osmar ainda tem horarios essa semana. A consulta inicial e sem compromisso e ele pode avaliar o seu caso. Posso agendar para voce?`;

        const msg = await getSmartMsg(fixo, 3);

        console.log(`[FOLLOWUP-24h] ${conv.telefone} (${nome}) — texto`);
        await sendFollowUp(msg, false);
        await db.trackEvent(conv.id, conv.leads?.id, 'followup_24h', nome);
      }

      // 4º FOLLOW-UP: 72h → áudio final inteligente
      if (followUpCount === 4 && hoursAgo >= 48 && hoursAgo < 96) {
        const fixo = `${nome}, tudo bem? Aqui é a Ana do escritorio do Dr. Osmar Neves. Essa e a minha ultima mensagem sobre o assunto, nao quero te incomodar. Mas caso mude de ideia, estamos a disposicao. O Dr. Osmar pode fazer uma analise inicial sem compromisso. E so me chamar por aqui. Te desejo tudo de bom.`;
        const msg = await getSmartMsg(fixo, 4);

        console.log(`[FOLLOWUP-72h] ${conv.telefone} (${nome}) — áudio final`);
        await sendFollowUp(msg, true);
        await db.trackEvent(conv.id, conv.leads?.id, 'followup_72h_audio', nome);
      }
    }
  } catch (e) {
    console.error('[FOLLOWUP] Erro:', e.message);
  }
}

// Agendar follow-ups (8h-20h Belém, a cada 30 minutos)
setInterval(() => {
  const belemHour = new Date().toLocaleString('en-US', { timeZone: 'America/Belem', hour: 'numeric', hour12: false });
  if (parseInt(belemHour) >= 8 && parseInt(belemHour) <= 20) {
    console.log('[FOLLOWUP] Verificando...');
    checkFollowUps();
  }
}, 30 * 60 * 1000);
setTimeout(() => checkFollowUps(), 60 * 1000);

// ===== WEBHOOK Z-API =====
app.post('/webhook/zapi', async (req, res) => {
  try {
    console.log(`[WEBHOOK] Requisição recebida de ${req.headers['x-forwarded-for'] || req.socket.remoteAddress}`);

    // Rate limit
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (!checkRateLimit(clientIp)) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    // Validar token — Z-API envia o token da instância via header 'z-api-token'
    const received = req.headers['z-api-token'] || req.headers['x-api-key'] || req.headers['client-token'] || req.headers['authorization'];
    const isValid = (config.ZAPI_TOKEN && received === config.ZAPI_TOKEN) ||
                    (config.ZAPI_WEBHOOK_TOKEN && received === config.ZAPI_WEBHOOK_TOKEN) ||
                    (config.ZAPI_CLIENT_TOKEN && received === config.ZAPI_CLIENT_TOKEN);
    if (!isValid) {
      console.log(`[WEBHOOK] Token rejeitado. Recebido: "${received || 'nenhum'}"`);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const body = req.body;
    const messageId = body.messageId || body.ids?.[0]?.serialized || body.id?.id || '';
    const isMessage = body.type === 'ReceivedCallback' || body.text?.message;
    const isFromMe = body.fromMe || body.isFromMe;

    // Mensagem enviada: detectar se foi IA ou Dr. Osmar respondendo manualmente
    if (isFromMe) {
      const phone = body.phone || body.to?.replace('@c.us', '') || '';
      if (phone && whatsapp.wasBotRecentSend(phone)) {
        return res.json({ status: 'bot_sent' });
      }
      // Não pausar se a mensagem foi enviada PARA o Dr. Osmar (modo pessoal)
      if (phone && !isOsmar(phone)) {
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
    const isAudio = body.isAudio || body.audio || body.audioMessage || (body.type === 'ReceivedCallback' && body.audio);
    const audioUrl = body.audio?.audioUrl || body.audioMessage?.url || body.audio?.url || body.mediaUrl || null;

    // Detectar arquivos (imagem, documento, planilha, etc.)
    const fileUrl = body.image?.imageUrl || body.document?.documentUrl || body.image?.url || body.document?.url || body.mediaUrl || null;
    const fileName = body.document?.fileName || body.image?.caption || body.caption || null;
    const hasFile = fileUrl && !isAudio;

    // ===== MODO PESSOAL: DR. OSMAR =====
    if (isOsmar(phone)) {
      res.json({ status: 'osmar_received' });

      // Arquivo do Dr. Osmar → salvar na gaveta
      if (hasFile) {
        processOsmarFile(phone, fileUrl, fileName, text).catch(err =>
          console.error('[PESSOAL] Erro arquivo:', err.message)
        );
        return;
      }

      // Áudio do Dr. Osmar → transcrever e processar como pessoal
      if (isAudio || audioUrl) {
        (async () => {
          try {
            if (!audio) {
              await processOsmarMessage(phone, '[audio sem transcrição]', false);
              return;
            }
            const transcricao = await audio.transcreverAudio(audioUrl);
            if (transcricao) {
              await processOsmarMessage(phone, transcricao, true);
            } else {
              await whatsapp.sendText(phone, 'Dr. Osmar, nao consegui ouvir o audio. Pode digitar ou enviar novamente?');
            }
          } catch (e) {
            console.error('[PESSOAL] Erro áudio:', e.message);
          }
        })();
        return;
      }

      // Texto do Dr. Osmar → assistente pessoal
      if (text) {
        processOsmarMessage(phone, text, false).catch(err =>
          console.error('[PESSOAL] Erro texto:', err.message)
        );
      }
      return;
    }

    // ===== MODO ATENDIMENTO: LEADS/CLIENTES =====

    // Se for áudio, transcrever antes de processar
    if (isAudio || audioUrl) {
      if (!audio) return res.json({ status: 'audio_not_configured' });

      console.log(`[AUDIO] Áudio recebido de ${phone}`);
      res.json({ status: 'audio_received' });

      // Processar áudio assincronamente
      (async () => {
        try {
          if (isAIPaused(phone)) {
            console.log(`[PAUSE] Áudio de ${phone} ignorado - IA pausada`);
            return;
          }

          const url = audioUrl;
          if (!url) {
            console.error('[AUDIO] URL do áudio não encontrada no payload');
            return;
          }

          const transcricao = await audio.transcreverAudio(url);
          if (!transcricao) {
            console.error('[AUDIO] Falha na transcrição');
            await whatsapp.sendText(phone, 'Desculpe, não consegui ouvir seu áudio. Pode digitar ou enviar novamente?');
            return;
          }

          // Processar como mensagem de texto normal, mas marcar que veio de áudio
          await processBufferedMessage(phone, transcricao, senderName, true);
        } catch (e) {
          console.error('[AUDIO] Erro ao processar áudio:', e.message);
        }
      })();
      return;
    }

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

app.get('/api/test/zapi', requireAdmin, async (req, res) => {
  try {
    const r = await fetch(`${config.ZAPI_BASE}/status`, { headers: { 'Client-Token': config.ZAPI_CLIENT_TOKEN } });
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/test/calendar', requireAdmin, async (req, res) => {
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

app.get('/api/test/claude', requireAdmin, async (req, res) => {
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

app.get('/api/conversas', requireAdmin, async (req, res) => {
  try {
    res.json(await db.listConversas());
  } catch (e) {
    res.status(500).json({ error: 'Erro ao buscar conversas' });
  }
});

app.get('/api/conversas/:id/mensagens', requireAdmin, async (req, res) => {
  try {
    res.json(await db.getConversaMensagens(req.params.id));
  } catch (e) {
    res.status(500).json({ error: 'Erro ao buscar mensagens' });
  }
});

app.post('/api/enviar', requireAdmin, async (req, res) => {
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

app.post('/api/pausar', requireAdmin, (req, res) => {
  const { phone, minutes } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone obrigatório' });
  pauseAI(phone, minutes || 30);
  res.json({ ok: true, msg: `IA pausada para ${phone} por ${minutes || 30} minutos` });
});

app.post('/api/retomar', requireAdmin, (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone obrigatório' });
  pausedConversas.delete(whatsapp.cleanPhone(phone));
  res.json({ ok: true, msg: `IA retomada para ${phone}` });
});

app.get('/api/metricas', requireAdmin, async (req, res) => {
  try {
    res.json(await db.getMetricas());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== RELATÓRIO SEMANAL =====

async function enviarRelatorioSemanal() {
  try {
    const r = await db.getRelatorioSemanal();
    const hoje = new Date().toLocaleDateString('pt-BR');

    const msg = `Relatorio Semanal - Neves Advocacia
${hoje}

Novos leads: ${r.leadsNovos}
Convertidos: ${r.convertidos}
Agendamentos: ${r.agendamentos}
Leads ativos no funil: ${r.leadsAtivos}

Recebido na semana: R$ ${r.totalRecebido.toFixed(2)}
Cobrancas atrasadas: ${r.cobrancasAtrasadas} (R$ ${r.totalAtrasado.toFixed(2)})
Tarefas vencidas: ${r.tarefasVencidas}

Bom trabalho, Dr. Osmar!`;

    await whatsapp.sendText(config.OSMAR_PHONE, msg);
    console.log(`[RELATORIO] Semanal enviado para ${config.OSMAR_PHONE}`);
    return msg;
  } catch (e) {
    console.error('[RELATORIO] Erro:', e.message);
    return null;
  }
}

// Verificar se é segunda-feira às 8h para enviar relatório
setInterval(async () => {
  const agora = new Date();
  // Ajustar para horário de Belém (UTC-3)
  const belem = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  const dia = belem.getUTCDay(); // 1 = segunda
  const hora = belem.getUTCHours();
  const min = belem.getUTCMinutes();

  // Segunda-feira, entre 8:00 e 8:14 (margem do intervalo de 15min)
  if (dia === 1 && hora === 8 && min < 15) {
    // Verificar se já enviou hoje
    const chave = `relatorio_${belem.toISOString().slice(0, 10)}`;
    if (!global._relatorioEnviado || global._relatorioEnviado !== chave) {
      global._relatorioEnviado = chave;
      await enviarRelatorioSemanal();
    }
  }
}, 15 * 60 * 1000); // Verificar a cada 15 minutos

// Rota manual para enviar relatório
app.post('/api/relatorio-semanal', requireAdmin, async (req, res) => {
  const msg = await enviarRelatorioSemanal();
  if (msg) {
    res.json({ ok: true, msg });
  } else {
    res.status(500).json({ error: 'Erro ao gerar relatório' });
  }
});

app.get('/api/relatorio-semanal', requireAdmin, async (req, res) => {
  try {
    const r = await db.getRelatorioSemanal();
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== VALIDAÇÃO DE VARIÁVEIS OBRIGATÓRIAS =====
const requiredVars = ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_KEY', 'ZAPI_WEBHOOK_TOKEN', 'OSMAR_PHONE', 'ADMIN_TOKEN'];
const missing = requiredVars.filter(v => !config[v]);
if (missing.length > 0) {
  console.error(`[ERRO FATAL] Variáveis obrigatórias não configuradas: ${missing.join(', ')}`);
  console.error('Configure no .env antes de iniciar o servidor.');
  process.exit(1);
}

// ===== INICIAR =====
app.listen(config.PORT, () => {
  console.log('');
  console.log('CRM Neves Advocacia - Servidor v4 (Segurança reforçada)');
  console.log(`Rodando em http://localhost:${config.PORT}`);
  console.log(`Claude: OK`);
  console.log(`Z-API: ${config.ZAPI_INSTANCE ? 'OK' : 'Faltando'}`);
  console.log(`Supabase: OK`);
  console.log(`OpenAI: ${config.OPENAI_API_KEY ? 'OK (audio ativo)' : 'Faltando (audio desativado)'}`);
  console.log(`Webhook: Protegido por token`);
  console.log(`Rotas admin: Protegidas por ADMIN_TOKEN`);
  console.log(`CORS: ${allowedOrigins.length > 0 ? allowedOrigins.join(', ') : 'Bloqueado (configure CORS_ORIGINS)'}`);
  console.log('');
});
