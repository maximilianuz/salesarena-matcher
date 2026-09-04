-- El historial de devoluciones necesita la foto de la otra persona.
--
-- my_skill_feedback_received / _given ya devolvían el nombre, pero la pantalla
-- de historial muestra una tarjeta por sesión y sin el avatar hay que adivinarlo
-- cruzando el nombre contra la lista de miembros — y el nombre no es una clave:
-- dos homónimos en la misma sala se pisarían la foto (el mismo problema que
-- 20260813123000 arregló en availabilities, ahí por horarios).
--
-- Se agrega una columna a cada función. Cambiar las columnas de retorno obliga
-- a DROP + CREATE: CREATE OR REPLACE falla con 42P13 cuando cambia el tipo de
-- la fila devuelta.

DROP FUNCTION IF EXISTS public.my_skill_feedback_received(int);
DROP FUNCTION IF EXISTS public.my_skill_feedback_given(int);

CREATE FUNCTION public.my_skill_feedback_received(p_limit INT DEFAULT 20)
RETURNS TABLE(
  meeting_id UUID,
  starts_at TIMESTAMPTZ,
  author_name TEXT,
  author_avatar_url TEXT,
  learned TEXT,
  partner_was_closer BOOLEAN,
  rapport_rating TEXT, rapport_comment TEXT,
  discovery_rating TEXT, discovery_comment TEXT,
  pitch_rating TEXT, pitch_comment TEXT,
  objections_rating TEXT, objections_comment TEXT,
  closing_rating TEXT, closing_comment TEXT,
  notes TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (SELECT lower(nullif(auth.jwt() ->> 'email', '')) AS email)
  SELECT
    sf.meeting_id, m.starts_at, mem.name, mem.avatar_url, sf.learned, sf.partner_was_closer,
    sf.rapport_rating, sf.rapport_comment,
    sf.discovery_rating, sf.discovery_comment,
    sf.pitch_rating, sf.pitch_comment,
    sf.objections_rating, sf.objections_comment,
    sf.closing_rating, sf.closing_comment,
    sf.notes
  FROM public.session_skill_feedback sf
  JOIN public.meetings m ON m.id = sf.meeting_id
  LEFT JOIN public.members mem
    ON lower(mem.email) = lower(sf.author_email) AND mem.room_id = sf.room_id
  WHERE lower(sf.subject_email) = (SELECT email FROM me)
  ORDER BY m.starts_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;

REVOKE ALL ON FUNCTION public.my_skill_feedback_received(int) FROM public;
GRANT EXECUTE ON FUNCTION public.my_skill_feedback_received(int) TO authenticated;

CREATE FUNCTION public.my_skill_feedback_given(p_limit INT DEFAULT 20)
RETURNS TABLE(
  meeting_id UUID,
  starts_at TIMESTAMPTZ,
  subject_name TEXT,
  subject_avatar_url TEXT,
  learned TEXT,
  partner_was_closer BOOLEAN,
  rapport_rating TEXT, rapport_comment TEXT,
  discovery_rating TEXT, discovery_comment TEXT,
  pitch_rating TEXT, pitch_comment TEXT,
  objections_rating TEXT, objections_comment TEXT,
  closing_rating TEXT, closing_comment TEXT,
  notes TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (SELECT lower(nullif(auth.jwt() ->> 'email', '')) AS email)
  SELECT
    sf.meeting_id, m.starts_at, mem.name, mem.avatar_url, sf.learned, sf.partner_was_closer,
    sf.rapport_rating, sf.rapport_comment,
    sf.discovery_rating, sf.discovery_comment,
    sf.pitch_rating, sf.pitch_comment,
    sf.objections_rating, sf.objections_comment,
    sf.closing_rating, sf.closing_comment,
    sf.notes
  FROM public.session_skill_feedback sf
  JOIN public.meetings m ON m.id = sf.meeting_id
  LEFT JOIN public.members mem
    ON lower(mem.email) = lower(sf.subject_email) AND mem.room_id = sf.room_id
  WHERE lower(sf.author_email) = (SELECT email FROM me)
  ORDER BY m.starts_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;

REVOKE ALL ON FUNCTION public.my_skill_feedback_given(int) FROM public;
GRANT EXECUTE ON FUNCTION public.my_skill_feedback_given(int) TO authenticated;

-- my_closeout_praise queda huérfana: el elogio del cierre lo reemplazó la
-- Encuesta 2 (20260903130000 dejó de pedir `praise`), así que la función no
-- puede devolver nada nuevo nunca más. Se borra junto con la sección muerta
-- que la mostraba en el panel. La columna `praise` NO se toca: las respuestas
-- viejas, si alguna vez las hubo, siguen existiendo en la tabla.
DROP FUNCTION IF EXISTS public.my_closeout_praise(int);
