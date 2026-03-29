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
    instrucao: `ETAPA ATUAL: SAUDAÇÃO
Seu objetivo agora: entender por que a pessoa está entrando em contato.
- Cumprimente de forma calorosa e curta
- Pergunte como pode ajudar (se a pessoa não disse ainda)
- Se a pessoa já disse o problema, pule direto para qualificação
- NÃO peça nome/email ainda, é cedo demais`,

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
    instrucao: `ETAPA ATUAL: QUALIFICAÇÃO
Seu objetivo agora: entender os detalhes do problema da pessoa.
- Faça UMA pergunta por vez sobre a situação específica
- Use as palavras que a pessoa usou (se falou "escola", fale "escola")
- Entenda: quem é afetado, há quanto tempo, qual a situação atual
- Quando tiver entendido o problema, mostre que tem solução
- Agora sim peça o NOME se ainda não tem`,

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
    instrucao: `ETAPA ATUAL: PROPOSTA DE VALOR
Seu objetivo agora: mostrar que o Dr. Osmar resolve isso e gerar urgência.
- Diga em 1 frase que tem solução pro caso da pessoa
- Use gatilho: "Caso parecido deu muito certo" ou "Cada mês sem resolver é dinheiro perdido"
- Peça o EMAIL se ainda não tem
- Se já tem nome e email, proponha dia e horário para consulta
- Exemplo: "Que tal quarta às 14h com o Dr. Osmar? Pode ser online se preferir"`,

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
    instrucao: `ETAPA ATUAL: AGENDAMENTO
Seu objetivo agora: confirmar dia, horário e formato da consulta.
- Confirme o dia e horário escolhido
- Pergunte se prefere presencial (Belém/PA) ou online
- Se a pessoa pediu e você ainda não tem email, peça agora
- Confirme tudo: "Perfeito! Consulta marcada pra [dia] às [hora], [formato]. O Dr. Osmar vai te atender!"
- Depois da confirmação, diga que vai enviar os detalhes`,

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
function getInstrucaoEtapa(conversaId) {
  const etapa = getEtapa(conversaId);
  return FLUXO[etapa]?.instrucao || FLUXO[ETAPAS.SAUDACAO].instrucao;
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
