-- Auditoría 2026-07-18: dos bloqueos funcionales detectados.
--
-- 1. match_proposals.status_a / status_b se crearon (20240715) con
--    CHECK (IN ('si','no')), pero la app escribe 'aceptado' / 'rechazado'
--    (respondToProposal) y el mock usa 'pendiente'. Resultado en producción:
--    CUALQUIER aceptación o rechazo de propuesta violaba el CHECK y el
--    UPDATE fallaba → el doble opt-in nunca podía completarse y todas las
--    propuestas terminaban expirando.
--
-- 2. templates se creó (20240713) con columnas inventadas
--    (created_by/name/content) que la app jamás usó. La app guarda la
--    plantilla base con la misma forma que availabilities
--    ("user"/day_idx/start_hour/end_hour). Se alinean las columnas para que
--    la plantilla pueda persistirse (antes vivía solo en memoria del
--    navegador y se perdía al recargar).

-- ============ MATCH_PROPOSALS: valores reales del doble opt-in ============

ALTER TABLE match_proposals DROP CONSTRAINT IF EXISTS match_proposals_status_a_check;
ALTER TABLE match_proposals DROP CONSTRAINT IF EXISTS match_proposals_status_b_check;

-- Normalizar filas legadas (si alguna llegó a guardarse con 'si'/'no')
UPDATE match_proposals SET status_a = 'aceptado'  WHERE status_a = 'si';
UPDATE match_proposals SET status_a = 'rechazado' WHERE status_a = 'no';
UPDATE match_proposals SET status_b = 'aceptado'  WHERE status_b = 'si';
UPDATE match_proposals SET status_b = 'rechazado' WHERE status_b = 'no';

-- NULL = sin responder (es lo que inserta/reactiva el weekly-matcher);
-- 'pendiente' se admite por compatibilidad con el cliente.
ALTER TABLE match_proposals ADD CONSTRAINT match_proposals_status_a_check
  CHECK (status_a IS NULL OR status_a IN ('pendiente', 'aceptado', 'rechazado'));
ALTER TABLE match_proposals ADD CONSTRAINT match_proposals_status_b_check
  CHECK (status_b IS NULL OR status_b IN ('pendiente', 'aceptado', 'rechazado'));

-- ============ TEMPLATES: misma forma que availabilities ============

ALTER TABLE templates DROP COLUMN IF EXISTS created_by;
ALTER TABLE templates DROP COLUMN IF EXISTS name;
ALTER TABLE templates DROP COLUMN IF EXISTS content;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS "user" TEXT;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS day_idx INTEGER;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS start_hour NUMERIC;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS end_hour NUMERIC;
