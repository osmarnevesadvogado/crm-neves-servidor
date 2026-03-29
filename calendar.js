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

// Horário comercial
const HORARIO_INICIO = 9;  // 9h
const HORARIO_FIM = 18;    // 18h
const DURACAO_CONSULTA = 60; // minutos

// Buscar horários disponíveis nos próximos N dias úteis
async function getHorariosDisponiveis(diasParaFrente = 5) {
  const calendar = getCalendarClient();
  if (!calendar) return [];

  try {
    // Calcular range de datas (pular fim de semana)
    const agora = new Date();
    const inicio = new Date(agora);
    inicio.setHours(0, 0, 0, 0);

    // Se já passou do horário comercial, começar amanhã
    if (agora.getHours() >= HORARIO_FIM) {
      inicio.setDate(inicio.getDate() + 1);
    }

    // Encontrar os próximos N dias úteis
    const diasUteis = [];
    const temp = new Date(inicio);
    while (diasUteis.length < diasParaFrente) {
      const dia = temp.getDay();
      if (dia !== 0 && dia !== 6) { // Não é domingo(0) nem sábado(6)
        diasUteis.push(new Date(temp));
      }
      temp.setDate(temp.getDate() + 1);
    }

    const fimBusca = new Date(diasUteis[diasUteis.length - 1]);
    fimBusca.setHours(23, 59, 59);

    // Buscar eventos existentes no período
    const response = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: inicio.toISOString(),
      timeMax: fimBusca.toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    });

    const eventosOcupados = (response.data.items || []).map(ev => ({
      inicio: new Date(ev.start.dateTime || ev.start.date),
      fim: new Date(ev.end.dateTime || ev.end.date)
    }));

    // Gerar slots disponíveis
    const slots = [];
    for (const dia of diasUteis) {
      for (let hora = HORARIO_INICIO; hora < HORARIO_FIM; hora++) {
        const slotInicio = new Date(dia);
        slotInicio.setHours(hora, 0, 0, 0);

        const slotFim = new Date(slotInicio);
        slotFim.setMinutes(slotFim.getMinutes() + DURACAO_CONSULTA);

        // Pular slots que já passaram
        if (slotInicio <= agora) continue;

        // Verificar se conflita com algum evento
        const conflito = eventosOcupados.some(ev =>
          (slotInicio < ev.fim && slotFim > ev.inicio)
        );

        if (!conflito) {
          slots.push({
            inicio: slotInicio,
            fim: slotFim,
            label: formatarSlot(slotInicio)
          });
        }
      }
    }

    return slots;
  } catch (e) {
    console.error('[CALENDAR] Erro ao buscar horários:', e.message);
    return [];
  }
}

// Formatar slot para texto legível
function formatarSlot(data) {
  const dias = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const dia = dias[data.getDay()];
  const dd = data.getDate().toString().padStart(2, '0');
  const mm = (data.getMonth() + 1).toString().padStart(2, '0');
  const hora = data.getHours();
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

  // Priorizar variedade de dias e horários
  for (const slot of slots) {
    const diaKey = slot.inicio.toDateString();
    const periodo = slot.inicio.getHours() < 12 ? 'manha' : 'tarde';
    const key = `${diaKey}-${periodo}`;

    if (!diasUsados.has(key) && selecionados.length < quantidade) {
      selecionados.push(slot);
      diasUsados.add(key);
    }
  }

  // Se não conseguiu variedade suficiente, completar com os próximos
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
        timeZone: 'America/Belem'
      },
      end: {
        dateTime: fim.toISOString(),
        timeZone: 'America/Belem'
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

    console.log(`[CALENDAR] Consulta criada: ${nome} em ${formatarSlot(inicio)}`);
    return {
      id: response.data.id,
      link: response.data.htmlLink,
      inicio: formatarSlot(inicio),
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
  const agora = new Date();
  if (lower.includes('amanhã') || lower.includes('amanha')) {
    const amanha = new Date(agora);
    amanha.setDate(amanha.getDate() + 1);
    diaAlvo = amanha.getDay();
  }
  if (lower.includes('hoje')) {
    diaAlvo = agora.getDay();
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
    horaAlvo = horaAlvo || 10; // Default manhã
  }
  if (lower.includes('tarde')) {
    horaAlvo = horaAlvo || 14; // Default tarde
  }

  // Filtrar slots pelo dia
  let candidatos = slots;
  if (diaAlvo !== null) {
    candidatos = slots.filter(s => s.inicio.getDay() === diaAlvo);
  }

  // Filtrar pelo horário mais próximo
  if (horaAlvo !== null && candidatos.length > 0) {
    candidatos.sort((a, b) =>
      Math.abs(a.inicio.getHours() - horaAlvo) - Math.abs(b.inicio.getHours() - horaAlvo)
    );
  }

  return candidatos.length > 0 ? candidatos[0] : slots[0];
}

module.exports = {
  getHorariosDisponiveis,
  sugerirHorarios,
  criarConsulta,
  encontrarSlot,
  formatarSlot
};
