# VoiceScheduler — Arquitectura Técnica (v1)

> Documento de diseño. Cada decisión (D-x) explica el problema, la opción elegida,
> las alternativas descartadas y las reglas de negocio (RN-xxx) que la motivan.
> Compañero de `01_Reglas_de_Negocio.md`.

---

## 1. Principios que gobiernan el diseño

1. **El dominio es matemática de calendario, no CRUD.** Capacidad por solapamiento
   (RN-021), buffers (RN-041), prioridad de excepciones (RN-061), resolución de fechas
   relativas (RN-123): todo esto son funciones puras, deterministas y testeables sin
   red, sin base de datos y sin IA. La arquitectura las aísla en un paquete propio.
2. **Un solo lenguaje en todo el stack.** TypeScript en móvil, backend y (V2) web.
   La razón no es gusto: es que el punto 1 exige ejecutar *la misma* lógica de
   validación en el dispositivo (offline, UX instantánea) y en el servidor (autoridad
   final). Dos lenguajes = dos implementaciones que divergen.
3. **La IA nunca es autoridad.** El NLU propone una intención estructurada; el
   dominio la valida y el profesional la confirma (RN-110). Si mañana cambiamos de
   proveedor de NLU, nada del dominio cambia.
4. **V2 y V3 se preparan en el modelo de datos, no en el código.** `tenant_id` en
   toda fila, `role` desde V1 (RN-002), configuración como datos (RN-140/141). Cero
   features especulativos en UI o lógica.

---

## 2. Vista general

```
┌─────────────────────────────────────────────┐
│  APP MÓVIL (React + Bootstrap + Capacitor)  │
│                                             │
│  Entrada voz ──► STT del SO (on-device)     │
│  Entrada táctil ──► Vistas calendario       │
│        │                                    │
│        ▼                                    │
│  @voicescheduler/core  (validación local)   │
│        │                                    │
│  SQLite local + cola outbox (offline-first) │
└──────────────────┬──────────────────────────┘
                   │ sync / RPC (TLS)
┌──────────────────▼──────────────────────────┐
│  SUPABASE                                   │
│                                             │
│  Edge Functions (Deno/TS)                   │
│    · interpret  ──► Claude API (NLU)        │
│    · notify     ──► FCM / APNs              │
│        │                                    │
│  @voicescheduler/core  (validación final)   │
│        │                                    │
│  Postgres + RLS  (aislamiento por tenant)   │
│    pg_trgm (matching de nombres)            │
│    pg_cron (resúmenes y recordatorios)      │
└─────────────────────────────────────────────┘
```

Dos lugares ejecutan el mismo núcleo de dominio. El servidor siempre tiene la última
palabra; el cliente valida primero solo para dar respuesta inmediata y funcionar offline.

---

## 3. Decisiones de arquitectura

### D-1 · App: React + Bootstrap 5, empaquetada con Capacitor

**Elegido:** aplicación web en React + TypeScript (Vite) con **Bootstrap 5** como
sistema de UI, empaquetada como app nativa Android/iOS con **Capacitor**.

**Por qué:**
- **La plantilla será Bootstrap** (decisión del owner). Con la UI 100 % web, la
  plantilla se integra directo como tema Sass + clases utilitarias; en React
  Native eso es imposible sin rehacerla a mano.
- Capacitor envuelve la web en una shell nativa y aporta lo que el navegador no
  garantiza: reconocimiento de voz on-device del SO (RN-151), push nativo
  (FCM/APNs) y SQLite real para el modo offline.
- Comparte lenguaje y el paquete `core` con el backend (principio 2), y el portal
  de pacientes de V2 reutiliza stack, tema y componentes casi por completo.
- V3 (app stores públicos) queda cubierto: Capacitor produce binarios publicables.
- La vista de calendario a medida (RN-160..165: carriles de capacidad, zonas
  sombreadas, bloques proporcionales) se construye con HTML/CSS estándar, y los
  mockups de la fase de diseño se portan casi directo.

**Descartado:**
- *Expo / React Native* (la elección inicial, revisada el 2026-07-06): excelente
  rendering nativo, pero incompatible con una plantilla Bootstrap.
- *Flutter*: además de lo anterior, Dart rompería el núcleo compartido — habría que
  reimplementar toda la matemática de calendario dos veces.
- *PWA pura sin Capacitor*: en iOS las push exigen instalación manual (16.4+) y la
  Web Speech API del navegador puede procesar el audio en la nube, lo que
  comprometería RN-151. La shell nativa elimina ambas dudas.

### D-2 · Núcleo de dominio compartido: `@voicescheduler/core`

**Elegido:** paquete TypeScript **puro** (cero dependencias de IO) en un monorepo,
consumido por la app móvil y por las Edge Functions.

Contiene:
- **Slots**: cálculo de disponibilidad desde horario + excepciones + citas. Los slots
  se calculan, nunca se persisten (glosario del dominio).
- **Capacidad**: conteo por solapamiento de intervalos con buffers extendidos
  (RN-021, RN-041), tope duro de 1 para `home_visit` (RN-022).
- **Excepciones**: resolución de prioridad `vacation/holiday > time_block >
  extended_hours > horario regular` (RN-061).
- **Fechas relativas**: resolutor determinista de las estructuras del NLU
  (`{type:"next_weekday", weekday:3}` → fecha absoluta con timezone del tenant y
  `capturedAt`) (RN-123, RN-125).
- **Máquina de estados** de la cita (RN-080..082) y reglas de serie (RN-070..073).
- **Validación de configuración** (ej. coherencia de horarios de resúmenes, RN-134).

**Por qué:** es la única forma de cumplir a la vez "validación instantánea y offline
en el móvil" y "el servidor es la autoridad" sin duplicar lógica. Además concentra
el 90 % del riesgo de bugs del producto en código trivialmente testeable: **cada test
unitario del core se nombra con el RN que verifica** (trazabilidad pedida por el
documento de reglas).

### D-3 · Backend: Supabase (Postgres + RLS + Edge Functions)

**Elegido:** Supabase como plataforma; la lógica de dominio en Edge Functions +
funciones Postgres (RPC), no en el cliente de Supabase directo.

**Por qué:**
- **RLS = RN-001 a nivel de motor.** El aislamiento por tenant se impone con Row
  Level Security sobre el claim `tenant_id` del JWT. Un bug en una query *no puede*
  cruzar tenants; no dependemos de acordarnos del `WHERE`.
- **`pg_trgm` + `unaccent`** resuelven el matching de nombres en español (RN-122)
  dentro de la base, sin servicio extra.
- **Transaccionalidad para el cupo:** crear una cita pasa por una función Postgres
  (`create_appointment`) que valida capacidad **dentro de la transacción** con lock
  advisory por tenant+rango. Esto es lo que hará trivial el RN-173 en V2 (dos
  pacientes confirmando el mismo slot a la vez).
- **`pg_cron`** dispara resúmenes de mañana/tarde y el barrido de recordatorios
  (RN-131..133) sin infraestructura adicional.
- Auth, storage y realtime ya incluidos → el portal V2 no requiere migración.
- Costo ~0 para un tenant; un solo desarrollador no administra servidores.

**Descartado:**
- *Backend propio (NestJS/Hono + Postgres)*: más control, pero todo lo anterior
  habría que construirlo y operarlo a mano. Se reevalúa en V3 si el panel de admin
  lo justifica.
- *Firebase/Firestore*: sin SQL no hay consultas de solapamiento de intervalos
  decentes ni RLS relacional; el modelo de citas es profundamente relacional.

### D-4 · Voz: STT en el dispositivo + Claude API para NLU

**Elegido:** pipeline de dos etapas.

1. **Transcripción on-device** con el reconocedor del sistema operativo, vía el
   plugin de speech-recognition de Capacitor. El audio **nunca** sale del teléfono —
   exactamente lo que la política de privacidad declara (RN-151).
2. **Interpretación** del texto en la Edge Function `interpret`, que llama a la
   Claude API (modelo Haiku — baja latencia/costo, la tarea es extracción
   estructurada, no razonamiento) con **tool use forzado**: la respuesta es siempre
   un JSON validado contra el esquema de intenciones (RN-100/101), con fechas
   **relativas** (RN-123) y `confidence` para el umbral de RN-111.

**Por qué así y no de otra forma:**
- El LLM no calcula fechas ni consulta pacientes: devuelve `"el miércoles"` como
  estructura y el nombre como string. El backend resuelve la fecha (core) y el
  matching (pg_trgm). Errores de aritmética de calendario del LLM: imposibles por
  construcción.
- El payload al proveedor de IA contiene solo el transcript — jamás notas clínicas
  ni la lista de pacientes (RN-095).
- Todo el flujo de confirmación (RN-110), slot-filling (RN-120/121) y desambiguación
  (RN-122/124) vive en la app + core, no en el prompt: testeable sin IA.

**Descartado:** *Whisper/STT en la nube* (viola RN-151 y agrega latencia y costo);
*NLU con gramáticas/regex* (frágil ante lenguaje natural real; el LLM con esquema
forzado da robustez con salida igual de estructurada).

### D-5 · Offline-first: SQLite + cola outbox

**Elegido:** la app opera contra una réplica local del tenant (SQLite vía plugin
de Capacitor; IndexedDB como fallback en modo navegador). Toda
mutación se escribe primero en una **cola outbox** con `capturedAt` y se sincroniza
cuando hay red. El servidor revalida todo; si una operación encolada ya no es
válida (slot ocupado, fecha en el pasado), se **rechaza con notificación** — nunca
se acomoda en silencio (RN-125).

**Por qué:** una fisioterapeuta en domicilios pasa parte del día sin señal confiable.
Consultar la agenda y dictar comandos debe funcionar siempre; el core local puede
validar y hasta calcular slots sin servidor. El volumen de datos de un tenant (cientos
de citas) hace viable la réplica completa — no hay problema de sync parcial.

**Alcance honesto:** con un solo escritor (V1 = un profesional), los conflictos
reales son raros; la política "el servidor decide y rechaza" es suficiente. No se
adopta CRDT ni sync framework pesado.

### D-6 · Multi-tenancy y configuración

- Una sola base, `tenant_id NOT NULL` en toda tabla de dominio + política RLS (RN-001).
- `tenant.config` como **documento JSONB versionado**: tabla
  `tenant_config_versions(tenant_id, version, config, created_by, created_at)`.
  Cambiar config = insertar versión nueva (nunca UPDATE) → el `audit_log` de RN-143
  sale gratis y RN-142 se cumple porque las citas existentes ya están materializadas
  con sus horas concretas; nada las recalcula.
- Plantillas de industria = filas seed de configuración (RN-141), no código.
- El campo `role` existe desde la primera migración (RN-002).

### D-7 · Notificaciones: push nativo (FCM/APNs) + programación en Postgres

- Tabla `scheduled_notifications`; los recordatorios pre-cita se insertan al crear
  la cita y se anulan al cancelarla (RN-131). `pg_cron` barre cada minuto y la Edge
  Function `notify` envía al dispositivo vía FCM/APNs (plugin de push de Capacitor).
- Resúmenes de mañana/tarde: job diario por tenant en su timezone (RN-132/133);
  si el bloque está vacío, no se envía.
- Cada envío se registra en `notifications_log` con estado; los fallos quedan
  `failed` sin reintentos indefinidos (RN-136). Contenido limitado a nombre, hora,
  duración y modalidad (RN-135).

---

## 4. Modelo de datos (esquema lógico)

```
tenants                 id, name, timezone, industry_template, created_at
tenant_config_versions  id, tenant_id, version, config(jsonb), created_by, created_at
users                   id, tenant_id, role(owner|professional|assistant|platform_admin), ...
patients                id, tenant_id, name, phone?, email?, address?, notes?, deleted_at?
series                  id, tenant_id, patient_id, weekdays[], start_time, duration_min,
                        mode, ends_by(date|count), end_value
appointments            id, tenant_id, patient_id, professional_id, starts_at(timestamptz),
                        duration_min, mode(in_clinic|home_visit), status, payment_status,
                        series_id?, rescheduled_from_id?, rescheduled_to_id?,
                        cancellation_reason?, created_via(voice|touch), created_at
calendar_exceptions     id, tenant_id, type(holiday|time_block|vacation|extended_hours),
                        date_from, date_to?, time_from?, time_to?, reason?
voice_commands          id, tenant_id, transcript, captured_at, intent(jsonb),
                        confidence, status, created_at   → retención 30 d (RN-153)
scheduled_notifications id, tenant_id, appointment_id?, kind, fire_at, status
notifications_log       id, tenant_id, kind, payload_meta, status, sent_at  → 12 m
audit_log               id, tenant_id, actor_id, action, before, after, at   → 24 m
```

Notas:
- `status` y `payment_status` son columnas independientes (RN-085); las transiciones
  terminales se protegen con trigger además del core (RN-082).
- Soft delete de pacientes vía `deleted_at` (RN-094); anonimización para derecho al
  olvido reescribe `name` y anula contacto (RN-152).
- Reagendar = INSERT nueva + UPDATE original a `cancelled` con los vínculos
  `rescheduled_*` en la misma transacción (RN-081).
- **Los slots no tienen tabla**: son salida de función (glosario).

---

## 5. Estructura del repositorio (monorepo pnpm)

```
voicescheduler/
├─ docs/                      # 01_Reglas, 02_Arquitectura, decisiones futuras (ADRs)
├─ packages/
│  └─ core/                   # dominio puro + tests por RN (D-2)
│     ├─ src/{slots,capacity,exceptions,dates,lifecycle,series,config}/
│     └─ test/                # p.ej. capacity.rn-021.test.ts
├─ apps/
│  └─ app/                    # React + Vite + Bootstrap 5 + Capacitor. UI + voz + outbox
│     └─ src/{calendar,voice,patients,settings,sync}/
├─ supabase/
│  ├─ migrations/             # esquema, RLS, funciones (create_appointment, etc.)
│  └─ functions/              # edge: interpret, sync, notify
└─ mockups/                   # prototipos HTML de las vistas (fase de diseño actual)
```

En V2 se agrega `apps/portal` (web del paciente) reutilizando `core` intacto —
el cálculo de disponibilidad del portal (RN-171) es literalmente la misma función
que ya usa el calendario del profesional.

---

## 6. Diseño visual (previo a plantilla)

La UI se construye sobre **Bootstrap 5**. El lenguaje visual propio (minimalista y
clínico) se define sobrescribiendo variables Sass de Bootstrap (`$primary`,
`$border-radius`, tipografía) en un único archivo de tema. Cuando llegue la
plantilla basada en Bootstrap, se integra reemplazando ese tema; las clases y
componentes siguen siendo los mismos — se cambian tokens, no pantallas. Los
mockups HTML (`/mockups`) validan el diseño antes de componentizar.

Dirección propuesta:
- Fondo neutro claro, tarjetas con radio generoso, una sola familia tipográfica.
- Acento **teal** para acciones y citas de clínica; **ámbar** para domicilios
  (el ícono 🏠 + color codifican modalidad, RN-161).
- `unpaid` se marca con punto/borde ámbar y ícono de billetera (RN-161).
- Zonas no laborales apagadas (gris), excepciones sombreadas con etiqueta (RN-164).
- Capacidad >1 = carriles lado a lado con contador "2/4" en el encabezado del tramo
  (RN-163).
- FAB de micrófono siempre visible: la voz es entrada de primera clase, no un menú.

## 7. Orden de construcción de V1

| Fase | Entregable | Valida |
|---|---|---|
| 0 | Monorepo + `core` con tests de slots/capacidad/fechas | Toda la matemática RN-0xx sin UI |
| 1 | Esquema Postgres + RLS + `create_appointment` RPC | Aislamiento y cupo transaccional |
| 2 | App móvil: calendario día/semana + CRUD táctil completo | RN-160..165, producto usable sin voz |
| 3 | Config + notificaciones push | RN-130..136, RN-140..143 |
| 4 | Pipeline de voz (STT + interpret + confirmación + slot-filling) | RN-100..125 |
| 5 | Offline/outbox endurecido + pulido | RN-125, D-5 |

La voz va *después* del calendario táctil a propósito: el táctil ejercita todo el
dominio y da un producto útil temprano; la voz se monta encima como segunda entrada
al mismo sistema (principio del §8 de reglas).

---

## 8. Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| Calidad del STT nativo en español con nombres propios | El matching tolerante (pg_trgm + fonética) absorbe errores; desambiguación RN-122 como red |
| Latencia voz→tarjeta (STT + edge + Claude) | Haiku + streaming; objetivo < 2 s hasta tarjeta |
| El reconocedor de voz varía por plataforma; Web Speech API en navegador puede procesar en la nube | Abstracción `SpeechInput`; en producción la app corre como Capacitor (reconocedor on-device del SO); fallback a teclado |
| Renderizado del calendario con carriles es UI a medida | Prototipar en mockups HTML primero (ya en curso) y portar |

---

## 9. Registro de decisiones

| Fecha | Decisión |
|---|---|
| 2026-07-06 | Versión inicial: Expo/React Native + Supabase + core compartido |
| 2026-07-06 | El owner define que la plantilla visual será Bootstrap → D-1 cambia a React + Bootstrap 5 + Capacitor. Supabase (D-3) y la dirección visual quedan confirmados. Las notificaciones (D-7) pasan de Expo Push a FCM/APNs |
