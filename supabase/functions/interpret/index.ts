// Edge Function `interpret` — NLU de comandos de voz (fase 4).
//
// Contrato (RN-123): el modelo NUNCA calcula fechas absolutas; devuelve
// estructuras relativas que el cliente resuelve con el core y la timezone
// del tenant contra capturedAt. RN-095: el payload contiene solo el
// transcript — jamás notas clínicas ni la lista de pacientes.
//
// Secretos requeridos:  npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// Modelo: claude-haiku-4-5 (decisión D-4: extracción estructurada de baja
// latencia). Se puede sobreescribir con el secreto ANTHROPIC_MODEL.
import Anthropic from 'npm:@anthropic-ai/sdk';

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-haiku-4-5';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

const SYSTEM = `Eres el intérprete de comandos de voz de VoiceScheduler, una agenda de citas
para profesionales de salud en Guatemala. Los comandos llegan en español.
Tu única salida es una llamada a la herramienta register_intent.

Reglas de fechas (obligatorias):
- NUNCA calcules fechas absolutas. Devuelve estructuras relativas; el backend las resuelve.
- weekday usa ISO: 1=lunes, 2=martes, 3=miércoles, 4=jueves, 5=viernes, 6=sábado, 7=domingo.
- "el miércoles" → {type:"next_weekday", weekday:3}. "mañana" → {type:"tomorrow"}.
- "el otro lunes" / "el lunes de la otra semana" → {type:"weekday_after_next", weekday:1}.
- "el 15" → {type:"day_of_current_month", day:15}. "esta semana" → {type:"current_week"}.
- "hoy" → {type:"today"}.

Reglas de horas:
- Devuelve hour tal como se dijo. Si dicen "a las 3" sin am/pm y hour < 12,
  marca ambiguousAmPm=true y deja hour=3. El backend resuelve con el horario laboral.
- "de la tarde"/"pm" → hour en 24h (3 de la tarde = 15) y ambiguousAmPm=false.
- "de la mañana"/"am" → hour tal cual y ambiguousAmPm=false.

Intenciones:
- schedule: agendar cita. Requiere patientName, date y time. Si mencionan duración o
  "domicilio"/"a su casa" (mode=home_visit), inclúyelo.
  · Series (RN-070): si el comando implica repetición ("lunes y jueves a las 3,
    12 sesiones", "todas las semanas"), llena recurrence.weekdays (ISO) y
    recurrence.sessions. date es la fecha de inicio SOLO si la mencionan; si no
    dicen cuántas sesiones, agrégalo a missing y pregúntalo en followupQuestion.
- cancel: cancelar una cita identificable (patientName y, si lo dicen, date).
- reschedule: mover una cita. La cita original se identifica con patientName+date;
  el destino va en newDate/newTime.
- query: consulta de solo lectura. queryVariant:
  · "¿qué tengo mañana?" / "¿cómo está mi semana?" → schedule (con date correspondiente)
  · "¿quiénes me faltan hoy?" / "pendientes de hoy" → pending_today
  · "¿quiénes tengo mañana?" → pending_tomorrow
  · "¿qué me queda esta semana?" → pending_week
  · "¿quién no ha pagado?" / "cobros pendientes" → unpaid (con date del periodo si lo dicen)
- block: bloquear tiempo. "todo el día" o "es feriado" → block.allDay=true.
  Rango explícito ("de 12 a 2") → timeFrom/timeTo. Aproximaciones aceptadas:
  "en la mañana" → 09:00-12:00, "en la tarde" → 14:00-18:00. Incluye reason si la dicen
  ("almuerzo", "trámite").
- unknown: el enunciado no corresponde a ninguna intención de agenda.

Slot-filling (conversación multi-turno):
- Si faltan datos obligatorios para la intención, lista sus nombres en missing y escribe
  followupQuestion: UNA pregunta breve y natural en español (ej. "¿Qué día y a qué hora?").
- Si el mensaje incluye una intención parcial previa, fusiónala con el nuevo enunciado
  y devuelve la intención completa acumulada.

confidence: número entre 0 y 1 con tu certeza de la interpretación completa.`;

const relativeDateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: {
      type: 'string',
      enum: ['today', 'tomorrow', 'next_weekday', 'weekday_after_next', 'day_of_current_month', 'current_week'],
    },
    weekday: { type: 'integer', description: 'ISO 1=lunes..7=domingo. Solo para next_weekday y weekday_after_next.' },
    day: { type: 'integer', description: 'Día del mes 1-31. Solo para day_of_current_month.' },
  },
  required: ['type'],
};

const spokenTimeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    hour: { type: 'integer', description: 'Hora 0-23 tal como se dijo (o convertida si dijeron tarde/pm).' },
    minute: { type: 'integer', description: 'Minutos 0-59. 0 si no se mencionan.' },
    ambiguousAmPm: { type: 'boolean', description: 'true si no queda claro si es AM o PM.' },
  },
  required: ['hour', 'minute', 'ambiguousAmPm'],
};

const intentTool = {
  name: 'register_intent',
  description: 'Registra la intención estructurada interpretada del comando de voz.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      intent: { type: 'string', enum: ['schedule', 'cancel', 'reschedule', 'query', 'block', 'unknown'] },
      confidence: { type: 'number', description: 'Certeza de 0 a 1.' },
      patientName: { type: 'string', description: 'Nombre del paciente tal como se dictó.' },
      date: relativeDateSchema,
      time: spokenTimeSchema,
      durationMinutes: { type: 'integer', description: 'Duración en minutos si se menciona.' },
      mode: { type: 'string', enum: ['in_clinic', 'home_visit'] },
      queryVariant: {
        type: 'string',
        enum: ['schedule', 'pending_today', 'pending_tomorrow', 'pending_week', 'unpaid'],
      },
      newDate: relativeDateSchema,
      newTime: spokenTimeSchema,
      recurrence: {
        type: 'object',
        additionalProperties: false,
        properties: {
          weekdays: {
            type: 'array',
            items: { type: 'integer' },
            description: 'Días de la semana ISO: 1=lunes..7=domingo.',
          },
          sessions: { type: 'integer', description: 'Número total de sesiones si se menciona.' },
        },
        required: ['weekdays'],
      },
      block: {
        type: 'object',
        additionalProperties: false,
        properties: {
          allDay: { type: 'boolean' },
          timeFrom: spokenTimeSchema,
          timeTo: spokenTimeSchema,
          reason: { type: 'string' },
        },
        required: ['allDay'],
      },
      missing: { type: 'array', items: { type: 'string' } },
      followupQuestion: { type: 'string', description: 'Pregunta breve en español si faltan datos.' },
    },
    required: ['intent', 'confidence'],
  },
} as const;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  try {
    const { transcript, context } = await req.json();
    if (typeof transcript !== 'string' || transcript.trim().length === 0) {
      return json({ error: 'transcript requerido' }, 400);
    }

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

    const userMessage = context
      ? `Intención parcial previa (fusiónala con el nuevo enunciado):\n${JSON.stringify(context)}\n\nNuevo enunciado: "${transcript.trim()}"`
      : `Comando: "${transcript.trim()}"`;

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools: [intentTool],
      tool_choice: { type: 'tool', name: 'register_intent' },
      messages: [{ role: 'user', content: userMessage }],
    });

    const toolUse = message.content.find((block) => block.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      return json({ intent: 'unknown', confidence: 0 });
    }
    return json(toolUse.input);
  } catch (error) {
    console.error('interpret error', error);
    return json({ error: error instanceof Error ? error.message : 'error interno' }, 500);
  }
});
