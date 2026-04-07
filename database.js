// ===== OPERAÇÕES SUPABASE =====
const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_KEY);
const INST = config.INSTANCIA || 'ana';

// ===== CONVERSAS =====

async function getOrCreateConversa(phone) {
  const { cleanPhone } = require('./whatsapp');
  const tel = cleanPhone(phone);

  let { data: conv } = await supabase
    .from('conversas')
    .select('*')
    .eq('telefone', tel)
    .eq('status', 'ativa')
    .eq('instancia', INST)
    .order('criado_em', { ascending: false })
    .limit(1)
    .single();

  if (conv) return conv;

  const { data: newConv } = await supabase
    .from('conversas')
    .insert({ telefone: tel, titulo: 'WhatsApp', instancia: INST })
    .select()
    .single();

  return newConv;
}

async function updateConversa(conversaId, updates) {
  await supabase.from('conversas').update(updates).eq('id', conversaId);
}

// ===== MENSAGENS =====

async function saveMessage(conversaId, role, content) {
  await supabase
    .from('mensagens')
    .insert({ conversa_id: conversaId, role, content });
}

async function getHistory(conversaId, limit = 100) {
  const { data: msgs } = await supabase
    .from('mensagens')
    .select('role, content')
    .eq('conversa_id', conversaId)
    .order('criado_em', { ascending: true })
    .limit(limit);

  return msgs || [];
}

async function getRecentMessages(conversaIds, perConversation = 3) {
  const { data } = await supabase
    .from('mensagens')
    .select('conversa_id, role, criado_em')
    .in('conversa_id', conversaIds)
    .order('criado_em', { ascending: false })
    .limit(conversaIds.length * perConversation);

  return data || [];
}

// ===== LEADS =====

async function getOrCreateLead(phone, nome) {
  const { cleanPhone } = require('./whatsapp');
  const tel = cleanPhone(phone);

  let { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('telefone', tel)
    .eq('instancia', INST)
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
      data_primeiro_contato: new Date().toISOString(),
      instancia: INST
    })
    .select()
    .single();

  console.log('[LEAD] Novo lead criado:', newLead?.nome);
  return newLead;
}

async function updateLead(leadId, updates) {
  updates.atualizado_em = new Date().toISOString();
  await supabase.from('leads').update(updates).eq('id', leadId);
}

async function markLeadHot(leadId) {
  await updateLead(leadId, { etapa_funil: 'proposta' });
}

// Extrair dados do lead automaticamente das mensagens
async function extractAndUpdateLead(leadId, text) {
  if (!leadId || !text) return;
  const updates = {};

  // Email
  const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w{2,}/);
  if (emailMatch) updates.email = emailMatch[0];

  // Nome
  const nomePatterns = [
    /(?:me chamo|meu nome é|sou o |sou a |pode me chamar de )\s*([A-ZÀ-Ú][a-zà-ú]+(?: [A-ZÀ-Ú][a-zà-ú]+){0,3})/i,
    /(?:^|\n)([A-ZÀ-Ú][a-zà-ú]+ [A-ZÀ-Ú][a-zà-ú]+)(?:\s*$)/m
  ];
  for (const pattern of nomePatterns) {
    const match = text.match(pattern);
    if (match && match[1].length > 3 && match[1].length < 50) {
      updates.nome = match[1].trim();
      break;
    }
  }

  // Tese de interesse
  const lower = text.toLowerCase();
  if (lower.includes('isenção') || lower.includes('isençao') || lower.includes('imposto de renda') || lower.includes('aposentad'))
    updates.tese_interesse = 'IR Isenção';
  else if (lower.includes('equiparação') || lower.includes('hospitalar') || lower.includes('clínica') || lower.includes('clinica'))
    updates.tese_interesse = 'Equiparação Hospitalar';
  else if (lower.includes('tea') || lower.includes('autis') || lower.includes('escola especial') || lower.includes('terapia') || lower.includes('tema 324'))
    updates.tese_interesse = 'TEA/Tema 324';
  else if (lower.includes('trabalhist') || lower.includes('demissão') || lower.includes('demissao') || lower.includes('rescisão'))
    updates.tese_interesse = 'Trabalhista';

  if (Object.keys(updates).length > 0) {
    try {
      await updateLead(leadId, updates);
      console.log(`[LEAD] Dados extraídos para ${leadId}:`, Object.keys(updates).join(', '));
    } catch (e) {
      console.error('[LEAD] Erro ao atualizar dados:', e.message);
    }
  }
}

// ===== MÉTRICAS =====

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
    console.log(`[METRIC] ${evento}: ${detalhes || ''}`);
  }
}

// ===== FOLLOW-UPS =====

async function getEligibleConversas() {
  const { data } = await supabase
    .from('conversas')
    .select('id, telefone, lead_id, leads(id, nome, tese_interesse, etapa_funil, telefone)')
    .eq('status', 'ativa')
    .eq('instancia', INST)
    .not('lead_id', 'is', null);

  if (!data) return [];

  return data.filter(c =>
    c.leads && c.leads.etapa_funil !== 'convertido' && c.leads.etapa_funil !== 'perdido'
  );
}

// ===== QUERIES DO CRM =====

async function listConversas(limit = 50) {
  const { data } = await supabase
    .from('conversas')
    .select('*, leads(nome, tese_interesse, etapa_funil)')
    .eq('instancia', INST)
    .order('criado_em', { ascending: false })
    .limit(limit);
  return data || [];
}

async function getConversaMensagens(conversaId) {
  const { data } = await supabase
    .from('mensagens')
    .select('*')
    .eq('conversa_id', conversaId)
    .order('criado_em', { ascending: true });
  return data || [];
}

async function getMetricas() {
  const { data: leads } = await supabase.from('leads').select('etapa_funil, criado_em').eq('instancia', INST);
  const etapas = { novo: 0, contato: 0, proposta: 0, convertido: 0, perdido: 0 };
  (leads || []).forEach(l => { if (etapas[l.etapa_funil] !== undefined) etapas[l.etapa_funil]++; });

  const { data: conversas } = await supabase.from('conversas').select('id, criado_em').eq('status', 'ativa').eq('instancia', INST);

  let eventos = [];
  try {
    const { data } = await supabase.from('metricas').select('evento, criado_em').order('criado_em', { ascending: false }).limit(100);
    eventos = data || [];
  } catch {}

  return {
    leads_por_etapa: etapas,
    total_leads: (leads || []).length,
    conversas_ativas: (conversas || []).length,
    followups_24h: eventos.filter(e => e.evento === 'followup_24h').length,
    followups_72h: eventos.filter(e => e.evento === 'followup_72h').length,
    leads_quentes: eventos.filter(e => e.evento === 'lead_quente').length,
    taxa_conversao: (leads || []).length > 0
      ? ((etapas.convertido / (leads || []).length) * 100).toFixed(1) + '%'
      : '0%'
  };
}

// ===== TAREFAS =====

async function createTarefa(tarefa) {
  try {
    const { data, error } = await supabase
      .from('tarefas')
      .insert(tarefa)
      .select()
      .single();

    if (error) {
      console.error('[TAREFA] Erro ao criar:', error.message);
      return null;
    }
    console.log(`[TAREFA] Criada: ${tarefa.descricao}`);
    return data;
  } catch (e) {
    console.error('[TAREFA] Erro:', e.message);
    return null;
  }
}

// ===== CLIENTES (busca por telefone) =====

async function findClienteByPhone(phone) {
  const { cleanPhone } = require('./whatsapp');
  const tel = cleanPhone(phone);
  const { data } = await supabase
    .from('clientes')
    .select('*')
    .eq('telefone', tel)
    .limit(1)
    .single();
  return data;
}

async function findCasoByCliente(clienteId) {
  const { data } = await supabase
    .from('casos')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('criado_em', { ascending: false })
    .limit(1)
    .single();
  return data;
}

// ===== CONTEXTO COMPLETO DO TELEFONE (para a Ana) =====

async function getContextoCompleto(phone) {
  const { cleanPhone } = require('./whatsapp');
  const tel = cleanPhone(phone);

  // 1. Verificar se já é cliente
  const { data: cliente } = await supabase
    .from('clientes')
    .select('*')
    .eq('telefone', tel)
    .limit(1)
    .single();

  if (!cliente) return { tipo: 'lead', cliente: null, casos: [], tarefas: [], financeiro: [] };

  // 2. Buscar casos do cliente
  const { data: casos } = await supabase
    .from('casos')
    .select('*')
    .eq('cliente_id', cliente.id)
    .order('criado_em', { ascending: false });

  // 3. Buscar tarefas pendentes dos casos
  const casoIds = (casos || []).map(c => c.id);
  let tarefas = [];
  if (casoIds.length > 0) {
    const { data: t } = await supabase
      .from('tarefas')
      .select('*')
      .in('caso_id', casoIds)
      .eq('status', 'pendente')
      .order('data_limite', { ascending: true })
      .limit(5);
    tarefas = t || [];
  }

  // 4. Buscar financeiro pendente
  const { data: financeiro } = await supabase
    .from('financeiro')
    .select('*')
    .eq('cliente_id', cliente.id)
    .in('status', ['pendente', 'atrasado'])
    .order('data_vencimento', { ascending: true })
    .limit(5);

  return {
    tipo: 'cliente',
    cliente,
    casos: casos || [],
    tarefas,
    financeiro: financeiro || []
  };
}

// ===== RELATÓRIO SEMANAL =====

async function getRelatorioSemanal() {
  const agora = new Date();
  const semanaAtras = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000);
  const semanaAtrasISO = semanaAtras.toISOString();

  // Leads novos na semana
  const { data: leadsNovos } = await supabase
    .from('leads')
    .select('id, nome, tese_interesse, etapa_funil')
    .eq('instancia', INST)
    .gte('criado_em', semanaAtrasISO);

  // Leads convertidos na semana
  const convertidos = (leadsNovos || []).filter(l => l.etapa_funil === 'convertido');

  // Cobranças atrasadas
  const { data: cobrancas } = await supabase
    .from('financeiro')
    .select('id, valor, data_vencimento, cliente_id')
    .eq('status', 'atrasado');

  const totalAtrasado = (cobrancas || []).reduce((s, f) => s + (f.valor || 0), 0);

  // Tarefas vencidas
  const { data: tarefasVencidas } = await supabase
    .from('tarefas')
    .select('id, descricao, data_limite')
    .eq('status', 'pendente')
    .lt('data_limite', agora.toISOString().slice(0, 10));

  // Agendamentos (tarefas criadas com "Consulta" na semana)
  const { data: agendamentos } = await supabase
    .from('tarefas')
    .select('id, descricao')
    .gte('criado_em', semanaAtrasISO)
    .ilike('descricao', '%consulta%');

  // Total leads ativos no funil
  const { data: leadsAtivos } = await supabase
    .from('leads')
    .select('id')
    .eq('instancia', INST)
    .not('etapa_funil', 'in', '("convertido","perdido")');

  // Financeiro recebido na semana
  const { data: recebidos } = await supabase
    .from('financeiro')
    .select('id, valor')
    .eq('status', 'pago')
    .gte('data_pagamento', semanaAtrasISO.slice(0, 10));

  const totalRecebido = (recebidos || []).reduce((s, f) => s + (f.valor || 0), 0);

  return {
    leadsNovos: (leadsNovos || []).length,
    convertidos: convertidos.length,
    agendamentos: (agendamentos || []).length,
    cobrancasAtrasadas: (cobrancas || []).length,
    totalAtrasado,
    tarefasVencidas: (tarefasVencidas || []).length,
    leadsAtivos: (leadsAtivos || []).length,
    totalRecebido
  };
}

// ===== ARQUIVOS PESSOAIS =====

async function listarArquivos(limit = 10) {
  try {
    const { data } = await supabase
      .from('arquivos_pessoais')
      .select('*')
      .order('criado_em', { ascending: false })
      .limit(limit);
    return data || [];
  } catch (e) {
    return [];
  }
}

// ===== LEMBRETES =====

async function criarLembrete({ descricao, horario, recorrencia, telefone }) {
  try {
    const { data, error } = await supabase
      .from('lembretes')
      .insert({
        descricao,
        horario,
        recorrencia: recorrencia || null,
        telefone,
        ativo: true,
        instancia: INST
      })
      .select()
      .single();

    if (error) {
      console.error('[LEMBRETE] Erro ao criar:', error.message);
      return null;
    }
    console.log(`[LEMBRETE] Criado: "${descricao}" às ${horario}`);
    return data;
  } catch (e) {
    console.error('[LEMBRETE] Erro:', e.message);
    return null;
  }
}

async function getLembretesAtivos() {
  try {
    const { data } = await supabase
      .from('lembretes')
      .select('*')
      .eq('ativo', true)
      .eq('instancia', INST);
    return data || [];
  } catch (e) {
    return [];
  }
}

async function marcarLembreteEnviado(lembreteId, recorrencia) {
  try {
    if (recorrencia === 'diario') {
      // Lembrete diário: atualizar horário para amanhã
      const { data: lembrete } = await supabase.from('lembretes').select('horario').eq('id', lembreteId).single();
      if (lembrete) {
        const proximoHorario = new Date(lembrete.horario);
        proximoHorario.setDate(proximoHorario.getDate() + 1);
        await supabase.from('lembretes').update({ horario: proximoHorario.toISOString(), ultimo_envio: new Date().toISOString() }).eq('id', lembreteId);
      }
    } else if (recorrencia === 'semanal') {
      const { data: lembrete } = await supabase.from('lembretes').select('horario').eq('id', lembreteId).single();
      if (lembrete) {
        const proximoHorario = new Date(lembrete.horario);
        proximoHorario.setDate(proximoHorario.getDate() + 7);
        await supabase.from('lembretes').update({ horario: proximoHorario.toISOString(), ultimo_envio: new Date().toISOString() }).eq('id', lembreteId);
      }
    } else {
      // Lembrete único: desativar
      await supabase.from('lembretes').update({ ativo: false, ultimo_envio: new Date().toISOString() }).eq('id', lembreteId);
    }
  } catch (e) {
    console.error('[LEMBRETE] Erro ao atualizar:', e.message);
  }
}

async function listarLembretesDoUsuario(telefone) {
  try {
    const { cleanPhone } = require('./whatsapp');
    const tel = cleanPhone(telefone);
    const { data } = await supabase
      .from('lembretes')
      .select('*')
      .eq('ativo', true)
      .eq('instancia', INST)
      .order('horario', { ascending: true });
    return data || [];
  } catch (e) {
    return [];
  }
}

async function cancelarLembrete(lembreteId) {
  try {
    await supabase.from('lembretes').update({ ativo: false }).eq('id', lembreteId);
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  supabase,
  getOrCreateConversa,
  updateConversa,
  saveMessage,
  getHistory,
  getRecentMessages,
  getOrCreateLead,
  updateLead,
  markLeadHot,
  extractAndUpdateLead,
  trackEvent,
  getEligibleConversas,
  listConversas,
  getConversaMensagens,
  getMetricas,
  createTarefa,
  findClienteByPhone,
  findCasoByCliente,
  getContextoCompleto,
  getRelatorioSemanal,
  listarArquivos,
  criarLembrete,
  getLembretesAtivos,
  marcarLembreteEnviado,
  listarLembretesDoUsuario,
  cancelarLembrete
};
