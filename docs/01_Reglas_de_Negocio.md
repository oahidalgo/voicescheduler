# VoiceScheduler — Reglas de Negocio (v5)

> Documento normativo del dominio. Cada regla tiene un identificador (RN-xxx) para
> trazabilidad hacia tickets y casos de prueba. Las reglas marcadas **[config]** son
> configurables por tenant; las marcadas **[core]** son invariantes del sistema.

---

## 1. Visión y Etapas del Producto

**VoiceScheduler** es una aplicación móvil de agendamiento de citas con entrada dual
(voz + táctil), diseñada para profesionales de salud y servicios que gestionan su agenda.

### 1.1 Las tres etapas

| Etapa | Usuario activo | Qué se construye |
|---|---|---|
| **V1** | El profesional (la esposa) | App móvil completa: voz + táctil, todas las operaciones de agenda |
| **V2** | Sus pacientes | Portal web de auto-agendamiento (link directo, sin instalar nada); app móvil no cambia |
| **V3** | Otros negocios (venta personal) | Múltiples profesionales por tenant, onboarding guiado, app stores públicos |

**Principio rector:** la app móvil es la herramienta del *profesional*. El portal web
es la herramienta del *paciente*. Nunca al revés.

**Principio de reutilización:** toda regla específica de fisioterapia se expresa como
*configuración del tenant*, nunca como código. V3 suma plantillas de industria, no
reescrituras.

### 1.2 Industrias objetivo (validación de generalidad)

| Negocio | Particularidad que estresa el modelo |
|---|---|
| Fisioterapia (V1) | Recurrencia semanal, domicilios, múltiples pacientes simultáneos en clínica |
| Psicología | 1 paciente por profesional, duración fija estricta, sin domicilios |
| Dental | Tipos de cita con duraciones distintas (limpieza 30 min, endodoncia 90 min) |
| Tutorías | 100 % recurrente, modalidad virtual, un solo alumno por sesión |
| Salón de belleza | Múltiples profesionales independientes, granularidad de 15 min |

---

## 2. Actores

| Actor | V1 | V2 | V3 |
|---|---|---|---|
| **Profesional** | Único usuario. Agenda, cancela, reagenda y consulta por voz o pantalla. Administra pacientes y configuración. | Igual | Uno o más por tenant; cada uno con calendario propio |
| **Paciente** | Pasivo. Sin interacción con el sistema. | Auto-agenda vía portal web | Igual |
| **Asistente** | — | — | Permisos limitados: sin acceso a configuración ni borrado de pacientes |
| **Admin de plataforma** | El desarrollador: crea tenants manualmente | Igual | Panel de gestión de tenants |

**RN-001 [core]** — Todo dato y toda operación pertenecen a exactamente un tenant.
Ninguna consulta cruza tenants salvo el admin de plataforma.

**RN-002 [core]** — Roles: `owner`, `professional`, `assistant`, `platform_admin`.
En V1 el owner es también el único profesional. El campo `role` existe en el modelo
de datos desde V1 para no requerir migración en V3.

---

## 3. Glosario del Dominio

| Término | Definición |
|---|---|
| **Tenant** | Un negocio. Posee configuración, profesionales, pacientes y citas. |
| **Profesional** | Persona que atiende pacientes. Tiene citas asignadas y un horario laboral. En V1, el tenant tiene exactamente un profesional. |
| **Cita** | Compromiso de atención entre un profesional y un paciente, con inicio, duración, modalidad y estado. |
| **Slot** | Intervalo de tiempo disponible derivado del horario laboral. Se calcula, no se persiste. |
| **Modalidad** | Forma de atención: `in_clinic`, `home_visit` (y `virtual` reservado para V2). |
| **Serie** | Conjunto de citas generadas por una regla de recurrencia para el mismo paciente y profesional. |
| **Excepción de calendario** | Bloqueo o modificación puntual del horario: feriado, vacaciones, almuerzo, salida temprana. |
| **Buffer** | Tiempo no agendable antes o después de una cita. Invisible al paciente. Absorbe traslados o limpieza. |
| **Cita pendiente** | Cita con estado `scheduled` cuyo inicio aún no ha ocurrido, o que ya pasó sin ser marcada como `completed` o `no_show`. |
| **Intención** | Acción estructurada derivada de un comando de voz: `schedule`, `cancel`, `reschedule`, `query`, `block`. |

---

## 4. Alcance de V1

V1 es **completa para su único usuario**. No es un MVP recortado: es el producto
terminado para el caso de uso del profesional gestionando su propia agenda.

### Capacidades incluidas

| Capacidad | Por voz | Por táctil |
|---|---|---|
| Agendar cita individual | ✅ "Agenda a Luis el miércoles a las 3" | ✅ Formulario en calendario |
| Agendar serie recurrente | ✅ "Agenda a Luis lunes y jueves a las 3, 12 sesiones" | ✅ Formulario con recurrencia |
| Cancelar cita | ✅ "Cancela la de Luis del miércoles" | ✅ Tap en cita → cancelar |
| Reagendar cita | ✅ "Mueve la de Luis al jueves a las 4" | ✅ Editar cita |
| Consultar agenda del día / semana | ✅ "¿Qué tengo mañana?" | ✅ Vista día / semana |
| Consultar pacientes pendientes | ✅ "¿Quiénes me faltan hoy?" | ✅ Vista filtrada por estado |
| Bloquear tiempo | ✅ "Bloquéame el viernes en la tarde" | ✅ Crear excepción de calendario |
| Crear paciente al agendar | ✅ Implícito si el nombre no existe | ✅ Formulario rápido |
| Editar paciente | — | ✅ Nombre, teléfono, email, notas |
| Marcar cita como completada o no-show | — | ✅ Tap en cita → estado |
| Marcar cita como pagada / no pagada | — | ✅ Tap en cita → toggle de pago |
| Consultar citas con pago pendiente | ✅ "¿Quién no ha pagado hoy?" | ✅ Filtro en lista y calendario |
| Vista de calendario con bloques de citas | — | ✅ Vista día y semana con slots visuales |
| Configurar horarios y notificaciones | — | ✅ Pantalla de configuración |
| Recordatorio push pre-cita | — | ✅ Al profesional, N min antes |
| Resumen push mañana y tarde | — | ✅ Dos bloques diarios al profesional |

### Capacidades deliberadamente fuera de V1

| Funcionalidad | Razón | Versión |
|---|---|---|
| Notificaciones a pacientes (email, WhatsApp, push) | Los pacientes no interactúan con el sistema en V1 | V2 |
| Confirmación de cita por el paciente | Sin canal de comunicación con pacientes en V1 | V2 |
| Portal web de auto-agendamiento | Requiere auth de pacientes + UI web completa | V2 |
| Dashboard web y métricas visuales | La profesional opera desde el móvil | V2 |
| Demo mode para portafolio | Requiere infraestructura defensiva adicional | V2 |
| Múltiples profesionales por tenant | Calendarios y capacidades independientes por profesional | V3 |
| Onboarding self-service de tenants | Las ventas son personales; el dev crea el tenant manualmente | V3 |
| Tipos de cita con duraciones distintas | Dental y otros; no aplica a fisioterapia V1 | V2 |
| Modalidad virtual | Tutorías, psicología online | V2 |
| Pagos | No es core de agenda | V3 |

---

## 5. Pacientes

**RN-090 [core]** — El único campo obligatorio de un paciente es el **nombre**. Teléfono,
email, dirección y notas son siempre opcionales y pueden agregarse o editarse en cualquier
momento, incluso después de tener citas agendadas.

**RN-091 [core] — Sin fricción al agendar:** el flujo de agendamiento (voz o táctil)
nunca solicita ni requiere teléfono o email, aunque el paciente no los tenga registrados.
La cita se crea con solo el nombre del paciente.

**RN-092 [core] — Creación implícita:** si al agendar el nombre no coincide con ningún
paciente existente, el sistema crea el registro con ese nombre en el mismo flujo, sin
interrumpir la operación. La tarjeta de confirmación indica que se creará el paciente
junto con la cita. Ver RN-122 para el manejo de coincidencias parciales.

**RN-093 [core]** — Dos pacientes pueden tener el mismo nombre. La desambiguación usa
contexto disponible: teléfono si está registrado, última cita reciente, o selección
explícita del profesional.

**RN-094 [core] — Soft delete:** un paciente con historial de citas nunca se elimina
físicamente. Se marca como `deleted_at`, desaparece de búsquedas activas y de la lista
de autocompletado, pero sus citas históricas se preservan para métricas.

**RN-095 [core] — Datos sensibles:** las notas clínicas del paciente nunca aparecen
en notificaciones, logs del sistema ni en los payloads enviados al proveedor de NLU.

---

## 6. Reglas de Agendamiento

### 6.1 Horario laboral

**RN-010 [config]** — Cada tenant define su horario laboral como una lista de rangos
por día de semana, cada uno con las modalidades que aplican a ese rango.

Ejemplo del tenant fundador (fisioterapia):

```json
{
  "monday":    [{ "from": "09:00", "to": "17:00", "modes": ["in_clinic"] },
                { "from": "17:00", "to": "21:00", "modes": ["home_visit"] }],
  "tuesday":   [{ "from": "09:00", "to": "17:00", "modes": ["in_clinic"] },
                { "from": "17:00", "to": "21:00", "modes": ["home_visit"] }],
  "wednesday": [{ "from": "09:00", "to": "17:00", "modes": ["in_clinic"] },
                { "from": "17:00", "to": "21:00", "modes": ["home_visit"] }],
  "thursday":  [{ "from": "09:00", "to": "17:00", "modes": ["in_clinic"] },
                { "from": "17:00", "to": "21:00", "modes": ["home_visit"] }],
  "friday":    [{ "from": "09:00", "to": "17:00", "modes": ["in_clinic"] }],
  "saturday":  [],
  "sunday":    []
}
```

**RN-011 [core]** — Una cita solo puede crearse dentro de un rango cuya lista de
modalidades incluya la modalidad solicitada. Si el profesional quiere agendar fuera
de horario, primero crea una excepción de tipo `extended_hours`.

**RN-012 [config]** — Granularidad de inicio de cita (`slotGranularityMinutes`):
intervalo mínimo entre inicios de cita. Fundador: 60 minutos (en punto de hora).
Dental y salones típicamente usan 15 o 30.

### 6.2 Capacidad

**RN-020 [config]** — La capacidad máxima de citas simultáneas se define a nivel de
**tenant**, por modalidad:

- `maxConcurrentAppointments.in_clinic`: número máximo de pacientes que el tenant puede
  atender al mismo tiempo en clínica. Fundador: **4**.
- `maxConcurrentAppointments.home_visit`: máximo simultáneo en domicilios. Fundador: **1**.

Esta capacidad refleja los recursos físicos del negocio (camillas, espacios de trabajo)
y no depende del número de profesionales. En V3, cuando el tenant incorpore múltiples
profesionales con sus propios recursos, la capacidad se configurará por profesional de
forma independiente.

**RN-021 [core]** — La validación de capacidad cuenta las citas que se **solapan en
el tiempo**, no las que inician en la misma hora. Dos citas de 90 minutos con 30 minutos
de diferencia se solapan durante 60 minutos y ambas consumen cupo durante ese tramo.

**RN-022 [core]** — La capacidad de `home_visit` es siempre 1 y no es negociable: el
profesional no puede estar físicamente en dos domicilios al mismo tiempo. Aunque la
configuración del tenant permita valores mayores, el sistema impone el máximo de 1 para
esta modalidad.

### 6.3 Duración

**RN-030 [config]** — Duración por defecto de una cita (`defaultDurationMinutes`).
Fundador: 60 minutos. El profesional puede sobreescribirla cita por cita dentro de los
límites configurados (`minDurationMinutes`, `maxDurationMinutes`).

**RN-031 [config]** — Tipos de cita opcionales. Si el tenant los define, cada tipo
trae su propia duración, color visual y buffers. El tenant fundador no define tipos en V1.

### 6.4 Buffers

**RN-040 [config]** — Cada modalidad puede definir `bufferBeforeMinutes` y
`bufferAfterMinutes` por tenant. El tiempo de buffer bloquea disponibilidad pero
no es visible para el paciente.

Fundador: `home_visit.bufferAfterMinutes = 30` (traslado de regreso a clínica o al
siguiente domicilio).

**RN-041 [core]** — La validación de disponibilidad evalúa el rango extendido
`[start − bufferBefore, end + bufferAfter]`. Dentro de ese rango extendido no puede
iniciarse otra cita que exceda el límite de capacidad.

### 6.5 Límites temporales

**RN-050 [core]** — No se crean citas con inicio en el pasado. Tolerancia de 5 minutos
para compensar desfase de reloj del dispositivo.

**RN-051 [config]** — Anticipación mínima (`minAdvanceMinutes`, fundador: 0 — el
profesional puede agendar para "ahora mismo") y máxima (`maxAdvanceDays`, fundador: 90).

**RN-052 [config]** — Ventana mínima de cancelación (`cancellationNoticeHours`,
fundador: 0 — sin restricción para el profesional dueño del negocio). Esta regla
se aplicará a los pacientes en V2.

### 6.6 Excepciones de calendario

**RN-060 [core]** — Las excepciones modifican puntualmente el horario del tenant.
Cuatro tipos:

| Tipo | Alcance | Efecto |
|---|---|---|
| `holiday` | Día completo | Bloquea toda disponibilidad ese día |
| `time_block` | Rango de horas | Bloquea un periodo (almuerzo, trámite personal) |
| `vacation` | Rango de fechas | Bloquea días completos consecutivos |
| `extended_hours` | Rango de horas | Habilita disponibilidad fuera del horario regular ese día |

**RN-061 [core]** — Prioridad de evaluación cuando un rango toca múltiples reglas:
`vacation` / `holiday` > `time_block` > `extended_hours` > horario regular.

**RN-062 [core]** — Crear una excepción que colisiona con citas ya agendadas **no las
cancela automáticamente**. El sistema identifica las citas afectadas y exige una
decisión explícita por cada una: reagendar, cancelar o mantener con override. Una
cita nunca desaparece como efecto secundario silencioso de un cambio de horario.

### 6.7 Series de citas (recurrencia)

**RN-070 [core]** — Una serie agrupa citas repetidas para el mismo paciente bajo la
misma regla. Se define por: paciente, días de la semana, hora, duración, modalidad y
fin de la serie (por fecha límite o por número de sesiones).
Ejemplo: "Luis, lunes y jueves a las 3 PM, 12 sesiones".

**RN-071 [core]** — Al crear una serie, el sistema valida la disponibilidad de
**todas** las ocurrencias antes de confirmar. Las ocurrencias en conflicto se listan
individualmente; el profesional decide para cada una: omitir esa sesión, elegir otro
horario, o forzar si hay cupo.

**RN-072 [core]** — Cada ocurrencia se materializa como una cita individual vinculada
por `series_id`. La cancelación y la reagenda admiten tres alcances: "solo esta sesión",
"esta y todas las siguientes", "toda la serie".

**RN-073** — V1 implementa únicamente el patrón semanal (días de la semana fijos).
Cubre fisioterapia, psicología y tutorías. Patrones mensual y personalizado → V2.

---

## 7. Ciclo de Vida de la Cita

**RN-080 [core]** — Estados y transiciones válidas en V1:

```
            ┌─────────────┐
            │  scheduled  │
            └──────┬──────┘
       ┌───────────┼───────────┐
    complete    no_show     cancel / reschedule
       │           │              │
  ┌────▼────┐ ┌────▼────┐   cancelled (terminal)
  │completed│ │ no_show │   + si reagenda: nueva cita
  └─────────┘ └─────────┘     scheduled vinculada
  (terminal)  (terminal)
```

| Estado | Significado | Quién lo dispara |
|---|---|---|
| `scheduled` | Cita creada y vigente en la agenda | Profesional (voz o táctil) |
| `completed` | La sesión ocurrió | Profesional; o auto-completado N horas después del fin **[config]** `autoCompleteAfterHours` |
| `no_show` | El paciente no llegó | Profesional |
| `cancelled` | Cancelada antes de ocurrir | Profesional (motivo de cancelación opcional) |

El estado `confirmed` (paciente confirma asistencia) se incorpora en V2 cuando los
pacientes interactúen con el sistema vía portal web.

**RN-081 [core]** — Reagendar crea una nueva cita y cancela la original con vínculo:
la original pasa a `cancelled` con `rescheduled_to_id`; la nueva guarda
`rescheduled_from_id`. El historial completo queda intacto.

**RN-082 [core]** — Los estados `completed`, `no_show` y `cancelled` son terminales.
Para corregir un error en uno de estos estados: crear una nueva cita y registrar una
nota de auditoría.

**RN-083** — Métricas derivadas (base para el dashboard de V2): tasa de ocupación
(horas agendadas / horas laborales), tasa de no-show global y por paciente, series
completadas íntegramente versus abandonadas, volumen de domicilios vs clínica.

### 7.2 Estado de pago

**RN-084 [core]** — Toda cita tiene un `payment_status` con dos valores posibles:
`unpaid` (defecto al crear) y `paid`. El profesional lo actualiza manualmente con
un tap desde la vista de la cita o desde el calendario.

**RN-085 [core]** — El estado de pago es **independiente** del estado del ciclo de
vida. Las combinaciones válidas incluyen casos como:

| Lifecycle status | Payment status | Escenario real |
|---|---|---|
| `scheduled` | `unpaid` | Cita futura sin cobrar (lo normal) |
| `scheduled` | `paid` | Paciente pagó por adelantado |
| `completed` | `unpaid` | Sesión atendida, cobro pendiente |
| `completed` | `paid` | Sesión atendida y cobrada |
| `cancelled` | `paid` | Canceló tarde y pagó penalidad (futuro) |
| `no_show` | `unpaid` | No llegó y no pagó |

**RN-086 [core]** — El profesional puede cambiar el `payment_status` en cualquier
momento, independientemente del estado del ciclo de vida de la cita. No hay restricción
de quién, cuándo ni cuántas veces se cambia.

**RN-087** — En V1 el control de pago es intencionalmente un indicador binario manual.
No incluye montos, métodos de pago, comprobantes ni historial de transacciones. La
gestión completa de pagos (montos, recibos, integración con pasarela) se incorpora en V3.

---

## 8. Comandos de Voz

> Las intenciones de voz y el calendario táctil son entradas alternativas al mismo sistema.
> Toda operación disponible por voz también lo es por táctil, y viceversa.

### 8.1 Intenciones soportadas en V1

**RN-100 [core]** — El sistema reconoce cinco intenciones:

| Intención | Ejemplo | Modifica datos |
|---|---|---|
| `schedule` | "Agenda a Luis el miércoles a las 3" | Sí |
| `cancel` | "Cancela la cita de Luis del jueves" | Sí |
| `reschedule` | "Mueve la de Luis al viernes a las 4" | Sí |
| `query` | "¿Qué tengo mañana?" / "¿Quiénes me faltan hoy?" / "¿Cuándo es la próxima de María?" | No |
| `block` | "Bloquéame el viernes de 12 a 2" / "El lunes es feriado" | Sí |

La intención `block` crea una excepción de calendario. Es de uso diario frecuente.

### 8.2 Variantes de la intención `query`

**RN-101 [core]** — La intención `query` admite cuatro variantes según el alcance
temporal y el filtro de estado:

| Variante | Ejemplos de comando | Resultado |
|---|---|---|
| `query.schedule` | "¿Qué tengo mañana?" / "¿Cómo está mi semana?" | Todas las citas del periodo, cualquier estado |
| `query.pending_today` | "¿Quiénes me faltan hoy?" / "Pacientes pendientes de hoy" | Citas `scheduled` del día actual cuyo inicio no ha pasado, más las del día que ya pasaron sin ser marcadas |
| `query.pending_tomorrow` | "¿Quiénes tengo mañana?" / "Pendientes de mañana" | Citas `scheduled` de mañana |
| `query.pending_week` | "¿Qué me queda esta semana?" / "Pendientes de la semana" | Citas `scheduled` del resto de la semana actual (desde hoy) |
| `query.unpaid` | "¿Quién no ha pagado hoy?" / "Cobros pendientes de esta semana" | Citas con `payment_status = unpaid` en el periodo indicado, ordenadas cronológicamente |

El resultado de toda `query` se presenta en pantalla ordenado cronológicamente, con:
nombre del paciente, hora, duración y modalidad. En modo voz, el sistema lee un resumen
("Tienes 3 citas pendientes hoy: Luis Pérez a las 3, María López a las 4, Juan García
a las 5").

### 8.3 Flujo de confirmación obligatorio

**RN-110 [core]** — Ninguna intención que modifique datos se ejecuta sin confirmación
explícita. El sistema presenta una tarjeta con todos los datos interpretados. Ejemplos:

- Schedule paciente existente: "Agendar a **Luis Pérez** — mié 11 mar, 3:00 PM, clínica. ¿Confirmas?"
- Schedule paciente nuevo: "Crear paciente **Juan García** + agendar para **jue 12 mar, 4:00 PM**, clínica. ¿Confirmas?"
- Reschedule: "Mover cita de **Luis Pérez** del lun 9 mar → jue 12 mar, 4:00 PM. ¿Confirmas?"
- Block: "Bloquear **vie 14 mar de 12:00 a 14:00** (almuerzo). ¿Confirmas?"

El profesional confirma con "sí" o "confirmar" por voz, o con tap en el botón.
Puede cancelar con "no" o "cancelar".

**RN-111 [config]** — Si la confianza del NLU está por debajo de `confidenceThreshold`
(fundador: 0.70), la confirmación se refuerza: el sistema lee la interpretación en voz
alta y no acepta tap inmediato.

**RN-112 [core]** — Las intenciones `query` no requieren confirmación; son de solo
lectura y se ejecutan inmediatamente.

### 8.4 Conversación multi-turno (slot-filling)

**RN-120 [core]** — Si faltan datos obligatorios, el sistema pregunta por el dato
faltante y retiene el contexto parcial hasta completar la intención o hasta 2 minutos
sin actividad (máximo 5 turnos):

```
Profesional: "Agéndame a Luis"
Sistema:     "¿Qué día y a qué hora?"
Profesional: "El miércoles a las 3"
Sistema:     [tarjeta] "Agendar a Luis Pérez — mié 11 mar, 3:00 PM, clínica. ¿Confirmas?"
```

**RN-121 [core]** — Datos mínimos requeridos para salir del slot-filling:

| Intención | Datos requeridos | Default si no se menciona |
|---|---|---|
| `schedule` | Paciente + fecha + hora | Modalidad: `in_clinic` **[config]** `defaultMode` |
| `cancel` | Cita identificable: paciente + fecha aproximada, o "la de las 3" | — |
| `reschedule` | Cita identificable + nueva fecha + nueva hora | Misma modalidad que la original |
| `query.*` | Alcance temporal (hoy / mañana / semana) o nombre de paciente | — |
| `block` | Fecha + rango de horas, o "todo el día" | Tipo: `time_block` |

### 8.5 Resolución de entidades

**RN-122 [core] — Matching de pacientes:** el nombre dictado se compara contra los
pacientes del tenant por similitud fonética y trigram en español. Tres casos:

| Resultado | Acción del sistema |
|---|---|
| Un candidato con alta similitud | Se usa directamente; aparece en la tarjeta de confirmación |
| Varios candidatos o similitud media | Se presentan las opciones para que el profesional elija antes de continuar |
| Ninguna coincidencia | Se crea un nuevo paciente con ese nombre (RN-092); la confirmación incluye "Crear paciente: X" |

**RN-123 [core] — Fechas relativas deterministas:** el proveedor de NLU nunca calcula
fechas absolutas; devuelve una estructura relativa que el backend resuelve con la
timezone del tenant y el `capturedAt` del comando.

Ejemplos:

| Enunciado | Estructura que devuelve el NLU |
|---|---|
| "el miércoles" | `{ type: "next_weekday", weekday: 3 }` |
| "mañana" | `{ type: "tomorrow" }` |
| "el otro lunes" | `{ type: "weekday_after_next", weekday: 1 }` |
| "el 15" | `{ type: "day_of_current_month", day: 15 }` |
| "esta semana" | `{ type: "current_week" }` |

Los LLMs cometen errores en aritmética de calendario. Resolverlo en el backend permite
testearlo sin IA y garantiza corrección en comandos capturados offline.

**RN-124 [core] — Ambigüedad AM/PM:** "a las 3" se resuelve dentro del horario
laboral del día. Si solo hay horario en uno de los dos rangos (3 AM o 3 PM), se usa
ese. Si ambos son laborales, el sistema pregunta.

**RN-125 [core] — Comandos capturados offline:** el texto transcrito se encola con
su `capturedAt` y una fecha-ancla. Al sincronizar, las fechas relativas se resuelven
contra `capturedAt`, nunca contra la fecha de sincronización. Si la cita resultante
quedó en el pasado o el slot ya está ocupado: se rechaza con notificación. Nunca se
ajusta silenciosamente a otro horario.

---

## 9. Vista de Calendario

La vista de calendario es el centro de operaciones del sistema. Tiene dos expresiones
según el actor: el profesional ve su agenda real; el paciente (en V2) ve solo
disponibilidad. Comparten el mismo diseño visual pero con información radicalmente
diferente.

### 9.1 Calendario del profesional (V1 — app móvil)

**RN-160 [core]** — El profesional dispone de dos modos de vista: **día** (timeline
vertical con las horas del día laboral) y **semana** (grilla de 7 columnas, una por
día). En ambas, las citas se representan como bloques visuales proporcionales a su
duración.

**RN-161 [core]** — Cada bloque de cita en el calendario muestra como mínimo:
nombre del paciente, hora de inicio y fin, e indicadores visuales de modalidad
(ej. ícono de casa para domicilio) y de estado de pago (ej. ícono de billetera
o color diferenciado para `unpaid`).

**RN-162 [core]** — Las zonas del calendario se distinguen visualmente en tres
categorías:

| Zona | Definición | Interacción |
|---|---|---|
| **Horario laboral disponible** | Dentro del horario, sin cita asignada, dentro de capacidad | Tap → abre formulario de nueva cita con fecha y hora pre-llenadas |
| **Horario laboral ocupado** | Bloque de cita existente | Tap → abre detalle de la cita |
| **Fuera de horario / bloqueado** | No laboral o con excepción de calendario | No interactivo (visualmente apagado) |

**RN-163 [core]** — Cuando la capacidad del slot es mayor a 1 (ej. `in_clinic = 4`),
el profesional puede ver múltiples bloques de cita superpuestos en el mismo tramo
horario, uno al lado del otro, hasta el máximo configurado. Visualmente deja claro
cuántos cupos están ocupados y cuántos quedan disponibles.

**RN-164 [core]** — El calendario del profesional muestra las excepciones de calendario
(bloqueos, feriados, vacaciones) como zonas sombreadas con etiqueta de motivo. Estas
zonas no son interactivas para crear citas.

**RN-165 [config]** — La vista por defecto al abrir la app es la del día actual
(`defaultCalendarView`, fundador: `day`). El profesional puede cambiarla y el sistema
recuerda su preferencia.

### 9.2 Calendario del paciente (V2 — portal web)

**RN-170 [core]** — El portal web muestra al paciente un calendario donde cada slot
tiene únicamente dos estados posibles: **disponible** o **no disponible**. No existe
un tercer estado ni información intermedia.

**RN-171 [core] — Regla de disponibilidad para el paciente:** un slot es disponible
cuando se cumplen las tres condiciones simultáneamente:
1. El slot cae dentro del horario laboral del tenant para la modalidad solicitada.
2. Ninguna excepción de calendario bloquea ese rango.
3. El número de citas solapadas en ese rango es estrictamente menor al máximo de
   capacidad configurado (`maxConcurrentAppointments` para esa modalidad).

**RN-172 [core] — Privacidad total:** el paciente nunca ve, bajo ninguna circunstancia:
- Nombres ni datos de otros pacientes.
- Cuántos cupos quedan disponibles (solo sabe si puede o no puede reservar).
- Motivos por los que un slot está no disponible (excepción, capacidad llena o fuera
  de horario se presentan igual: simplemente "no disponible").
- Ningún detalle de las citas de otros pacientes.

**RN-173 [core]** — El paciente selecciona un slot disponible y confirma su reserva.
El sistema verifica disponibilidad en tiempo real en el momento de confirmar (el slot
puede haberse llenado entre que el paciente lo vio y lo confirmó); si ya no está
disponible, se informa y se presenta el calendario actualizado.

**RN-174** — El diseño del calendario del paciente prioriza la vista de **semana**
como vista por defecto (más días visibles = más opciones de elección en una pantalla).

---

## 10. Notificaciones en V1

En V1, todas las notificaciones son push exclusivamente para el **profesional**.
Los pacientes no reciben ninguna comunicación del sistema en esta versión.

**RN-130 [core]** — Tres tipos de notificación push al profesional:

### Recordatorio pre-cita

**RN-131 [config]** — Se envía una notificación push al profesional N minutos antes
de cada cita (`reminderBeforeMinutes`, fundador: 30).

Contenido: "Cita con **Luis Pérez** a las 3:00 PM — domicilio" (incluye la modalidad
porque impacta la logística: el profesional necesita saber si tiene que salir).

El tiempo de anticipación puede configurarse por modalidad si se necesita más margen
para domicilios. Ejemplo: `home_visit.reminderBeforeMinutes = 60`.

Si la cita es cancelada antes de que se dispare el recordatorio, el recordatorio
se cancela automáticamente.

### Resumen de la mañana

**RN-132 [config]** — Una notificación push diaria a la hora configurada
(`morningNotificationTime`, fundador: 07:00) que lista todas las citas del día cuyo
inicio es antes de `morningSessionUntil` (fundador: 13:00).

Contenido: "Buenos días — Mañana: 3 citas. 8:00 María López (clínica) · 9:00 Juan
García (clínica) · 10:30 Pedro Ramírez (clínica)".

Si no hay citas en ese bloque horario, no se envía la notificación.

### Resumen de la tarde

**RN-133 [config]** — Una notificación push diaria a `afternoonNotificationTime`
(fundador: 13:30) que lista todas las citas del día cuyo inicio es a partir de
`afternoonSessionFrom` (fundador: 14:00).

Contenido: "Tarde: 4 citas. 14:00 Ana Morales (clínica) · 15:00 Luis Pérez
(domicilio) · 16:00 Carmen Ruiz (clínica) · 17:30 Roberto Lima (domicilio)".

Si no hay citas en ese bloque horario, no se envía la notificación.

**RN-134 [core]** — Los cuatro valores de configuración de los resúmenes
(`morningNotificationTime`, `morningSessionUntil`, `afternoonNotificationTime`,
`afternoonSessionFrom`) deben ser coherentes: `morningSessionUntil` debe ser
menor que `afternoonSessionFrom`, y `afternoonNotificationTime` debe caer entre
ambos. El sistema valida esta coherencia al guardar la configuración.

**RN-135 [core]** — Toda notificación push al profesional contiene únicamente:
nombre del paciente, hora, duración y modalidad. Nunca notas clínicas ni datos
de otros pacientes.

**RN-136 [core]** — Si una notificación push falla (dispositivo sin conexión,
token vencido), se registra como `failed`. No se reintenta de forma indefinida:
un recordatorio no entregado no es una pérdida crítica de datos en V1.

---

## 11. Multi-tenancy y Configuración

**RN-140 [core]** — Toda la parametrización del negocio vive en `tenant.config`
como documento versionado. Cambiar el comportamiento del sistema para un tenant
(horarios, capacidad, duración, configuración de notificaciones) es cambiar
configuración, no código.

**RN-141 [core]** — Al crear un tenant, se elige una plantilla de industria que
pre-llena la configuración con valores sensatos. Las plantillas son datos (seeds),
no código. El tenant fundador usa la plantilla `physiotherapy`.

**RN-142 [core]** — Los cambios de configuración no afectan citas ya existentes.
Si la nueva configuración viola reglas de citas futuras, el sistema identifica esas
citas y muestra una advertencia; el profesional decide qué hacer con cada una.

**RN-143 [core]** — Toda mutación de configuración queda en `audit_log` con el valor
anterior, el nuevo valor, el usuario que realizó el cambio y el timestamp.

---

## 12. Privacidad

**RN-150 [core]** — Cifrado en tránsito (TLS) en todas las comunicaciones y cifrado
en reposo gestionado por el proveedor de base de datos.

**RN-151 [core]** — Política de privacidad pública con URL permanente, obligatoria
para publicar en Google Play y App Store. Debe declarar: qué datos se recopilan,
que el texto transcrito de los comandos de voz (no el audio, que se procesa
localmente en el dispositivo) se envía a un proveedor de IA externo para su
interpretación, y los derechos de eliminación del titular de los datos.

**RN-152 [core] — Derecho al olvido:** a solicitud, los datos personales del paciente
se anonimizan (nombre → "Paciente eliminado", contacto → nulo). Las citas históricas
se preservan para métricas agregadas sin datos identificables.

**RN-153 [config] — Retención de datos:** logs de auditoría 24 meses; transcripciones
de comandos de voz 30 días (debugging y mejora del dataset NLU); registros de
notificaciones enviadas 12 meses.

---

## 13. Fuera de Alcance — Decisiones Tomadas

| Funcionalidad | Versión | Criterio para incorporarla |
|---|---|---|
| Notificaciones a pacientes (email, WhatsApp, push) | V2 | Cuando los pacientes interactúen con el sistema |
| Confirmación de asistencia por el paciente | V2 | Con el portal web de auto-agendamiento |
| Portal de auto-agendamiento para pacientes | V2 | Primer paciente que quiera agendar por su cuenta |
| Dashboard web y métricas visuales | V2 | Junto al portal de pacientes |
| WhatsApp Business | V2 | Cuenta Meta Business verificada |
| Demo mode para portafolio | V2 | Al construir el web |
| Múltiples profesionales por tenant | V3 | Primer tenant con más de un profesional |
| Onboarding self-service de tenants | V3 | Más clientes de los que el dev puede onboardear manualmente |
| Tipos de cita con duraciones distintas | V2 | Tenant dental o similar |
| Modalidad virtual con link de videollamada | V2 | Tenant de tutorías o psicología online |
| Patrones de recurrencia mensual o personalizado | V2 | Caso que el patrón semanal no cubra |
| Gestión completa de pagos (montos, recibos, pasarela de pago, historial) | V3 | Demanda real de un tenant (V1 incluye solo el flag pagado/no pagado) |
| Lista de espera | V2 | Ocupación sostenida >80 % en un tenant |
| App stores públicos | V2/V3 | Antes del primer cliente externo |
