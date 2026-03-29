// ===== CONFIGURAÇÃO CENTRAL =====
// Todas as variáveis de ambiente e constantes do projeto

require('dotenv').config();

module.exports = {
  // Anthropic (Claude)
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  CLAUDE_MODEL: 'claude-haiku-4-5-20251001',
  MAX_TOKENS: 200,

  // Supabase
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_KEY: process.env.SUPABASE_KEY,

  // Z-API (WhatsApp)
  ZAPI_INSTANCE: process.env.ZAPI_INSTANCE_ID,
  ZAPI_TOKEN: process.env.ZAPI_TOKEN,
  ZAPI_CLIENT_TOKEN: process.env.ZAPI_CLIENT_TOKEN,
  ZAPI_WEBHOOK_TOKEN: process.env.ZAPI_WEBHOOK_TOKEN,
  get ZAPI_BASE() {
    return `https://api.z-api.io/instances/${this.ZAPI_INSTANCE}/token/${this.ZAPI_TOKEN}`;
  },

  // Telefone do Dr. Osmar para notificações
  OSMAR_PHONE: process.env.OSMAR_PHONE || '5591981018757',

  // Buffer de mensagens
  BUFFER_DELAY: 8000, // 8 segundos

  // Rate limit
  RATE_LIMIT_MAX: 30, // requests por minuto

  // Palavras que indicam lead quente
  HOT_LEAD_KEYWORDS: [
    'quero agendar', 'quero marcar', 'como faço pra contratar', 'quero contratar',
    'quanto custa', 'qual o valor', 'vamos agendar', 'pode marcar', 'tenho interesse',
    'quero consulta', 'me agenda', 'fecha pra mim', 'vamos fechar', 'pode ser amanhã',
    'pode ser segunda', 'pode ser terça', 'pode ser quarta', 'pode ser quinta', 'pode ser sexta',
    'qual horário', 'horário disponível', 'quero sim', 'vamos lá', 'bora',
    'tô precisando', 'preciso muito', 'urgente', 'me ajuda com isso'
  ],

  // Etapas do fluxo de conversa
  ETAPAS: {
    SAUDACAO: 'saudacao',
    QUALIFICACAO: 'qualificacao',
    PROPOSTA: 'proposta',
    AGENDAMENTO: 'agendamento',
    POS_AGENDAMENTO: 'pos_agendamento'
  },

  // Servidor
  PORT: process.env.PORT || 3000,
  RENDER_URL: process.env.RENDER_EXTERNAL_URL
};
