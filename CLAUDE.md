# CRM Neves Advocacia - Servidor da Ana

## O que é este projeto

Servidor Node.js da **Ana**, assistente virtual do Dr. Osmar Neves (advogado em Belém/PA).
A Ana roda no WhatsApp Business via Z-API e usa Claude Sonnet 4.6 como IA.

## Arquitetura

| Arquivo | Função |
|---------|--------|
| `server.js` | Webhook principal, roteamento, follow-ups, agendamento automático |
| `ia.js` | System prompt da Ana (modo atendimento), geração de respostas |
| `assistente-pessoal.js` | Modo assistente pessoal do Dr. Osmar (prompt + lógica) |
| `fluxo.js` | Máquina de estados: saudação → qualificação → proposta → agendamento → pós |
| `database.js` | Supabase: conversas, leads, mensagens, métricas (filtrado por `instancia='ana'`) |
| `arquivos.js` | Gaveta de arquivos: upload para Supabase Storage + extração de texto (PDF, DOCX, XLSX) |
| `calendar.js` | Google Calendar: horários disponíveis, criar consultas |
| `audio.js` | OpenAI Whisper (transcrição) + TTS voz "nova" |
| `whatsapp.js` | Z-API: envio de texto e áudio |
| `config.js` | Configuração central, variáveis de ambiente |

## Dois modos de operação

### 1. Modo Atendimento (leads/clientes)
- Qualquer número que NÃO seja o do Dr. Osmar
- Ana atua como recepcionista, qualifica leads e agenda consultas
- Fluxo: saudação → qualificação → proposta → agendamento
- Follow-ups automáticos em 4 etapas (2h, 4h, 24h, 72h)
- Detecção de lead quente com alerta ao Dr. Osmar

### 2. Modo Assistente Pessoal (Dr. Osmar)
- Mensagens do número pessoal do Dr. Osmar (`OSMAR_PHONE`)
- Ana vira assistente pessoal com acesso ao CRM (finanças, agenda, casos, leads)
- Recebe e salva arquivos na gaveta (bucket `gaveta-osmar` no Supabase Storage)
- Lê e analisa documentos (PDF, DOCX, XLSX, CSV, TXT) — até 100K caracteres (~200 pgs)
- Max tokens para análises: 4096

## Detecção do número do Dr. Osmar

A função `isOsmar()` compara os **últimos 8 dígitos** do telefone, porque a Z-API às vezes
omite o 9º dígito dos celulares brasileiros (envia `559180955419` em vez de `5591980955419`).

## Supabase compartilhado com a Laura

**IMPORTANTE:** A Ana e a Laura (assistente trabalhista, servidor `servidor-npl`) compartilham
o **mesmo Supabase**. Para não misturar dados:

- Todas as queries da Ana filtram por `instancia = 'ana'`
- Novos registros em `conversas` e `leads` são criados com `instancia = 'ana'`
- A Laura usa dados com `instancia = NULL` ou outro valor
- **NUNCA remova o filtro de instância** — senão a Ana vai ler/escrever nos dados da Laura

## Segurança

- Todas as chaves vêm de variáveis de ambiente (`.env` / Render)
- Webhook Z-API autenticado via header `z-api-token` (validado contra `ZAPI_TOKEN`)
- Rotas administrativas protegidas por `ADMIN_TOKEN` (middleware `requireAdmin`)
- CORS restrito a origens em `CORS_ORIGINS`
- `.gitignore` protege `.env`, credenciais, `node_modules`
- Variáveis obrigatórias validadas na inicialização (falha rápido)

## Variáveis de ambiente no Render

```
ANTHROPIC_API_KEY    - Chave da API Claude
OPENAI_API_KEY       - Chave OpenAI (Whisper + TTS)
SUPABASE_URL         - URL do Supabase
SUPABASE_KEY         - Chave do Supabase (anon)
ZAPI_INSTANCE_ID     - ID da instância Z-API (CRMAGENTE)
ZAPI_TOKEN           - Token da instância Z-API
ZAPI_CLIENT_TOKEN    - Token de segurança da conta Z-API
ZAPI_WEBHOOK_TOKEN   - Mesmo valor do ZAPI_CLIENT_TOKEN
OSMAR_PHONE          - Número pessoal do Dr. Osmar (5591980955419)
ADMIN_TOKEN          - Token para rotas administrativas
GOOGLE_CALENDAR_CREDENTIALS - Credenciais do Google Calendar (JSON)
GOOGLE_CALENDAR_ID   - ID do calendário do Dr. Osmar
```

## Tabelas Supabase usadas pela Ana

- `conversas` — com coluna `instancia` (TEXT)
- `leads` — com coluna `instancia` (TEXT)
- `mensagens` — vinculadas a conversas
- `metricas` — eventos de tracking
- `tarefas` — tarefas automáticas
- `clientes` — clientes existentes
- `casos` — processos jurídicos
- `financeiro` — pagamentos e cobranças
- `arquivos_pessoais` — registro de arquivos na gaveta

## Storage Supabase

- Bucket: `gaveta-osmar` (privado)
- Organizado por tipo: `foto/`, `documento/`, `planilha/`, `video/`, `audio/`
- RLS: precisa de policy para `anon` role com acesso ao bucket

## Regras para desenvolvimento

1. **SEMPRE criar PR novo** para qualquer alteração — nunca push direto na main
2. **NUNCA remover filtro `instancia = 'ana'`** das queries do database.js
3. **NUNCA hardcodar** telefones, chaves ou dados sensíveis no código
4. **Testar no Render** — verificar logs após deploy para garantir que não quebrou
5. **Roles do Claude API**: só aceita `user` e `assistant` — nunca `system` em mensagens
6. O webhook valida token via header `z-api-token` (é o token da instância Z-API)
7. PDF usa `pdf-parse@1.1.1` (v1) — a v2 tem API incompatível
8. Mensagens longas no WhatsApp devem ser divididas em blocos de 4000 chars
9. Branch padrão para desenvolvimento: `claude/nome-da-feature`

## Z-API

- Instância: CRMAGENTE
- Webhook "Ao receber": `https://crm-neves-servidor.onrender.com/webhook/zapi`
- "Notificar as enviadas por mim também": ATIVADO (necessário para detectar msgs manuais)
- O token da instância é enviado no header `z-api-token` automaticamente

## Deploy

- Hospedado no **Render** (Web Service)
- URL: `https://crm-neves-servidor.onrender.com`
- Deploy automático ao fazer push/merge na `main`
- Node.js 22.x
