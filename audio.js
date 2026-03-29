// ===== MÓDULO DE ÁUDIO =====
// Transcrição (Whisper) e Geração de Voz (TTS) via OpenAI
const config = require('./config');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const os = require('os');

let openaiClient = null;

function getClient() {
  if (!openaiClient) {
    if (!config.OPENAI_API_KEY) {
      console.error('[AUDIO] OPENAI_API_KEY não configurada');
      return null;
    }
    openaiClient = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  }
  return openaiClient;
}

// ===== TRANSCREVER ÁUDIO (Whisper) =====
// Recebe URL do áudio (vinda da Z-API), baixa e transcreve
async function transcreverAudio(audioUrl) {
  const client = getClient();
  if (!client) return null;

  let tempFile = null;

  try {
    console.log('[AUDIO] Baixando áudio:', audioUrl.slice(0, 80));

    // Baixar o áudio da URL
    const response = await fetch(audioUrl);
    if (!response.ok) throw new Error(`Erro ao baixar áudio: ${response.status}`);

    const buffer = Buffer.from(await response.arrayBuffer());

    // Salvar temporariamente (Whisper precisa de arquivo)
    tempFile = path.join(os.tmpdir(), `audio_${Date.now()}.ogg`);
    fs.writeFileSync(tempFile, buffer);

    console.log('[AUDIO] Enviando para Whisper...');

    // Transcrever com Whisper
    const transcription = await client.audio.transcriptions.create({
      file: fs.createReadStream(tempFile),
      model: 'whisper-1',
      language: 'pt',
      response_format: 'text'
    });

    const texto = transcription.trim();
    console.log(`[AUDIO] Transcrito: "${texto.slice(0, 100)}"`);
    return texto;

  } catch (e) {
    console.error('[AUDIO] Erro na transcrição:', e.message);
    return null;
  } finally {
    // Limpar arquivo temporário
    if (tempFile) {
      try { fs.unlinkSync(tempFile); } catch {}
    }
  }
}

// ===== GERAR ÁUDIO DA RESPOSTA (TTS) =====
// Recebe texto da Ana, retorna base64 do áudio MP3
async function gerarAudio(texto) {
  const client = getClient();
  if (!client) return null;

  try {
    // Limitar texto para evitar áudios muito longos
    const textoLimitado = texto.slice(0, 500);

    console.log('[AUDIO] Gerando voz para:', textoLimitado.slice(0, 60));

    const response = await client.audio.speech.create({
      model: 'tts-1',
      voice: 'nova', // Voz feminina, natural, boa para português
      input: textoLimitado,
      response_format: 'mp3',
      speed: 1.0
    });

    // Converter para base64
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    console.log('[AUDIO] Áudio gerado com sucesso');
    return `data:audio/mpeg;base64,${base64}`;

  } catch (e) {
    console.error('[AUDIO] Erro ao gerar áudio:', e.message);
    return null;
  }
}

module.exports = {
  transcreverAudio,
  gerarAudio
};
