-- Integridad de datos: tres garantías que hasta ahora solo existían en memoria
-- de la aplicación y que la base no sostenía por su cuenta.
--
-- 1. La asistencia de una persona a una reunión es UNA fila, sin importar cómo
--    venga escrito el email.
-- 2. Una dupla tiene UNA propuesta por sala y semana, sin importar en qué orden
--    quedaron los dos participantes.
-- 3. Dos corridas del emparejador no pueden pisarse.
--
-- Los tres se refuerzan entre sí: sin el lock, el cron (cada 10 min) puede
-- solaparse consigo mismo; y solapado, es justamente cuando puede insertar la
-- dupla invertida o la asistencia duplicada que los UNIQUE de hoy no atrapan.

-- ============================================================
-- 1. ASISTENCIA: una fila por persona y reunión
-- ============================================================
-- El UNIQUE original era (meeting_id, member_email) sobre el texto crudo, pero
-- TODO el resto del sistema (RLS, weekly-matcher, join_room, los cierres)
-- compara emails con lower(). Con 'Ana@x.com' y 'ana@x.com' la base aceptaba
-- dos filas para la misma persona, y esa persona contaba dos veces en el score
-- de confiabilidad, en las faltas del mes y en el ranking público.

-- Primero se resuelven los duplicados que ya puedan existir: se conserva la
-- fila REPORTADA (cualquier estado distinto de 'confirmado' es información real
-- sobre lo que pasó) y, a igualdad, la más reciente. Las otras se borran.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY meeting_id, lower(member_email)
           ORDER BY (status <> 'confirmado') DESC, updated_at DESC NULLS LAST, id DESC
         ) AS rn
  FROM public.meeting_attendees
)
DELETE FROM public.meeting_attendees a
USING ranked r
WHERE a.id = r.id AND r.rn > 1;

-- Con los duplicados resueltos, el email queda normalizado en la propia fila:
-- así el dato guardado coincide con la forma en que se lo consulta.
UPDATE public.meeting_attendees
SET member_email = lower(member_email)
WHERE member_email <> lower(member_email);

-- El UNIQUE viejo se declaró en línea, así que su nombre lo eligió Postgres.
-- Se lo busca por definición en vez de adivinarlo.
DO $$
DECLARE v_name TEXT;
BEGIN
  SELECT conname INTO v_name
  FROM pg_constraint
  WHERE conrelid = 'public.meeting_attendees'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) ILIKE '%(meeting_id, member_email)%';
  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.meeting_attendees DROP CONSTRAINT %I', v_name);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS meeting_attendees_meeting_email_uniq
  ON public.meeting_attendees (meeting_id, lower(member_email));

-- ============================================================
-- 2. PROPUESTAS: una dupla no se propone dos veces al MISMO horario
-- ============================================================
-- El UNIQUE original era (room_id, week_start, member_a_email, member_b_email),
-- sensible al orden: la misma dupla insertada como (B,A) no chocaba con (A,B).
-- La aplicación lo compensa ordenando alfabéticamente (pairKeyOf), pero eso es
-- una garantía de código, no de base: dos escrituras que difieran en el orden
-- creaban dos propuestas "distintas" para la misma pareja.
--
-- Además ese UNIQUE era DEMASIADO estricto en el otro eje: una dupla puede
-- juntarse más de una vez en la semana cuando a los dos les sobran horas libres
-- y no queda nadie nuevo con quien emparejarlos. Lo que nunca puede repetirse
-- es la misma dupla en el MISMO horario — eso sí es un duplicado.
--
-- Por eso la clave incluye slot_start: permite varias sesiones de la misma
-- pareja en horarios distintos, y sigue bloqueando el duplicado real.

-- Se conserva la propuesta MÁS AVANZADA de cada (dupla, horario): una
-- confirmada le gana a una propuesta, que le gana a una expirada; a igualdad,
-- la más reciente.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY room_id, week_start, slot_start,
                        LEAST(lower(member_a_email), lower(member_b_email)),
                        GREATEST(lower(member_a_email), lower(member_b_email))
           ORDER BY CASE status
                      WHEN 'confirmado' THEN 0
                      WHEN 'propuesto'  THEN 1
                      WHEN 'rechazado'  THEN 2
                      WHEN 'cancelado'  THEN 3
                      ELSE 4
                    END,
                    updated_at DESC NULLS LAST, id DESC
         ) AS rn
  FROM public.match_proposals
)
DELETE FROM public.match_proposals p
USING ranked r
WHERE p.id = r.id AND r.rn > 1;

DO $$
DECLARE v_name TEXT;
BEGIN
  SELECT conname INTO v_name
  FROM pg_constraint
  WHERE conrelid = 'public.match_proposals'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) ILIKE '%member_a_email, member_b_email%';
  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.match_proposals DROP CONSTRAINT %I', v_name);
  END IF;
END $$;

-- LEAST/GREATEST sobre los dos emails en minúsculas: la dupla queda identificada
-- por sus dos integrantes y no por el orden en que los recorrió el emparejador.
CREATE UNIQUE INDEX IF NOT EXISTS match_proposals_pair_week_slot_uniq
  ON public.match_proposals (
    room_id,
    week_start,
    slot_start,
    LEAST(lower(member_a_email), lower(member_b_email)),
    GREATEST(lower(member_a_email), lower(member_b_email))
  );

-- ============================================================
-- 3. LOCK DEL EMPAREJADOR
-- ============================================================
-- El cron dispara weekly-matcher cada 10 minutos. Con muchas salas una corrida
-- puede tardar más que eso, y la siguiente arranca mientras la anterior sigue
-- leyendo y escribiendo: las dos ven el mismo estado de propuestas y horarios
-- ocupados antes de que ninguna confirme sus inserts.
--
-- Un pg_advisory_lock no sirve acá: la Edge Function habla por un pool de
-- conexiones y el lock vive atado a la sesión, que no es la misma entre
-- llamadas. Por eso el lock es una fila con VENCIMIENTO: si una corrida se cae
-- a mitad de camino, el lock se libera solo al vencer y el emparejador no queda
-- trabado para siempre esperando a un proceso que ya no existe.
CREATE TABLE IF NOT EXISTS public.job_locks (
  name       TEXT PRIMARY KEY,
  locked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE public.job_locks ENABLE ROW LEVEL SECURITY;

-- Sin políticas para anon/authenticated: es infraestructura interna. Solo la
-- Edge Function (service_role) y las funciones de abajo lo tocan.
DROP POLICY IF EXISTS "Service role manages job locks" ON public.job_locks;
CREATE POLICY "Service role manages job locks"
  ON public.job_locks FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Toma el lock si está libre o si el anterior ya venció. Devuelve true solo a
-- quien efectivamente se lo quedó.
--
-- El INSERT ... ON CONFLICT DO UPDATE con el WHERE del vencimiento resuelve la
-- carrera en una sola instrucción atómica: si dos corridas entran a la vez, la
-- segunda no encuentra fila que actualizar y se va con false.
CREATE OR REPLACE FUNCTION public.try_acquire_job_lock(
  p_name TEXT,
  p_ttl_seconds INT DEFAULT 600
)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_got BOOLEAN;
BEGIN
  INSERT INTO public.job_locks (name, locked_at, expires_at)
  VALUES (p_name, now(), now() + make_interval(secs => GREATEST(p_ttl_seconds, 30)))
  ON CONFLICT (name) DO UPDATE
    SET locked_at = now(),
        expires_at = now() + make_interval(secs => GREATEST(p_ttl_seconds, 30))
    WHERE public.job_locks.expires_at < now()
  RETURNING true INTO v_got;

  RETURN COALESCE(v_got, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_job_lock(p_name TEXT)
RETURNS VOID
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM public.job_locks WHERE name = p_name;
$$;

REVOKE ALL ON FUNCTION public.try_acquire_job_lock(text, int) FROM public;
REVOKE ALL ON FUNCTION public.release_job_lock(text) FROM public;
GRANT EXECUTE ON FUNCTION public.try_acquire_job_lock(text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_job_lock(text) TO service_role;
