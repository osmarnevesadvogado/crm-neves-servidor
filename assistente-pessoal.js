// ===== ASSISTENTE PESSOAL DO DR. OSMAR =====
// Quando a mensagem vem do número do Dr. Osmar, a Ana muda de modo:
// Em vez de recepcionista de leads, vira assistente pessoal com acesso total ao CRM.

const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');
const db = require('./database');

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Você é a Ana, assistente pessoal do Dr. Osmar Neves, advogado em Belém/PA.
Aqui você NÃO está atendendo clientes — está conversando diretamente com o Dr. Osmar pelo WhatsApp.

IDENTIDADE:
- Assistente de confiança, eficiente e direta
- Tom informal mas profissional — como uma secretária executiva de anos
- Pode usar "Dr. Osmar" ou "doutor" ao se dirigir a ele
- Sem emojis
- Respostas objetivas — ele é ocupado

O QUE VOCÊ PODE FAZER:
1. FINANÇAS — Consultar faturamento, cobranças, inadimplentes, pagamentos recebidos
2. AGENDA — Consultas do dia, da semana, horários livres
3. CASOS — Status de casos ativos, processos, fases
4. TAREFAS — Pendências, prazos, tarefas vencidas
5. LEADS — Novos leads, leads quentes, taxa de conversão
6. RELATÓRIOS — Resumo semanal, métricas do escritório
7. ARQUIVOS — Listar e buscar arquivos salvos na gaveta pessoal
8. LEMBRETES — Criar lembretes que disparam no horário certo via WhatsApp
9. ORGANIZAÇÃO — Criar tarefas, anotações
10. GERAL — Tirar dúvidas, brainstorming, ideias, qualquer assunto

LEMBRETES — COMO FUNCIONA:
Quando o Dr. Osmar pedir um lembrete, responda com o comando especial entre colchetes:
[LEMBRETE: descricao="texto do lembrete" horario="HH:MM" recorrencia="diario|semanal|unico"]

Exemplos:
- "Me lembra de tomar remédio às 8h" → Responda normalmente E inclua: [LEMBRETE: descricao="Tomar remédio" horario="08:00" recorrencia="diario"]
- "Me avisa sexta às 14h da reunião" → [LEMBRETE: descricao="Reunião" horario="14:00" recorrencia="unico"]
- "Lembrete todo dia às 7h pra fazer exercício" → [LEMBRETE: descricao="Fazer exercício" horario="07:00" recorrencia="diario"]
- "Me lembra toda segunda de revisar os casos" → [LEMBRETE: descricao="Revisar casos" horario="09:00" recorrencia="semanal"]

REGRAS DOS LEMBRETES:
- SEMPRE inclua o comando [LEMBRETE: ...] quando o Dr. Osmar pedir lembrete/alarme/aviso
- Se ele não especificar o horário, pergunte
- Se não disser se é recorrente, assuma "unico"
- Se disser "todo dia" ou "diariamente", use recorrencia="diario"
- Se disser "toda semana" ou "toda segunda/terça/etc", use recorrencia="semanal"
- A seção LEMBRETES ATIVOS na ficha mostra os lembretes já configurados

COMO RESPONDER:
- Se ele pedir dados do CRM, consulte a FICHA DE DADOS abaixo
- Se não tiver a informação na ficha, diga que vai verificar
- Se for conversa casual ou dúvida geral, responda naturalmente
- Sempre ofereça ação: "Quer que eu crie uma tarefa para isso?" / "Posso verificar os detalhes"
- Se ele enviar arquivo/foto, confirme que foi salvo na gaveta

REGRAS:
- NUNCA invente dados financeiros ou de casos — use apenas o que está na FICHA DE DADOS
- Se não tiver dados, diga "Vou verificar no sistema" (não invente)
- Seja proativa: "Vi que tem 3 tarefas vencidas, quer que eu liste?"
- Mantenha respostas curtas no WhatsApp (3-4 frases max)`;

// ===== CONSULTAR DADOS DO CRM PARA O DR. OSMAR =====
async function buildFichaDados() {
  const linhas = [];

  try {
    // Métricas gerais
    const metricas = await db.getMetricas();
    linhas.push('MÉTRICAS DO ESCRITÓRIO:');
    linhas.push(`- Total de leads: ${metricas.total_leads}`);
    linhas.push(`- Leads por etapa: Novos ${metricas.leads_por_etapa.novo} | Contato ${metricas.leads_por_etapa.contato} | Proposta ${metricas.leads_por_etapa.proposta} | Convertidos ${metricas.leads_por_etapa.convertido} | Perdidos ${metricas.leads_por_etapa.perdido}`);
    linhas.push(`- Conversas ativas: ${metricas.conversas_ativas}`);
    linhas.push(`- Taxa de conversão: ${metricas.taxa_conversao}`);
    linhas.push(`- Leads quentes recentes: ${metricas.leads_quentes}`);
  } catch (e) {
    linhas.push('MÉTRICAS: Erro ao consultar');
  }

  try {
    // Relatório semanal
    const rel = await db.getRelatorioSemanal();
    linhas.push('\nRESUMO DA SEMANA:');
    linhas.push(`- Leads novos: ${rel.leadsNovos}`);
    linhas.push(`- Convertidos: ${rel.convertidos}`);
    linhas.push(`- Agendamentos: ${rel.agendamentos}`);
    linhas.push(`- Recebido: R$ ${rel.totalRecebido.toFixed(2)}`);
    linhas.push(`- Cobranças atrasadas: ${rel.cobrancasAtrasadas} (R$ ${rel.totalAtrasado.toFixed(2)})`);
    linhas.push(`- Tarefas vencidas: ${rel.tarefasVencidas}`);
  } catch (e) {
    linhas.push('RELATÓRIO SEMANAL: Erro ao consultar');
  }

  try {
    // Agenda do dia e da semana
    const calendar = require('./calendar');
    const { slots } = await calendar.sugerirHorarios(5);
    if (slots && slots.length > 0) {
      linhas.push('\nAGENDA — PRÓXIMOS HORÁRIOS LIVRES:');
      slots.forEach(s => linhas.push(`- ${s.label}`));
    }
  } catch (e) {
    // Calendar pode não estar disponível
  }

  try {
    // Arquivos recentes
    const arquivos = await db.listarArquivos(5);
    if (arquivos && arquivos.length > 0) {
      linhas.push('\nÚLTIMOS ARQUIVOS SALVOS:');
      arquivos.forEach(a => {
        linhas.push(`- ${a.nome_original} (${a.tipo}) — ${new Date(a.criado_em).toLocaleDateString('pt-BR')}`);
      });
    }
  } catch (e) {
    // Tabela pode não existir ainda
  }

  try {
    // Lembretes ativos
    const lembretes = await db.listarLembretesDoUsuario(config.OSMAR_PHONE);
    if (lembretes && lembretes.length > 0) {
      linhas.push('\nLEMBRETES ATIVOS:');
      lembretes.forEach(l => {
        const hora = new Date(l.horario).toLocaleTimeString('pt-BR', { timeZone: 'America/Belem', hour: '2-digit', minute: '2-digit' });
        const tipo = l.recorrencia === 'diario' ? '(diário)' : l.recorrencia === 'semanal' ? '(semanal)' : '(único)';
        linhas.push(`- ${l.descricao} às ${hora} ${tipo}`);
      });
    }
  } catch (e) {
    // Tabela pode não existir ainda
  }

  return linhas.join('\n');
}

// ===== GERAR RESPOSTA NO MODO PESSOAL =====
async function generateResponse(history, userMessage) {
  const fichaDados = await buildFichaDados();

  const recentHistory = history.slice(-(config.MAX_HISTORY || 20))
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, content: m.content }));

  const fichaCompleta = `===== FICHA DE DADOS (CRM REAL) =====
${fichaDados}
=====================================

Mensagem do Dr. Osmar: "${userMessage}"

Responda com base nos dados acima. Se a pergunta não for sobre dados do CRM, responda normalmente como assistente.`;

  const messages = [...recentHistory, { role: 'user', content: fichaCompleta }];

  // Garantir alternância de roles
  const cleanMessages = [];
  for (const msg of messages) {
    const prev = cleanMessages[cleanMessages.length - 1];
    if (prev && prev.role === msg.role) {
      prev.content += '\n' + msg.content;
    } else {
      cleanMessages.push({ ...msg });
    }
  }
  if (cleanMessages.length > 0 && cleanMessages[0].role !== 'user') {
    cleanMessages.unshift({ role: 'user', content: 'Oi Ana' });
  }

  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const response = await anthropic.messages.create({
        model: config.CLAUDE_MODEL,
        max_tokens: userMessage.includes('CONTEÚDO DO DOCUMENTO') ? 4096 : 1024,
        system: SYSTEM_PROMPT,
        messages: cleanMessages
      });
      return response.content[0].text;
    } catch (e) {
      console.error(`[PESSOAL] Erro (tentativa ${tentativa}/2):`, e.message);
      if (tentativa < 2) await new Promise(r => setTimeout(r, 2000));
    }
  }

  return 'Dr. Osmar, estou com uma instabilidade momentanea. Tente novamente em alguns segundos.';
}

module.exports = {
  generateResponse,
  buildFichaDados
};
