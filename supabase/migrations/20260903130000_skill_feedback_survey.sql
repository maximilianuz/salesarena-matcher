-- Encuesta 2: feedback de habilidades, inmediato y visible para ambos.
--
-- El cierre de sesión (session_closeouts) queda sellado a propósito: es lo que
-- alimenta el score de emparejamiento, y por eso nadie ve nunca lo que
-- respondió el otro. Pero eso mismo lo vuelve inútil como devolución para
-- mejorar — nadie aprende de una nota que nunca ve.
--
-- Esta es una segunda encuesta, DELIBERADAMENTE separada de la primera:
--   * Se muestra apenas se envía el cierre, y solo si `happened` no fue
--     'no_se_hizo' (sin sesión real no hay nada que evaluar).
--   * No suma ni resta al score de credibilidad: es pura devolución.
--   * NO está sellada. El destinatario la ve enseguida, y quien la escribió
--     también puede volver a verla — es un intercambio, no un buzón anónimo.
--   * Es obligatoria: mientras alguien tenga una pendiente, queda afuera de la
--     próxima corrida de weekly-matcher. Es el único mecanismo del sistema que
--     castiga con bloqueo algo que no es una falta o una mentira, así que se
--     levanta apenas se completa — no hay que esperar al mes que viene.
--
-- Debe coincidir con src/closeouts.js y con supabase/functions/weekly-matcher.

-- ============================================================
-- 1. LA PRIMERA ENCUESTA SE ACHICA
-- ============================================================
-- `learned` se muda a esta segunda encuesta (tiene más sentido junto a la
-- devolución de habilidades que junto a lo que puntúa). `praise` se reemplaza
-- por las 5 categorías de abajo. Ninguna de las dos se borra de la tabla vieja
-- -- las respuestas ya dadas siguen existiendo tal cual -- pero dejan de ser
-- obligatorias y la nueva función ya no las pide.
ALTER TABLE public.session_closeouts ALTER COLUMN learned DROP NOT NULL;

DROP FUNCTION IF EXISTS public.submit_session_closeout(uuid, text, text, text, boolean, text, text);

CREATE FUNCTION public.submit_session_closeout(
  p_meeting_id UUID,
  p_happened TEXT,
  p_engagement TEXT,
  p_cordial BOOLEAN,
  p_concern TEXT DEFAULT NULL
)
RETURNS public.session_closeouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email   TEXT := lower(nullif(auth.jwt() ->> 'email', ''));
  v_subject TEXT;
  v_room    TEXT;
  v_end     TIMESTAMPTZ;
  v_row     public.session_closeouts;
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

  IF now() > v_end + make_interval(hours => public.closeout_window_hours()) THEN
    RAISE EXCEPTION 'CLOSEOUT_WINDOW_CLOSED' USING ERRCODE = 'P0021';
  END IF;

  SELECT lower(a.member_email) INTO v_subject
  FROM public.meeting_attendees a
  WHERE a.meeting_id = p_meeting_id AND lower(a.member_email) <> v_email
  LIMIT 1;

  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'NO_COUNTERPART' USING ERRCODE = 'P0022';
  END IF;

  INSERT INTO public.session_closeouts (
    meeting_id, room_id, author_email, subject_email,
    happened, engagement, cordial, concern, updated_at
  ) VALUES (
    p_meeting_id, v_room, v_email, v_subject,
    p_happened, p_engagement, COALESCE(p_cordial, true),
    nullif(btrim(left(COALESCE(p_concern, ''), 600)), ''),
    now()
  )
  ON CONFLICT (meeting_id, author_email) DO UPDATE SET
    happened   = EXCLUDED.happened,
    engagement = EXCLUDED.engagement,
    cordial    = EXCLUDED.cordial,
    concern    = EXCLUDED.concern,
    updated_at = now()
  RETURNING * INTO v_row;

  PERFORM public.reconcile_attendance_from_closeouts(p_meeting_id);

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_session_closeout(uuid, text, text, boolean, text) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_session_closeout(uuid, text, text, boolean, text) TO authenticated;

-- ============================================================
-- 2. TABLA DE LA SEGUNDA ENCUESTA (visible, no sellada)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.session_skill_feedback (
  id BIGSERIAL PRIMARY KEY,
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  author_email TEXT NOT NULL,
  subject_email TEXT NOT NULL,

  -- Recuperado del cierre viejo: no puntúa, es agregado para la sala.
  learned TEXT NOT NULL CHECK (learned IN ('si', 'mas_o_menos', 'no')),

  -- Las 5 etapas de una sesión high-ticket, en el orden en que ocurren en la
  -- llamada. Cada una es un rating de 3 niveles + comentario libre opcional
  -- para hacerlo accionable.
  rapport_rating TEXT NOT NULL CHECK (rapport_rating IN ('a_mejorar', 'bien', 'muy_bien')),
  rapport_comment TEXT CHECK (rapport_comment IS NULL OR char_length(btrim(rapport_comment)) <= 300),
  discovery_rating TEXT NOT NULL CHECK (discovery_rating IN ('a_mejorar', 'bien', 'muy_bien')),
  discovery_comment TEXT CHECK (discovery_comment IS NULL OR char_length(btrim(discovery_comment)) <= 300),
  pitch_rating TEXT NOT NULL CHECK (pitch_rating IN ('a_mejorar', 'bien', 'muy_bien')),
  pitch_comment TEXT CHECK (pitch_comment IS NULL OR char_length(btrim(pitch_comment)) <= 300),
  objections_rating TEXT NOT NULL CHECK (objections_rating IN ('a_mejorar', 'bien', 'muy_bien')),
  objections_comment TEXT CHECK (objections_comment IS NULL OR char_length(btrim(objections_comment)) <= 300),
  closing_rating TEXT NOT NULL CHECK (closing_rating IN ('a_mejorar', 'bien', 'muy_bien')),
  closing_comment TEXT CHECK (closing_comment IS NULL OR char_length(btrim(closing_comment)) <= 300),

  -- Campo libre por si algo que le importa a la persona no entra en ninguna
  -- de las 5 etapas fijas. Totalmente opcional: las etapas son la estructura
  -- obligatoria, esto es el margen para lo que la estructura no previó.
  notes TEXT CHECK (notes IS NULL OR char_length(btrim(notes)) <= 500),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, author_email)
);

CREATE INDEX IF NOT EXISTS session_skill_feedback_meeting_idx ON public.session_skill_feedback (meeting_id);
CREATE INDEX IF NOT EXISTS session_skill_feedback_subject_idx ON public.session_skill_feedback (lower(subject_email));
CREATE INDEX IF NOT EXISTS session_skill_feedback_author_idx ON public.session_skill_feedback (lower(author_email));

ALTER TABLE public.session_skill_feedback ENABLE ROW LEVEL SECURITY;

-- Sin política de lectura directa para authenticated: aunque esta encuesta SÍ
-- se comparte, se comparte con el destinatario y el autor exactamente, no con
-- cualquiera que sepa armar una query. Todo pasa por las funciones de abajo,
-- mismo criterio que session_closeouts.
DROP POLICY IF EXISTS "Service role manages skill feedback" ON public.session_skill_feedback;
CREATE POLICY "Service role manages skill feedback"
  ON public.session_skill_feedback FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 3. RESPONDER LA ENCUESTA 2
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_skill_feedback(
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
  p_notes TEXT DEFAULT NULL
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

  SELECT lower(a.member_email) INTO v_subject
  FROM public.meeting_attendees a
  WHERE a.meeting_id = p_meeting_id AND lower(a.member_email) <> v_email
  LIMIT 1;

  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'NO_COUNTERPART' USING ERRCODE = 'P0022';
  END IF;

  INSERT INTO public.session_skill_feedback (
    meeting_id, room_id, author_email, subject_email, learned,
    rapport_rating, rapport_comment,
    discovery_rating, discovery_comment,
    pitch_rating, pitch_comment,
    objections_rating, objections_comment,
    closing_rating, closing_comment,
    notes,
    updated_at
  ) VALUES (
    p_meeting_id, v_room, v_email, v_subject, p_learned,
    p_rapport_rating, nullif(btrim(left(COALESCE(p_rapport_comment, ''), 300)), ''),
    p_discovery_rating, nullif(btrim(left(COALESCE(p_discovery_comment, ''), 300)), ''),
    p_pitch_rating, nullif(btrim(left(COALESCE(p_pitch_comment, ''), 300)), ''),
    p_objections_rating, nullif(btrim(left(COALESCE(p_objections_comment, ''), 300)), ''),
    p_closing_rating, nullif(btrim(left(COALESCE(p_closing_comment, ''), 300)), ''),
    nullif(btrim(left(COALESCE(p_notes, ''), 500)), ''),
    now()
  )
  ON CONFLICT (meeting_id, author_email) DO UPDATE SET
    learned            = EXCLUDED.learned,
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

REVOKE ALL ON FUNCTION public.submit_skill_feedback(uuid, text, text, text, text, text, text, text, text, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_skill_feedback(uuid, text, text, text, text, text, text, text, text, text, text, text, text) TO authenticated;

-- ============================================================
-- 4. QUÉ ENCUESTAS 2 ME FALTAN (esto es lo que bloquea el emparejamiento)
-- ============================================================
-- A diferencia de my_open_closeouts, esto NO tiene ventana de vencimiento: la
-- deuda queda pendiente indefinidamente porque es la propia persona la que se
-- perjudica (sin esto, no vuelve a entrar en el pool de la próxima corrida).
-- Debe coincidir con el bloqueo replicado en weekly-matcher/index.ts.
CREATE OR REPLACE FUNCTION public.my_open_skill_feedback()
RETURNS TABLE(
  meeting_id UUID,
  starts_at TIMESTAMPTZ,
  partner_email TEXT,
  partner_name TEXT,
  partner_avatar_url TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (SELECT lower(nullif(auth.jwt() ->> 'email', '')) AS email)
  SELECT
    sc.meeting_id,
    m.starts_at,
    lower(sc.subject_email),
    mem.name,
    mem.avatar_url
  FROM public.session_closeouts sc
  JOIN public.meetings m ON m.id = sc.meeting_id
  LEFT JOIN public.members mem
    ON lower(mem.email) = lower(sc.subject_email) AND mem.room_id = sc.room_id
  WHERE sc.author_email = (SELECT email FROM me)
    AND sc.happened <> 'no_se_hizo'
    AND NOT EXISTS (
      SELECT 1 FROM public.session_skill_feedback sf
      WHERE sf.meeting_id = sc.meeting_id AND sf.author_email = sc.author_email
    )
  ORDER BY m.starts_at ASC;
$$;

REVOKE ALL ON FUNCTION public.my_open_skill_feedback() FROM public;
GRANT EXECUTE ON FUNCTION public.my_open_skill_feedback() TO authenticated;

-- ============================================================
-- 5. LEER LA DEVOLUCIÓN (destinatario y autor, nunca un tercero)
-- ============================================================
CREATE OR REPLACE FUNCTION public.my_skill_feedback_received(p_limit INT DEFAULT 10)
RETURNS TABLE(
  meeting_id UUID,
  starts_at TIMESTAMPTZ,
  author_name TEXT,
  learned TEXT,
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
    sf.meeting_id, m.starts_at, mem.name, sf.learned,
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
    sf.meeting_id, m.starts_at, mem.name, sf.learned,
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
