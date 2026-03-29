// ===== INTEGRAÇÃO GOOGLE CALENDAR =====
const { google } = require('googleapis');

// Configurar autenticação com Service Account
function getCalendarClient() {
  const credentials = JSON.parse(process.env.GOOGLE_CALENDAR_CREDENTIALS || '{}');

  if (!credentials.client_email) {
    console.error('[CALENDAR] Credenciais não configuradas');
    return null;
  }

  const auth = new google.auth.JWT(
    credentials.client_email,
    null,
    credentials.private_key,
    ['https://www.googleapis.com/auth/calendar']
  );

  return google.calendar({ version: 'v3', auth });
}

// ID da agenda do Dr. Osmar
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'osmarnevesadvogado@gmail.com';

// Horário comercial (em horário de Belém)
const HORARIO_INICIO = 9;  // 9h
const HORARIO_FIM = 18;    // 18h
const DURACAO_CONSULTA = 60; // minutos
const TIMEZONE = 'America/Belem';
const UTC_OFFSET = -3; // Belém = UTC-3

// Obter hora atual em Belém
function agoraBelem() {
  const now = new Date();
  // Converter para horário de Belém
  const belemTime = new Date(now.getTime() + (UTC_OFFSET * 60 * 60 * 1000));
  return belemTime;
}

// Criar data em horário de Belém e retornar como UTC para a API
function criarDataBelem(ano, mes, dia, hora, minuto) {
  // Cria a data como se fosse UTC, depois ajusta para Belém
  const utcDate = new Date(Date.UTC(ano, mes, dia, hora - UTC_OFFSET, minuto, 0, 0));
  return utcDate;
}

// Buscar horários disponíveis nos próximos N dias úteis
async function getHorariosDisponiveis(diasParaFrente = 5) {
  const calendar = getCalendarClient();
  if (!calendar) {
    console.log('[CALENDAR] Client não disponível');
    return [];
  }

  try {
    // Hora atual em Belém
    const belemAgora = agoraBelem();
    const horaAtualBelem = belemAgora.getUTCHours();
    const diaAtualBelem = belemAgora.getUTCDay();

    console.log(`[CALENDAR] Hora Belém: ${horaAtualBelem}h, dia semana: ${diaAtualBelem}`);

    // Calcular data de início (em Belém)
    let inicioAno = belemAgora.getUTCFullYear();
    let inicioMes = belemAgora.getUTCMonth();
    let inicioDia = belemAgora.getUTCDate();

    // Se já passou do horário comercial ou é fim de semana, começar no próximo dia útil
    if (horaAtualBelem >= HORARIO_FIM) {
      inicioDia++;
    }

    // Encontrar os próximos N dias úteis
    const diasUteis = [];
    let tempDate = new Date(Date.UTC(inicioAno, inicioMes, inicioDia));

    while (diasUteis.length < diasParaFrente) {
      const dia = tempDate.getUTCDay();
      if (dia !== 0 && dia !== 6) { // Não é domingo(0) nem sábado(6)
        diasUteis.push({
          ano: tempDate.getUTCFullYear(),
          mes: tempDate.getUTCMonth(),
          dia: tempDate.getUTCDate(),
          diaSemana: dia
        });
      }
      tempDate.setUTCDate(tempDate.getUTCDate() + 1);
    }

    if (diasUteis.length === 0) {
      console.log('[CALENDAR] Nenhum dia útil encontrado');
      return [];
    }

    // Range para buscar no Google Calendar (em UTC)
    const primeiro = diasUteis[0];
    const ultimo = diasUteis[diasUteis.length - 1];
    const timeMin = criarDataBelem(primeiro.ano, primeiro.mes, primeiro.dia, HORARIO_INICIO, 0);
    const timeMax = criarDataBelem(ultimo.ano, ultimo.mes, ultimo.dia, HORARIO_FIM, 0);

    console.log(`[CALENDAR] Buscando eventos de ${timeMin.toISOString()} até ${timeMax.toISOString()}`);

    // Buscar eventos existentes no período
    const response = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      timeZone: TIMEZONE
    });

    const eventosOcupados = (response.data.items || []).map(ev => ({
      inicio: new Date(ev.start.dateTime || ev.start.date),
      fim: new Date(ev.end.dateTime || ev.end.date)
    }));

    console.log(`[CALENDAR] ${eventosOcupados.length} eventos encontrados no período`);

    // Hora real UTC agora (para filtrar slots passados)
    const utcAgora = new Date();

    // Gerar slots disponíveis
    const slots = [];
    for (const diaUtil of diasUteis) {
      for (let hora = HORARIO_INICIO; hora < HORARIO_FIM; hora++) {
        // Criar slot no horário de Belém convertido para UTC
        const slotInicio = criarDataBelem(diaUtil.ano, diaUtil.mes, diaUtil.dia, hora, 0);
        const slotFim = new Date(slotInicio.getTime() + DURACAO_CONSULTA * 60 * 1000);

        // Pular slots que já passaram
        if (slotInicio <= utcAgora) continue;

        // Verificar se conflita com algum evento
        const conflito = eventosOcupados.some(ev =>
          (slotInicio < ev.fim && slotFim > ev.inicio)
        );

        if (!conflito) {
          slots.push({
            inicio: slotInicio,
            fim: slotFim,
            label: formatarSlot(hora, diaUtil)
          });
        }
      }
    }

    console.log(`[CALENDAR] ${slots.length} slots disponíveis`);
    return slots;
  } catch (e) {
    console.error('[CALENDAR] Erro ao buscar horários:', e.message);
    return [];
  }
}

// Formatar slot para texto legível (usa dados de Belém diretamente)
function formatarSlot(hora, diaUtil) {
  const dias = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const nomeDia = dias[diaUtil.diaSemana];
  const dd = diaUtil.dia.toString().padStart(2, '0');
  const mm = (diaUtil.mes + 1).toString().padStart(2, '0');
  return `${nomeDia} (${dd}/${mm}) às ${hora}h`;
}

// Formatar slot a partir de Date (para funções que recebem Date)
function formatarSlotDate(data) {
  const belem = new Date(data.getTime() + (UTC_OFFSET * 60 * 60 * 1000));
  const dias = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const dia = dias[belem.getUTCDay()];
  const dd = belem.getUTCDate().toString().padStart(2, '0');
  const mm = (belem.getUTCMonth() + 1).toString().padStart(2, '0');
  const hora = belem.getUTCHours();
  return `${dia} (${dd}/${mm}) às ${hora}h`;
}

// Gerar sugestão de horários para a Ana usar na conversa
async function sugerirHorarios(quantidade = 3) {
  const slots = await getHorariosDisponiveis(5);

  if (slots.length === 0) {
    return {
      texto: 'No momento estou sem horários disponíveis essa semana. Posso te retornar quando abrir uma vaga?',
      slots: []
    };
  }

  // Pegar slots espalhados (manhã e tarde de dias diferentes)
  const selecionados = [];
  const diasUsados = new Set();

  for (const slot of slots) {
    const belemHora = new Date(slot.inicio.getTime() + (UTC_OFFSET * 60 * 60 * 1000)).getUTCHours();
    const periodo = belemHora < 12 ? 'manha' : 'tarde';
    const key = `${slot.label.split(')')[0]}-${periodo}`;

    if (!diasUsados.has(key) && selecionados.length < quantidade) {
      selecionados.push(slot);
      diasUsados.add(key);
    }
  }

  if (selecionados.length < quantidade) {
    for (const slot of slots) {
      if (!selecionados.includes(slot) && selecionados.length < quantidade) {
        selecionados.push(slot);
      }
    }
  }

  const opcoes = selecionados.map(s => s.label);
  let texto;
  if (opcoes.length === 1) {
    texto = `Tenho ${opcoes[0]} com o Dr. Osmar. Quer marcar?`;
  } else if (opcoes.length === 2) {
    texto = `Tenho ${opcoes[0]} ou ${opcoes[1]} com o Dr. Osmar. Qual prefere?`;
  } else {
    texto = `Tenho ${opcoes[0]}, ${opcoes[1]} ou ${opcoes[2]}. Qual fica melhor pra você?`;
  }

  return { texto, slots: selecionados };
}

// Criar evento na agenda
async function criarConsulta(nome, telefone, email, dataHora, formato = 'online') {
  const calendar = getCalendarClient();
  if (!calendar) return null;

  try {
    const inicio = new Date(dataHora);
    const fim = new Date(inicio);
    fim.setMinutes(fim.getMinutes() + DURACAO_CONSULTA);

    const descricao = [
      `Consulta - ${nome}`,
      `Telefone: ${telefone}`,
      email ? `Email: ${email}` : '',
      `Formato: ${formato}`,
      '',
      'Agendado automaticamente pela Ana (CRM Neves Advocacia)'
    ].filter(Boolean).join('\n');

    const evento = {
      summary: `Consulta - ${nome}`,
      description: descricao,
      start: {
        dateTime: inicio.toISOString(),
        timeZone: TIMEZONE
      },
      end: {
        dateTime: fim.toISOString(),
        timeZone: TIMEZONE
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 30 },
          { method: 'popup', minutes: 60 }
        ]
      }
    };

    const response = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      resource: evento
    });

    console.log(`[CALENDAR] Consulta criada: ${nome} em ${formatarSlotDate(inicio)}`);
    return {
      id: response.data.id,
      link: response.data.htmlLink,
      inicio: formatarSlotDate(inicio),
      formato
    };
  } catch (e) {
    console.error('[CALENDAR] Erro ao criar consulta:', e.message);
    return null;
  }
}

// Interpretar texto do lead para encontrar o slot mais próximo
async function encontrarSlot(textoLead) {
  const slots = await getHorariosDisponiveis(7);
  if (slots.length === 0) return null;

  const lower = textoLead.toLowerCase();

  // Mapear dias da semana
  const diasSemana = {
    'segunda': 1, 'terça': 2, 'quarta': 3, 'quinta': 4, 'sexta': 5,
    'seg': 1, 'ter': 2, 'qua': 3, 'qui': 4, 'sex': 5
  };

  // Detectar dia mencionado
  let diaAlvo = null;
  for (const [nome, num] of Object.entries(diasSemana)) {
    if (lower.includes(nome)) {
      diaAlvo = num;
      break;
    }
  }

  // Detectar "amanhã" ou "hoje"
  const belemAgora = agoraBelem();
  if (lower.includes('amanhã') || lower.includes('amanha')) {
    const amanha = new Date(belemAgora);
    amanha.setUTCDate(amanha.getUTCDate() + 1);
    diaAlvo = amanha.getUTCDay();
  }
  if (lower.includes('hoje')) {
    diaAlvo = belemAgora.getUTCDay();
  }

  // Detectar horário
  let horaAlvo = null;
  const horaMatch = lower.match(/(\d{1,2})\s*(?:h|hrs?|horas?)?/);
  if (horaMatch) {
    horaAlvo = parseInt(horaMatch[1]);
    if (horaAlvo < HORARIO_INICIO || horaAlvo >= HORARIO_FIM) horaAlvo = null;
  }

  // Detectar período
  if (lower.includes('manhã') || lower.includes('manha') || lower.includes('de manhã')) {
    horaAlvo = horaAlvo || 10;
  }
  if (lower.includes('tarde')) {
    horaAlvo = horaAlvo || 14;
  }

  // Filtrar slots pelo dia
  let candidatos = slots;
  if (diaAlvo !== null) {
    const filtrados = slots.filter(s => {
      const belem = new Date(s.inicio.getTime() + (UTC_OFFSET * 60 * 60 * 1000));
      return belem.getUTCDay() === diaAlvo;
    });
    if (filtrados.length > 0) candidatos = filtrados;
  }

  // Filtrar pelo horário mais próximo
  if (horaAlvo !== null && candidatos.length > 0) {
    candidatos.sort((a, b) => {
      const horaA = new Date(a.inicio.getTime() + (UTC_OFFSET * 60 * 60 * 1000)).getUTCHours();
      const horaB = new Date(b.inicio.getTime() + (UTC_OFFSET * 60 * 60 * 1000)).getUTCHours();
      return Math.abs(horaA - horaAlvo) - Math.abs(horaB - horaAlvo);
    });
  }

  return candidatos.length > 0 ? candidatos[0] : slots[0];
}

module.exports = {
  getHorariosDisponiveis,
  sugerirHorarios,
  criarConsulta,
  encontrarSlot,
  formatarSlot: formatarSlotDate
};
