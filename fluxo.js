// ===== FLUXO DE CONVERSA (Máquina de Estados) =====
// Etapas: saudacao → qualificacao → proposta → agendamento → pos_agendamento
//
// Cada etapa define:
//   - O que a Ana deve focar
//   - Condições para avançar para a próxima etapa
//   - Instruções específicas para o prompt

const config = require('./config');
const { ETAPAS } = config;

// Estado das conversas em memória (etapa atual)
// Persistido no campo 'etapa_conversa' da tabela conversas (via database.js)
const conversaEtapas = new Map();

// Definição de cada etapa do fluxo
const FLUXO = {
  [ETAPAS.SAUDACAO]: {
    instrucao: `ETAPA: SAUDAÇÃO
Cumprimente e descubra o assunto. Se a pessoa JÁ disse o assunto, mostre que entendeu e pergunte um detalhe. Não enrole.`,

    avanca: (text, lead) => {
      // Avança quando identificamos o assunto/problema
      const lower = text.toLowerCase();
      const temas = ['isenção', 'isençao', 'imposto', 'aposentad', 'equiparação', 'hospitalar',
        'clínica', 'clinica', 'tea', 'autis', 'escola', 'terapia', 'trabalhist',
        'demissão', 'demissao', 'rescisão', 'pensão', 'pensao', 'dúvida', 'duvida',
        'problema', 'ajuda', 'preciso', 'quero', 'consulta', 'advogado'];
      return temas.some(t => lower.includes(t));
    },
    proxima: ETAPAS.QUALIFICACAO
  },

  [ETAPAS.QUALIFICACAO]: {
    instrucao: `ETAPA: QUALIFICAÇÃO
Você já sabe o assunto. Agora: faça 1 pergunta para entender o caso + peça o NOME se não tem.
Use as palavras da pessoa. Mostre que tem solução: "Isso o Dr. Osmar resolve, já pegamos casos assim."
Máximo 2 trocas de mensagem aqui, depois já proponha agendar.`,

    avanca: (text, lead) => {
      // Avança quando temos o nome e já falamos sobre o problema
      if (lead && lead.nome && !lead.nome.startsWith('WhatsApp')) {
        return true;
      }
      // Ou se o lead demonstrou interesse claro
      const lower = text.toLowerCase();
      return lower.includes('como funciona') || lower.includes('quanto custa') ||
             lower.includes('como faz') || lower.includes('quero saber mais');
    },
    proxima: ETAPAS.PROPOSTA
  },

  [ETAPAS.PROPOSTA]: {
    instrucao: `ETAPA: PROPOSTA — AGENDE AGORA!
Chame pelo NOME. Diga: "Vou consultar a agenda do Dr. Osmar pra te encaixar..."
Peça o EMAIL se não tem. Se já tem nome e email, PROPONHA HORÁRIO IMEDIATO.
Use urgência: "Ainda tem vaga essa semana" / "Cada mês sem resolver é dinheiro perdido".
NÃO faça mais perguntas sobre o problema. O momento é de AGENDAR.`,

    avanca: (text, lead) => {
      // Avança quando mencionam dia/horário ou aceitam agendar
      const lower = text.toLowerCase();
      const sinaisAgendamento = ['pode ser', 'vamos', 'quero agendar', 'marca', 'agenda',
        'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'amanhã', 'hoje',
        'de manhã', 'à tarde', 'horário', 'bora', 'fechado', 'combinado'];
      return sinaisAgendamento.some(s => lower.includes(s));
    },
    proxima: ETAPAS.AGENDAMENTO
  },

  [ETAPAS.AGENDAMENTO]: {
    instrucao: '', // Preenchido dinamicamente com horários reais via getInstrucaoAgendamento()
    instrucaoDinamica: true, // Flag para indicar que precisa de dados do calendar

    avanca: (text, lead) => {
      // Avança quando a consulta foi confirmada
      const lower = text.toLowerCase();
      return lower.includes('ok') || lower.includes('combinado') || lower.includes('fechado') ||
             lower.includes('perfeito') || lower.includes('confirmado') || lower.includes('pode ser') ||
             lower.includes('online') || lower.includes('presencial');
    },
    proxima: ETAPAS.POS_AGENDAMENTO
  },

  [ETAPAS.POS_AGENDAMENTO]: {
    instrucao: `ETAPA ATUAL: PÓS-AGENDAMENTO
A consulta já foi agendada. Seu objetivo agora:
- Seja simpática e disponível
- Se perguntarem algo, responda normalmente
- Se quiserem remarcar, ajude
- Não tente vender de novo, a pessoa já é cliente
- Finalize com: "Qualquer dúvida antes da consulta, me chama aqui!"`,

    avanca: () => false, // Etapa final, não avança
    proxima: null
  }
};

// Obter a etapa atual de uma conversa
function getEtapa(conversaId) {
  return conversaEtapas.get(conversaId) || ETAPAS.SAUDACAO;
}

// Definir etapa (usado ao carregar do banco)
function setEtapa(conversaId, etapa) {
  if (FLUXO[etapa]) {
    conversaEtapas.set(conversaId, etapa);
  }
}

// Processar transição de etapa com base na mensagem do lead
function processarEtapa(conversaId, text, lead) {
  const etapaAtual = getEtapa(conversaId);
  const fluxo = FLUXO[etapaAtual];

  if (!fluxo) return etapaAtual;

  // Verificar se deve avançar
  if (fluxo.avanca(text, lead) && fluxo.proxima) {
    const novaEtapa = fluxo.proxima;
    conversaEtapas.set(conversaId, novaEtapa);
    console.log(`[FLUXO] ${conversaId}: ${etapaAtual} → ${novaEtapa}`);
    return novaEtapa;
  }

  return etapaAtual;
}

// Obter a instrução do prompt para a etapa atual
// Para etapa de agendamento, usa horários reais (async)
async function getInstrucaoEtapa(conversaId, horariosTexto) {
  const etapa = getEtapa(conversaId);
  const fluxo = FLUXO[etapa];

  if (!fluxo) return FLUXO[ETAPAS.SAUDACAO].instrucao;

  // Etapa de agendamento: injetar horários reais
  if (fluxo.instrucaoDinamica && horariosTexto) {
    return `ETAPA ATUAL: AGENDAMENTO
Seu objetivo agora: confirmar dia, horário e formato da consulta.

HORÁRIOS DISPONÍVEIS DO DR. OSMAR (consulte a agenda real):
${horariosTexto}

- Ofereça 2 ou 3 desses horários para a pessoa escolher
- Pergunte se prefere presencial (Belém/PA) ou online
- Se ainda não tem email, peça agora
- Quando confirmar: "Perfeito! Consulta marcada pra [dia] às [hora], [formato]. O Dr. Osmar vai te atender!"
- NUNCA invente horários, use SOMENTE os listados acima`;
  }

  return fluxo.instrucao || FLUXO[ETAPAS.SAUDACAO].instrucao;
}

// Limpar cache de conversas antigas (chamado periodicamente)
function cleanup() {
  if (conversaEtapas.size > 500) {
    const keys = [...conversaEtapas.keys()];
    // Remover as 200 mais antigas
    keys.slice(0, 200).forEach(k => conversaEtapas.delete(k));
  }
}

module.exports = {
  getEtapa,
  setEtapa,
  processarEtapa,
  getInstrucaoEtapa,
  cleanup,
  FLUXO
};
