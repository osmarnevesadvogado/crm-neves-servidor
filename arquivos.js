// ===== GAVETA DE ARQUIVOS DO DR. OSMAR =====
// Recebe arquivos (fotos, PDFs, planilhas) via WhatsApp e salva no Supabase Storage
// Bucket: "gaveta-osmar" | Tabela de controle: "arquivos_pessoais"

const config = require('./config');
const { supabase } = require('./database');

const BUCKET = 'gaveta-osmar';

// Tipos de arquivo suportados
const TIPOS = {
  'image/jpeg': { ext: 'jpg', tipo: 'foto' },
  'image/png': { ext: 'png', tipo: 'foto' },
  'image/webp': { ext: 'webp', tipo: 'foto' },
  'application/pdf': { ext: 'pdf', tipo: 'documento' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: 'xlsx', tipo: 'planilha' },
  'application/vnd.ms-excel': { ext: 'xls', tipo: 'planilha' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: 'docx', tipo: 'documento' },
  'application/msword': { ext: 'doc', tipo: 'documento' },
  'text/plain': { ext: 'txt', tipo: 'documento' },
  'text/csv': { ext: 'csv', tipo: 'planilha' },
  'video/mp4': { ext: 'mp4', tipo: 'video' },
  'audio/mpeg': { ext: 'mp3', tipo: 'audio' },
  'audio/ogg': { ext: 'ogg', tipo: 'audio' }
};

// ===== GARANTIR QUE O BUCKET EXISTE =====
async function ensureBucket() {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    const exists = (buckets || []).some(b => b.name === BUCKET);
    if (!exists) {
      await supabase.storage.createBucket(BUCKET, { public: false });
      console.log(`[ARQUIVOS] Bucket "${BUCKET}" criado`);
    }
  } catch (e) {
    console.error('[ARQUIVOS] Erro ao verificar bucket:', e.message);
  }
}

// Inicializar bucket na carga do módulo
ensureBucket();

// ===== BAIXAR ARQUIVO DA URL (Z-API) =====
async function downloadFile(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const buffer = Buffer.from(await response.arrayBuffer());
    return { buffer, contentType };
  } catch (e) {
    console.error('[ARQUIVOS] Erro ao baixar:', e.message);
    return null;
  }
}

// ===== SALVAR ARQUIVO NO SUPABASE =====
async function salvarArquivo(url, nomeOriginal, descricao) {
  const download = await downloadFile(url);
  if (!download) return null;

  const { buffer, contentType } = download;
  const tipoInfo = TIPOS[contentType] || { ext: 'bin', tipo: 'outro' };

  // Gerar nome único: YYYY-MM-DD_HHmmss_nome.ext
  const agora = new Date();
  const timestamp = agora.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const nomeClean = (nomeOriginal || 'arquivo')
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .slice(0, 50);
  const nomeStorage = `${timestamp}_${nomeClean}.${tipoInfo.ext}`;
  const path = `${tipoInfo.tipo}/${nomeStorage}`;

  try {
    // Upload para Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType,
        upsert: false
      });

    if (uploadError) {
      console.error('[ARQUIVOS] Erro no upload:', uploadError.message);
      return null;
    }

    // Registrar na tabela de controle
    try {
      await supabase.from('arquivos_pessoais').insert({
        nome_original: nomeOriginal || 'arquivo',
        nome_storage: nomeStorage,
        path_storage: path,
        tipo: tipoInfo.tipo,
        content_type: contentType,
        tamanho_bytes: buffer.length,
        descricao: descricao || null,
        bucket: BUCKET
      });
    } catch (e) {
      // Tabela pode não existir — o arquivo já foi salvo no storage
      console.log('[ARQUIVOS] Tabela arquivos_pessoais não disponível, arquivo salvo apenas no storage');
    }

    console.log(`[ARQUIVOS] Salvo: ${path} (${(buffer.length / 1024).toFixed(1)} KB)`);

    return {
      path,
      nome: nomeOriginal || 'arquivo',
      tipo: tipoInfo.tipo,
      tamanho: buffer.length
    };
  } catch (e) {
    console.error('[ARQUIVOS] Erro ao salvar:', e.message);
    return null;
  }
}

// ===== LISTAR ARQUIVOS =====
async function listarArquivos(limit = 10) {
  try {
    const { data } = await supabase
      .from('arquivos_pessoais')
      .select('*')
      .order('criado_em', { ascending: false })
      .limit(limit);
    return data || [];
  } catch (e) {
    // Fallback: listar direto do storage
    try {
      const tipos = ['foto', 'documento', 'planilha', 'video', 'audio', 'outro'];
      const todos = [];
      for (const tipo of tipos) {
        const { data } = await supabase.storage.from(BUCKET).list(tipo, { limit: limit, sortBy: { column: 'created_at', order: 'desc' } });
        if (data) todos.push(...data.map(f => ({ ...f, tipo })));
      }
      return todos.slice(0, limit);
    } catch (e2) {
      return [];
    }
  }
}

// ===== BUSCAR ARQUIVOS POR TIPO =====
async function buscarPorTipo(tipo, limit = 10) {
  try {
    const { data } = await supabase
      .from('arquivos_pessoais')
      .select('*')
      .eq('tipo', tipo)
      .order('criado_em', { ascending: false })
      .limit(limit);
    return data || [];
  } catch (e) {
    return [];
  }
}

// ===== GERAR URL TEMPORÁRIA DE DOWNLOAD =====
async function getDownloadUrl(path, expiresIn = 3600) {
  try {
    const { data } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, expiresIn);
    return data?.signedUrl || null;
  } catch (e) {
    return null;
  }
}

module.exports = {
  salvarArquivo,
  listarArquivos,
  buscarPorTipo,
  getDownloadUrl,
  BUCKET
};
