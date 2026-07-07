# VoiceScheduler

Agendamiento de citas con entrada dual (voz + táctil) para profesionales de salud
y servicios. Multi-tenant, offline-first.

## Documentación

- [Reglas de negocio](docs/01_Reglas_de_Negocio.md) — dominio normativo (RN-xxx)
- [Arquitectura](docs/02_Arquitectura.md) — decisiones técnicas (D-x) y sus porqués

## Estructura

- `packages/core` — dominio puro compartido (slots, capacidad, fechas, series).
  Cero dependencias; cada test se nombra con la regla RN que verifica.
- `apps/app` — (fase 2) React + Vite + Bootstrap 5 + Capacitor
- `supabase/` — (fase 1) migraciones, RLS y edge functions
- `mockups/` — prototipos HTML de la fase de diseño

## Comandos

```bash
npm install     # instala todo el workspace
npm test        # corre los tests del core (vitest)
npm run typecheck
```
