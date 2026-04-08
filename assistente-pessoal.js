// ===== ASSISTENTE PESSOAL DO DR. OSMAR — V2 =====
// Modo pessoal: Ana vira assistente completa com memória, lembretes, análise e CRM.
// NÃO usa trimResponse — respostas completas, divididas em blocos de 4000 chars.

const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');
const db = require('./database');

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Você é a Ana, assistente pessoal do Dr. Osmar Neves, advogado em Belém/PA.
Você conversa diretamente com o Dr. Osmar pelo WhatsApp. Você NÃO está atendendo clientes.

═══════════════════════════════════
IDENTIDADE
═══════════════════════════════════
- Assistente de confiança, eficiente e proativa
- Tom informal mas profissional — como uma secretária executiva de confiança
- Pode usar "Dr. Osmar" ou "doutor"
- Sem emojis
- Respostas completas mas objetivas — ele é ocupado

═══════════════════════════════════
O QUE VOCÊ PODE FAZER
═══════════════════════════════════
1. FINANÇAS — Faturamento, cobranças, inadimplentes, pagamentos
2. AGENDA — Consultas do dia/semana, horários livres
3. CASOS — Status de processos, fases, prazos
4. TAREFAS — Pendências, prazos, tarefas vencidas
5. LEADS — Novos leads, leads quentes, conversão
6. RELATÓRIOS — Resumo semanal, métricas do escritório
7. ARQUIVOS — Listar arquivos salvos na gaveta, analisar documentos
8. LEMBRETES — Criar alarmes/lembretes que disparam no horário certo
9. MEMÓRIA — Lembrar informações pessoais, preferências, rotinas do doutor
10. GERAL — Dúvidas, brainstorming, elaboração de textos, qualquer assunto

═══════════════════════════════════
LEMBRETES
═══════════════════════════════════
Quando o Dr. Osmar pedir lembrete/alarme/aviso, OBRIGATORIAMENTE inclua este comando na resposta:

[LEMBRETE: descricao="texto" horario="HH:MM" recorrencia="diario|semanal|unico"]

Exemplos:
- "Me lembra 9h do remédio" → "Pronto, doutor. Te aviso todo dia às 9h. [LEMBRETE: descricao="Tomar remédio" horario="09:00" recorrencia="diario"]"
- "Me avisa 14h da reunião" → "Anotado. Te aviso às 14h. [LEMBRETE: descricao="Reunião" horario="14:00" recorrencia="unico"]"
- "Esqueci o remédio" → "Quer que eu te avise amanhã no horário certo? Se sim, me diz o horário."

Palavras que EXIGEM lembrete: lembra, lembrete, avisa, aviso, alarme, me acorda, não deixa eu esquecer, me cobra
Se disser "todo dia" → recorrencia="diario"
Se disser "toda semana" → recorrencia="semanal"
Se não especificar horário → PERGUNTE antes
Se disser que ESQUECEU algo → OFEREÇA criar lembrete

═══════════════════════════════════
MEMÓRIA
═══════════════════════════════════
Quando o Dr. Osmar compartilhar informações pessoais, preferências ou rotinas, salve usando:

[MEMORIA: chave="identificador" valor="informação" categoria="pessoal|saude|financeiro|rotina|trabalho"]

Exemplos:
- "Tomo antibiótico de 12 em 12h" → [MEMORIA: chave="medicamento_antibiotico" valor="Antibiótico de 12 em 12 horas" categoria="saude"]
- "Meu almoço é sempre meio-dia" → [MEMORIA: chave="horario_almoco" valor="Almoça ao meio-dia" categoria="rotina"]
- "O caso do João tem audiência dia 15" → [MEMORIA: chave="audiencia_joao" valor="Audiência do caso João dia 15" categoria="trabalho"]

REGRAS DA MEMÓRIA:
- Salve informações que podem ser úteis no futuro
- Use chaves descritivas e sem acentos
- A seção MEMÓRIAS na ficha mostra tudo que você já sabe sobre o Dr. Osmar
- Use as memórias para contextualizar suas respostas

═══════════════════════════════════
COMO RESPONDER
═══════════════════════════════════
- Se pedir dados do CRM → consulte a FICHA DE DADOS abaixo
- Se pedir análise de documento → o conteúdo vem junto na mensagem, analise em detalhes
- Se for conversa casual → responda naturalmente, com personalidade
- Se der informação pessoal → salve na memória E responda
- Seja proativa: "Vi que tem 3 tarefas vencidas" / "Seu lembrete das 9h está configurado"
- NUNCA invente dados financeiros ou de casos — use apenas o que está na ficha
- Se não tiver dados, diga "Vou verificar" (não invente)`;

// ===== CONSULTAR DADOS DO CRM + MEMÓRIAS =====
async function buildFichaDados() {
  const linhas = [];

  try {
    const metricas = await db.getMetricas();
    linhas.push('MÉTRICAS DO ESCRITÓRIO:');
    linhas.push(`- Total de leads: ${metricas.total_leads}`);
    linhas.push(`- Leads por etapa: Novos ${metricas.leads_por_etapa.novo} | Contato ${metricas.leads_por_etapa.contato} | Proposta ${metricas.leads_por_etapa.proposta} | Convertidos ${metricas.leads_por_etapa.convertido} | Perdidos ${metricas.leads_por_etapa.perdido}`);
    linhas.push(`- Conversas ativas: ${metricas.conversas_ativas}`);
    linhas.push(`- Taxa de conversão: ${metricas.taxa_conversao}`);
  } catch (e) {
    linhas.push('MÉTRICAS: Erro ao consultar');
  }

  try {
    const rel = await db.getRelatorioSemanal();
    linhas.push('\nRESUMO DA SEMANA:');
    linhas.push(`- Leads novos: ${rel.leadsNovos} | Convertidos: ${rel.convertidos} | Agendamentos: ${rel.agendamentos}`);
    linhas.push(`- Recebido: R$ ${rel.totalRecebido.toFixed(2)} | Cobranças atrasadas: ${rel.cobrancasAtrasadas} (R$ ${rel.totalAtrasado.toFixed(2)})`);
    linhas.push(`- Tarefas vencidas: ${rel.tarefasVencidas}`);
  } catch (e) {}

  try {
    const calendar = require('./calendar');
    const { slots } = await calendar.sugerirHorarios(5);
    if (slots && slots.length > 0) {
      linhas.push('\nAGENDA — PRÓXIMOS HORÁRIOS LIVRES:');
      slots.forEach(s => linhas.push(`- ${s.label}`));
    }
  } catch (e) {}

  try {
    const arquivos = await db.listarArquivos(5);
    if (arquivos && arquivos.length > 0) {
      linhas.push('\nÚLTIMOS ARQUIVOS SALVOS:');
      arquivos.forEach(a => {
        linhas.push(`- ${a.nome_original} (${a.tipo}) — ${new Date(a.criado_em).toLocaleDateString('pt-BR')}`);
      });
    }
  } catch (e) {}

  try {
    const lembretes = await db.listarLembretesDoUsuario(config.OSMAR_PHONE);
    if (lembretes && lembretes.length > 0) {
      linhas.push('\nLEMBRETES ATIVOS:');
      lembretes.forEach(l => {
        const hora = new Date(l.horario).toLocaleTimeString('pt-BR', { timeZone: 'America/Belem', hour: '2-digit', minute: '2-digit' });
        const tipo = l.recorrencia === 'diario' ? '(diário)' : l.recorrencia === 'semanal' ? '(semanal)' : '(único)';
        linhas.push(`- ${l.descricao} às ${hora} ${tipo}`);
      });
    }
  } catch (e) {}

  // MEMÓRIAS — o que a Ana já sabe sobre o Dr. Osmar
  try {
    const memorias = await db.buscarTodasMemorias();
    if (memorias && memorias.length > 0) {
      linhas.push('\nMEMÓRIAS (o que você já sabe sobre o Dr. Osmar):');
      const porCategoria = {};
      memorias.forEach(m => {
        const cat = m.categoria || 'geral';
        if (!porCategoria[cat]) porCategoria[cat] = [];
        porCategoria[cat].push(`${m.chave}: ${m.valor}`);
      });
      for (const [cat, items] of Object.entries(porCategoria)) {
        linhas.push(`  [${cat.toUpperCase()}]`);
        items.forEach(i => linhas.push(`  - ${i}`));
      }
    }
  } catch (e) {}

  return linhas.join('\n');
}

// ===== GERAR RESPOSTA NO MODO PESSOAL =====
async function generateResponse(history, userMessage) {
  const fichaDados = await buildFichaDados();

  const recentHistory = history.slice(-(config.MAX_HISTORY || 20))
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, content: m.content }));

  const fichaCompleta = `===== FICHA DE DADOS (CRM + MEMÓRIAS) =====
${fichaDados}
=============================================

Mensagem do Dr. Osmar: "${userMessage}"

Responda com base nos dados e memórias acima. Use o que sabe para contextualizar.
Se ele pedir lembrete, INCLUA o comando [LEMBRETE: ...] na resposta.
Se ele compartilhar informação pessoal/rotina, INCLUA o comando [MEMORIA: ...] na resposta.`;

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

  // Max tokens: 4096 para documentos, 1024 para modo pessoal normal
  const isDocumento = userMessage.includes('CONTEÚDO DO DOCUMENTO');
  const maxTokens = isDocumento ? 4096 : 1024;

  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const response = await anthropic.messages.create({
        model: config.CLAUDE_MODEL,
        max_tokens: maxTokens,
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
