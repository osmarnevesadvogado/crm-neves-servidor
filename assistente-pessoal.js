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
8. ORGANIZAÇÃO — Criar tarefas, lembretes, anotações
9. GERAL — Tirar dúvidas, brainstorming, ideias, qualquer assunto

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
        max_tokens: userMessage.includes('CONTEÚDO DO DOCUMENTO') ? 2000 : config.MAX_TOKENS,
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
