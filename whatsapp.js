// ===== INTEGRAÇÃO Z-API (WhatsApp) =====
const config = require('./config');

// Controle de envios recentes da IA (para distinguir de mensagens manuais)
const recentBotSends = new Map();

// Limpar telefone para formato padrão (5591999999999)
function cleanPhone(phone) {
  if (!phone) return null;
  let p = phone.replace(/\D/g, '');
  if (p.startsWith('55') && p.length >= 12) return p;
  if (p.length === 11) return '55' + p;
  if (p.length === 10) return '55' + p;
  return p;
}

// Registrar que a IA acabou de enviar mensagem
function markBotSent(phone) {
  recentBotSends.set(cleanPhone(phone), Date.now());
}

// Verificar se a IA enviou mensagem nos últimos 30 segundos
function wasBotRecentSend(phone) {
  const ts = recentBotSends.get(cleanPhone(phone));
  if (!ts) return false;
  return (Date.now() - ts) < 30000;
}

// Enviar mensagem de texto pelo WhatsApp
async function sendText(phone, text) {
  try {
    const res = await fetch(`${config.ZAPI_BASE}/send-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Client-Token': config.ZAPI_CLIENT_TOKEN },
      body: JSON.stringify({ phone: cleanPhone(phone), message: text })
    });
    const json = await res.json();
    console.log('[ZAPI] Mensagem enviada:', phone);
    markBotSent(phone);
    return json;
  } catch (e) {
    console.error('[ZAPI] Erro ao enviar:', e.message);
    return null;
  }
}

// Notificar Dr. Osmar via WhatsApp sobre lead quente
async function notifyHotLead(leadName, phone, trigger) {
  const msg = `🔥 LEAD QUENTE!\n\n${leadName} (${phone}) demonstrou interesse alto.\n\nFrase: "${trigger}"\n\nResponda rápido ou a IA continua o atendimento.`;
  try {
    await fetch(`${config.ZAPI_BASE}/send-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Client-Token': config.ZAPI_CLIENT_TOKEN },
      body: JSON.stringify({ phone: config.OSMAR_PHONE, message: msg })
    });
    console.log(`[HOT] Notificação enviada para Dr. Osmar sobre ${leadName}`);
  } catch (e) {
    console.error('[HOT] Erro ao notificar:', e.message);
  }
}

// Limpeza periódica (chamada pelo server.js)
function cleanup() {
  const now = Date.now();
  for (const [phone, ts] of recentBotSends) {
    if (now - ts > 120000) recentBotSends.delete(phone);
  }
}

module.exports = {
  cleanPhone,
  markBotSent,
  wasBotRecentSend,
  sendText,
  notifyHotLead,
  cleanup
};
