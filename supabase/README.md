# Supabase — VoiceScheduler

Migraciones y funciones de la fase 1. Aún no están aplicadas a ningún proyecto:
requieren una cuenta en [supabase.com](https://supabase.com) (el plan free basta para V1).

## Contenido

| Archivo | Qué hace |
|---|---|
| `migrations/0001_schema.sql` | Extensiones (pg_trgm, unaccent), enums, tablas, índices y triggers (RN-082, RN-131, RN-143) |
| `migrations/0002_rls.sql` | Row Level Security en todas las tablas (RN-001) |
| `migrations/0003_functions.sql` | RPCs: `create_appointment`, `reschedule_appointment`, `search_patients` (RN-122), `anonymize_patient` (RN-152) |
| `seed.sql` | Plantilla `physiotherapy` (RN-141) + receta comentada para el alta del tenant fundador |

## Cómo aplicar

Opción A — CLI (recomendada, deja las migraciones versionadas):

```bash
npx supabase login
npx supabase link --project-ref <ref-del-proyecto>
npx supabase db push
```

Opción B — dashboard: pegar los tres archivos en el SQL Editor, en orden, y luego `seed.sql`.

## División de responsabilidades con el core

Las Edge Functions ejecutan `@voicescheduler/core` (horario, excepciones,
fechas relativas) **antes** de llamar a los RPC. Los RPC son la única puerta de
escritura de citas y garantizan bajo advisory lock lo sensible a concurrencia:
capacidad por solapamiento (RN-020/021/022/041) y límites temporales (RN-050/051).
El algoritmo de capacidad del RPC es el mismo de `packages/core/src/capacity.ts`.

## Edge Function `interpret` (fase 4 — voz)

`functions/interpret/index.ts` convierte el texto dictado en una intención
estructurada usando la Claude API (modelo `claude-haiku-4-5`, decisión D-4).
Nunca recibe notas clínicas ni la lista de pacientes (RN-095) y devuelve fechas
relativas que la app resuelve con el core (RN-123).

Para desplegarla se necesita una API key de Anthropic
([console.anthropic.com](https://console.anthropic.com) → API Keys):

```bash
npx supabase login
npx supabase link --project-ref cmswskiusxhekkjovwsm
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
npx supabase functions deploy interpret
```

Alternativa sin CLI: en el dashboard, Edge Functions → Deploy new function →
pegar el contenido de `functions/interpret/index.ts` con el nombre `interpret`,
y en Settings → Edge Functions → Secrets agregar `ANTHROPIC_API_KEY`.

## Pendiente tras crear el proyecto

1. **pg_cron** (Dashboard → Database → Extensions → habilitar `pg_cron`) y programar:
   - barrido de `scheduled_notifications` pendientes → Edge Function `notify` (cada minuto)
   - resúmenes de mañana/tarde por tenant (RN-132/133)
   - retención: `voice_commands` 30 días, `notifications_log` 12 meses, `audit_log` 24 meses (RN-153)
2. **Auth**: crear el usuario de la profesional y ejecutar el alta comentada en `seed.sql`.
3. **Edge Functions** (fase 4): `interpret` (NLU con Claude API), `notify` (FCM/APNs), `sync`.
