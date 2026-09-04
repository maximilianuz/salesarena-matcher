-- Encuesta 2: la sesión puede no tener nada que calificar.
--
-- La Encuesta 2 asume que el compañero actuó de closer en la llamada: por eso
-- pregunta rapport, discovery, pitch, objeciones y cierre sobre SU desempeño.
-- Pero un role-play no siempre alterna roles dentro de la sesión: a veces uno
-- hace de closer toda la llamada y el otro de lead, sin invertirse. Ahí quien
-- hizo de closer no tiene nada que calificarle a su compañero -lead-, porque
-- el compañero nunca ejerció el rol que la encuesta evalúa.
--
-- Antes de este cambio esa persona quedaba trabada: no podía completar el
-- rating honestamente (inventaría una nota sobre algo que no pasó) y sin
-- completarlo quedaba bloqueada del próximo armado de duplas.
--
-- La pregunta se agrega al PRINCIPIO de la Encuesta 2, no a la Encuesta 1: la
-- persona que está por calificar es quien mejor sabe si su compañero llegó a
-- ser closer en esa llamada, y no hace falta cruzar con lo que respondió el
-- otro (que además sigue sellado). Si dice que no, la encuesta salta las 5
-- etapas directo al cierre -sigue habiendo lugar para el comentario libre- y
-- ese envío alcanza para saldar la deuda igual que uno completo.

ALTER TABLE public.session_skill_feedback
  ADD COLUMN IF NOT EXISTS partner_was_closer BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.session_skill_feedback ALTER COLUMN rapport_rating DROP NOT NULL;
ALTER TABLE public.session_skill_feedback ALTER COLUMN discovery_rating DROP NOT NULL;
ALTER TABLE public.session_skill_feedback ALTER COLUMN pitch_rating DROP NOT NULL;
ALTER TABLE public.session_skill_feedback ALTER COLUMN objections_rating DROP NOT NULL;
ALTER TABLE public.session_skill_feedback ALTER COLUMN closing_rating DROP NOT NULL;

-- Blindaje a nivel de tabla: si el compañero no fue closer, las 5 etapas
-- quedan en NULL sí o sí, nunca una nota fabricada. Los CHECK de cada columna
-- (rating IN (...)) ya toleran NULL -eso es lo que permite este constraint-,
-- así que no hace falta tocarlos.
ALTER TABLE public.session_skill_feedback
  ADD CONSTRAINT skill_feedback_ratings_require_closer CHECK (
    partner_was_closer OR (
      rapport_rating IS NULL AND rapport_comment IS NULL AND
      discovery_rating IS NULL AND discovery_comment IS NULL AND
      pitch_rating IS NULL AND pitch_comment IS NULL AND
      objections_rating IS NULL AND objections_comment IS NULL AND
      closing_rating IS NULL AND closing_comment IS NULL
    )
  );

DROP FUNCTION IF EXISTS public.submit_skill_feedback(uuid, text, text, text, text, text, text, text, text, text, text, text, text);

CREATE FUNCTION public.submit_skill_feedback(
  p_meeting_id UUID,
  p_learned TEXT,
  p_rapport_rating TEXT,
  p_rapport_comment TEXT,
  p_discovery_rating TEXT,
  p_discovery_comment TEXT,
  p_pitch_rating TEXT,
  p_pitch_comment TEXT,
  p_objections_rating TEXT,
  p_objections_comment TEXT,
  p_closing_rating TEXT,
  p_closing_comment TEXT,
  p_notes TEXT DEFAULT NULL,
  p_partner_was_closer BOOLEAN DEFAULT true
)
RETURNS public.session_skill_feedback
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email    TEXT := lower(nullif(auth.jwt() ->> 'email', ''));
  v_subject  TEXT;
  v_room     TEXT;
  v_end      TIMESTAMPTZ;
  v_happened TEXT;
  v_row      public.session_skill_feedback;
BEGIN
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_meeting_participant(p_meeting_id) THEN
    RAISE EXCEPTION 'NOT_A_PARTICIPANT' USING ERRCODE = '42501';
  END IF;

  SELECT m.room_id INTO v_room FROM public.meetings m WHERE m.id = p_meeting_id;
  IF v_room IS NULL THEN
    RAISE EXCEPTION 'MEETING_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  v_end := public.meeting_end_at(p_meeting_id);
  IF v_end IS NULL OR now() < v_end THEN
    RAISE EXCEPTION 'MEETING_NOT_FINISHED' USING ERRCODE = 'P0020';
  END IF;

  -- Hace falta haber cerrado la sesión primero (Encuesta 2 se encadena tras la
  -- Encuesta 1 en la UI) y que ESE cierre diga que sí hubo sesión real: sin
  -- eso no hay nada que evaluar, y alguien no podría fabricar una devolución
  -- sobre una reunión que él mismo dijo que no ocurrió.
  SELECT sc.happened INTO v_happened
  FROM public.session_closeouts sc
  WHERE sc.meeting_id = p_meeting_id AND sc.author_email = v_email;

  IF v_happened IS NULL THEN
    RAISE EXCEPTION 'CLOSEOUT_REQUIRED_FIRST' USING ERRCODE = 'P0024';
  END IF;
  IF v_happened = 'no_se_hizo' THEN
    RAISE EXCEPTION 'NOT_APPLICABLE' USING ERRCODE = 'P0025';
  END IF;

  -- Si el compañero nunca fue closer en esta sesión no hay 5 etapas que
  -- calificar: se descartan server-side, sin confiar en que el cliente no
  -- las haya mandado igual.
  IF NOT COALESCE(p_partner_was_closer, true) THEN
    p_rapport_rating := NULL; p_rapport_comment := NULL;
    p_discovery_rating := NULL; p_discovery_comment := NULL;
    p_pitch_rating := NULL; p_pitch_comment := NULL;
    p_objections_rating := NULL; p_objections_comment := NULL;
    p_closing_rating := NULL; p_closing_comment := NULL;
  ELSIF p_rapport_rating IS NULL OR p_discovery_rating IS NULL OR p_pitch_rating IS NULL
     OR p_objections_rating IS NULL OR p_closing_rating IS NULL THEN
    RAISE EXCEPTION 'RATINGS_REQUIRED' USING ERRCODE = 'P0026';
  END IF;

  SELECT lower(a.member_email) INTO v_subject
  FROM public.meeting_attendees a
  WHERE a.meeting_id = p_meeting_id AND lower(a.member_email) <> v_email
  LIMIT 1;

  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'NO_COUNTERPART' USING ERRCODE = 'P0022';
  END IF;

  INSERT INTO public.session_skill_feedback (
    meeting_id, room_id, author_email, subject_email, learned,
    partner_was_closer,
    rapport_rating, rapport_comment,
    discovery_rating, discovery_comment,
    pitch_rating, pitch_comment,
    objections_rating, objections_comment,
    closing_rating, closing_comment,
    notes,
    updated_at
  ) VALUES (
    p_meeting_id, v_room, v_email, v_subject, p_learned,
    COALESCE(p_partner_was_closer, true),
    p_rapport_rating, nullif(btrim(left(COALESCE(p_rapport_comment, ''), 300)), ''),
    p_discovery_rating, nullif(btrim(left(COALESCE(p_discovery_comment, ''), 300)), ''),
    p_pitch_rating, nullif(btrim(left(COALESCE(p_pitch_comment, ''), 300)), ''),
    p_objections_rating, nullif(btrim(left(COALESCE(p_objections_comment, ''), 300)), ''),
    p_closing_rating, nullif(btrim(left(COALESCE(p_closing_comment, ''), 300)), ''),
    nullif(btrim(left(COALESCE(p_notes, ''), 1000)), ''),
    now()
  )
  ON CONFLICT (meeting_id, author_email) DO UPDATE SET
    learned            = EXCLUDED.learned,
    partner_was_closer = EXCLUDED.partner_was_closer,
    rapport_rating     = EXCLUDED.rapport_rating,
    rapport_comment    = EXCLUDED.rapport_comment,
    discovery_rating   = EXCLUDED.discovery_rating,
    discovery_comment  = EXCLUDED.discovery_comment,
    pitch_rating       = EXCLUDED.pitch_rating,
    pitch_comment      = EXCLUDED.pitch_comment,
    objections_rating  = EXCLUDED.objections_rating,
    objections_comment = EXCLUDED.objections_comment,
    closing_rating     = EXCLUDED.closing_rating,
    closing_comment    = EXCLUDED.closing_comment,
    notes              = EXCLUDED.notes,
    updated_at         = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_skill_feedback(uuid, text, text, text, text, text, text, text, text, text, text, text, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_skill_feedback(uuid, text, text, text, text, text, text, text, text, text, text, text, text, boolean) TO authenticated;

-- Las lecturas también informan si había algo para calificar, para que una UI
-- futura no muestre "A mejorar" en las 5 etapas cuando en realidad es NULL.
CREATE OR REPLACE FUNCTION public.my_skill_feedback_received(p_limit INT DEFAULT 10)
RETURNS TABLE(
  meeting_id UUID,
  starts_at TIMESTAMPTZ,
  author_name TEXT,
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
    sf.meeting_id, m.starts_at, mem.name, sf.learned, sf.partner_was_closer,
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

CREATE OR REPLACE FUNCTION public.my_skill_feedback_given(p_limit INT DEFAULT 10)
RETURNS TABLE(
  meeting_id UUID,
  starts_at TIMESTAMPTZ,
  subject_name TEXT,
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
    sf.meeting_id, m.starts_at, mem.name, sf.learned, sf.partner_was_closer,
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
