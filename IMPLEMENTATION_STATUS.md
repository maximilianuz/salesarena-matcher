# Estado de implementación — Sobre sellado, costo de mentir y Análisis de Llamada

Rama: `claude/auditoria-mapa-calor-coincidencias-5cka78`

Este documento resume tres cambios implementados en esta rama, en el orden en
que deben aplicarse. Sirve para retomar el trabajo desde una conversación
nueva sin perder contexto.

## 1. Migraciones SQL (Supabase) — aplicar EN ESTE ORDEN

### `20260824120000_sealed_closeout_and_lie_penalty.sql` ✅ aplicada
- Sella el sobre: solo el reloj (48hs tras terminar la reunión) hace que el
  cierre cuente, no la cantidad de respuestas. Elimina `closeout_is_open()`
  (delataba si el compañero ya había respondido) y la reemplaza por
  `closeout_counts()`.
- Penaliza mentir: si los dos asistentes tienen `joined_at` (abrieron el
  enlace desde la app) y uno dice "no se hizo", se trata como mentira
  comprobada: se descarta su respuesta, credibilidad ×0.6 por mentira (piso
  0.2), y 2 mentiras en el mismo mes calendario sacan de la rotación.
- Funciones nuevas: `closeout_disputes()`, `lie_penalty()`, `veracity_floor()`,
  `monthly_lies_limit()`.
- **Fix aplicado**: `my_closeout_standing()` necesitó `DROP FUNCTION IF EXISTS`
  antes de `CREATE` porque cambiaron las columnas de salida (Postgres no
  permite modificar los parámetros OUT con `CREATE OR REPLACE`).

### `20260824140000_pattern_strikes_without_evidence.sql` ✅ aplicada
- Cierra el agujero de Google Calendar: quien entra por el botón nativo
  "Unirse con Meet" de Calendar (en vez de por la app) no deja `joined_at`,
  así que no hay evidencia dura en su contra ni a su favor.
- Reincidencia sin evidencia: clasifica cada disputa en 4 tipos
  (`desmiente` | `respalda` | `silencio` | `sin_datos`) según lo que el
  registro de asistencia dice del que negó la sesión. La primera disputa
  `silencio` sale gratis; de la segunda en adelante, −20% credibilidad cada
  una. **Nunca bloquea** — solo el registro en contra (mentira comprobada)
  saca a alguien de la rotación.
- Funciones nuevas: `pattern_penalty()` (0.2), `pattern_grace()` (1).

### `20260827120000_call_analysis_notes.sql` ⏳ pendiente de aplicar
- Feature nueva y separada: pestaña "Análisis de Llamada" (puerto del
  prototipo standalone `Analisis-de-Llamada.html`, sistema "Gimnasio de
  Closing").
- Tablas: `call_analyses`, `call_notes`, `call_objections`. RLS calcada del
  patrón `is_room_member` ya usado en el resto de la app (lectura de sala
  completa — así funciona comparar "Grupo" —, escritura solo del dueño).
  Sumadas a la publicación de Realtime.
- **No se probó contra Supabase real**, solo con mock DB + 139 tests +
  build. Falta validar en staging: crear análisis, notas, comparación de
  grupo en vivo.

## 2. Frontend (`src/`)

- **`src/App.jsx`**:
  - Manejo del parámetro `?join=<meeting-id>` para cerrar el agujero de
    Calendar: entrada persiste en `sessionStorage` a través del redirect de
    Google OAuth, dispara `markJoined()`, redirige a Meet, muestra overlay
    "Entrando a tu role-play...".
  - `markJoined()` ahora valida `canRecordJoin()` (ventana de tiempo) en vez
    de solo el status de la reunión.
  - `createMeetUrl()` actualiza la descripción del evento de Calendar con el
    link `?join=` de la app.
  - Advertencia de credibilidad muestra mentiras comprobadas + reincidencia.
  - Nueva pestaña "Análisis de Llamada" (`activeTab === 'analisis'`),
    renderiza `<CallAnalysisView />`.
- **`src/closeouts.js`**: `PATTERN_PENALTY`, `PATTERN_GRACE`,
  `getDisputedMeetings()` (ahora con campo `evidence`), `getUnbackedDisputes()`,
  `getPatternStrikes()`, `getVeracity()`.
- **`src/domain/schedule.js`** (nuevo): `canRecordJoin(startsAtIso, durationMin, now)`
  — solo permite registrar `joined_at` entre 30 min antes y 30 min después
  del fin de la reunión, para que no se pueda fabricar evidencia fuera de
  ventana.
- **`src/callAnalysis/`** (nuevo): `CallAnalysisView.jsx`, `callAnalysis.css`,
  `content.js`. Sin portar a propósito (para no inflar el cambio): exportar/
  imprimir PDF, y probar "Duplicar análisis" contra datos reales.
- **`src/index.css`**: estilos del overlay de "join" (`.join-card`,
  `.join-title`, `.join-desc`).

## 3. Edge Function

**`supabase/functions/weekly-matcher/index.ts`**:
- Trae `joined_at` en el select de `meeting_attendees`.
- Clasifica las 4 categorías de disputa igual que la migración de patrón.
- Constantes `PATTERN_PENALTY` / `PATTERN_GRACE` alineadas con SQL y con
  `src/closeouts.js` (verificado por tests de drift-detection).
- Crítico: la reincidencia (`sinRespaldoPorEmail`) **nunca** suma al
  conjunto `blocked`; solo las mentiras comprobadas bloquean.

## 4. Tests — 139/139 pasando

- `tests/invariants.test.mjs` (16 tests): incluye 3 guardas de deriva entre
  Edge Function / migraciones / `src/closeouts.js` para las constantes de
  patrón, y una guarda explícita de que la reincidencia nunca bloquea.
- `tests/closeouts.test.mjs` (41 tests): 7 nuevos para reincidencia.
- `tests/schedule.test.mjs` (5 tests): ventana de `canRecordJoin()`.

## 5. Pendientes

1. Aplicar `20260827120000_call_analysis_notes.sql` en Supabase (SQL Editor,
   igual que las dos anteriores).
2. Validar en staging el flujo de Análisis de Llamada contra Supabase real
   (no solo mock DB).
3. Validar en staging el flujo completo de disputa/mentira/reincidencia con
   una reunión real y `?join=` desde Calendar.
4. Deploy del Edge Function (`supabase functions deploy weekly-matcher`) si
   no se hizo ya.
5. Build + deploy del frontend.

## 6. Commits en esta rama

- `3ff7260` — fix: usar DROP antes de recrear my_closeout_standing()
- `5f52f99` — feat: agregar pestaña "Análisis de Llamada" con persistencia en Supabase
