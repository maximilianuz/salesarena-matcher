-- Cierre de sesión: lo que cada participante responde después del role-play.
--
-- Hasta ahora lo único que se medía era un click en el link de Meet: entrar,
-- clickear y irse a los dos minutos daba crédito completo. Y el formulario
-- manual que existía no llegaba a mostrarse nunca, porque el barrido
-- automático del weekly-matcher resolvía a los participantes a los 10 minutos
-- del inicio, mientras que el formulario recién se pedía al terminar la hora.
--
-- SOBRE CERRADO. Ninguno de los dos ve lo que respondió el otro. Nunca. Ni
-- antes ni después de abrirse. Lo único que cruza de una persona a la otra es
-- el elogio opcional, y solo una vez que ambos respondieron (o venció el
-- plazo). Sin esto, la segunda respuesta sería una reacción a la primera y el
-- mecanismo se convertiría en un intercambio de represalias.
--
-- Por eso la tabla no tiene NINGUNA política de lectura: todo pasa por
-- funciones SECURITY DEFINER que devuelven exactamente lo que cada rol puede
-- ver. Es el mismo criterio del lockdown de 20260813120000.

-- ============================================================
-- 1. TABLA (sin lectura directa para nadie)
-- ============================================================
CREATE TABLE IF NOT EXISTS session_closeouts (
  id BIGSERIAL PRIMARY KEY,
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  -- Quién responde y sobre quién. En un 1:1 el sujeto es "el otro", pero se
  -- guarda explícito para no tener que deducirlo en cada consulta.
  author_email TEXT NOT NULL,
  subject_email TEXT NOT NULL,

  -- Única pregunta sobre un hecho COMPARTIDO: es la que se puede cruzar entre
  -- las dos respuestas para detectar contradicciones.
  happened TEXT NOT NULL CHECK (happened IN ('completa', 'cortada', 'no_se_hizo')),
  -- Cómo participó la otra persona. Es lo que mueve el compromiso.
  engagement TEXT NOT NULL CHECK (engagement IN ('preparado', 'a_medias', 'no_participo')),
  -- Si sirvió para aprender. No puntúa a nadie: mide si la sala cumple su
  -- objetivo. Penalizar a alguien porque su compañero no aprendió sería
  -- castigar el resultado y no la conducta.
  learned TEXT NOT NULL CHECK (learned IN ('si', 'mas_o_menos', 'no')),
  cordial BOOLEAN NOT NULL DEFAULT true,
  -- Solo lo lee quien administra. Es la vía para algo que hay que mirar a mano.
  concern TEXT CHECK (concern IS NULL OR char_length(btrim(concern)) <= 600),
  -- Lo ÚNICO que la otra persona llega a ver, y solo en positivo.
  praise TEXT CHECK (praise IS NULL OR char_length(btrim(praise)) <= 240),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, author_email)
);

CREATE INDEX IF NOT EXISTS session_closeouts_meeting_idx ON session_closeouts (meeting_id);
CREATE INDEX IF NOT EXISTS session_closeouts_subject_idx ON session_closeouts (lower(subject_email));

ALTER TABLE session_closeouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages closeouts" ON session_closeouts;
CREATE POLICY "Service role manages closeouts"
  ON session_closeouts FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 2. PLAZO Y APERTURA DEL SOBRE
-- ============================================================
-- 48hs desde que termina la reunión. Pasado el plazo el cierre se abre con lo
-- que haya: la respuesta de quien sí contestó cuenta igual, y al que no
-- contestó le baja la reciprocidad. Debe coincidir con CLOSEOUT_WINDOW_MS en
-- src/closeouts.js.
CREATE OR REPLACE FUNCTION public.closeout_window_hours()
RETURNS INT LANGUAGE sql IMMUTABLE AS $$ SELECT 48 $$;

-- Fin de una reunión = inicio + duración. meetings.duration es nullable (se
-- agregó en 20260718120000 sobre filas ya existentes), así que se cae a 60
-- minutos igual que el cliente.
CREATE OR REPLACE FUNCTION public.meeting_end_at(p_meeting_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.starts_at + make_interval(mins => COALESCE(m.duration, 60))
  FROM public.meetings m WHERE m.id = p_meeting_id;
$$;

-- ¿Ya se abrió el sobre de esta reunión? Cuando respondieron los dos, o cuando
-- venció el plazo.
--
-- Mientras siga cerrado NADA de lo que haya adentro puede salir: ni el elogio
-- ni el puntaje. Si el compromiso se pudiera consultar antes, quien todavía no
-- respondió miraría cómo lo calificaron y contestaría en consecuencia — que es
-- exactamente lo que el sobre viene a impedir.
CREATE OR REPLACE FUNCTION public.closeout_is_open(p_meeting_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT (SELECT count(*) FROM public.session_closeouts sc WHERE sc.meeting_id = p_meeting_id) >= 2
      OR now() > public.meeting_end_at(p_meeting_id)
                 + make_interval(hours => public.closeout_window_hours());
$$;

-- ============================================================
-- 3. RESPONDER EL CIERRE
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_session_closeout(
  p_meeting_id UUID,
  p_happened TEXT,
  p_engagement TEXT,
  p_learned TEXT,
  p_cordial BOOLEAN,
  p_concern TEXT DEFAULT NULL,
  p_praise TEXT DEFAULT NULL
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

  -- Solo la dupla de ESA reunión puede cerrarla. Sin esto, cualquier miembro de
  -- la sala podría calificar sesiones en las que no estuvo.
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

  -- Con el sobre ya abierto no se puede corregir la respuesta. Se puede editar
  -- todas las veces que haga falta MIENTRAS siga cerrado; una vez que ambos
  -- respondieron, queda firme. Sin este cierre, quien contesta segundo podría
  -- ver su puntaje ya actualizado y volver para castigar al otro.
  IF public.closeout_is_open(p_meeting_id) THEN
    RAISE EXCEPTION 'CLOSEOUT_ALREADY_OPEN' USING ERRCODE = 'P0023';
  END IF;

  -- El sujeto es el otro participante: no se acepta como parámetro para que
  -- nadie pueda dirigir su respuesta a una persona distinta de su compañero.
  SELECT lower(a.member_email) INTO v_subject
  FROM public.meeting_attendees a
  WHERE a.meeting_id = p_meeting_id AND lower(a.member_email) <> v_email
  LIMIT 1;

  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'NO_COUNTERPART' USING ERRCODE = 'P0022';
  END IF;

  INSERT INTO public.session_closeouts (
    meeting_id, room_id, author_email, subject_email,
    happened, engagement, learned, cordial, concern, praise, updated_at
  ) VALUES (
    p_meeting_id, v_room, v_email, v_subject,
    p_happened, p_engagement, p_learned, COALESCE(p_cordial, true),
    nullif(btrim(left(COALESCE(p_concern, ''), 600)), ''),
    nullif(btrim(left(COALESCE(p_praise, ''), 240)), ''),
    now()
  )
  ON CONFLICT (meeting_id, author_email) DO UPDATE SET
    happened   = EXCLUDED.happened,
    engagement = EXCLUDED.engagement,
    learned    = EXCLUDED.learned,
    cordial    = EXCLUDED.cordial,
    concern    = EXCLUDED.concern,
    praise     = EXCLUDED.praise,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_session_closeout(uuid, text, text, text, boolean, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_session_closeout(uuid, text, text, text, boolean, text, text) TO authenticated;

-- ============================================================
-- 4. QUÉ CIERRES ME FALTAN
-- ============================================================
-- Reuniones ya terminadas, dentro del plazo, en las que participé y todavía no
-- respondí. Devuelve los datos del compañero para poder armar el formulario sin
-- exponer nada del resto de la sala.
CREATE OR REPLACE FUNCTION public.my_open_closeouts()
RETURNS TABLE(
  meeting_id UUID,
  room_id TEXT,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  closes_at TIMESTAMPTZ,
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
    m.id,
    m.room_id,
    m.starts_at,
    public.meeting_end_at(m.id),
    public.meeting_end_at(m.id) + make_interval(hours => public.closeout_window_hours()),
    lower(otro.member_email),
    mem.name,
    mem.avatar_url
  FROM public.meetings m
  JOIN public.meeting_attendees mia
    ON mia.meeting_id = m.id AND lower(mia.member_email) = (SELECT email FROM me)
  JOIN public.meeting_attendees otro
    ON otro.meeting_id = m.id AND lower(otro.member_email) <> (SELECT email FROM me)
  LEFT JOIN public.members mem
    ON lower(mem.email) = lower(otro.member_email) AND mem.room_id = m.room_id
  WHERE (SELECT email FROM me) IS NOT NULL
    AND m.starts_at IS NOT NULL
    AND now() >= public.meeting_end_at(m.id)
    AND now() <= public.meeting_end_at(m.id) + make_interval(hours => public.closeout_window_hours())
    -- Una reunión que se cayó por cancelación no tiene nada que cerrar.
    AND NOT EXISTS (
      SELECT 1 FROM public.meeting_attendees c
      WHERE c.meeting_id = m.id AND c.status IN ('cancelado_con_aviso', 'cancelado_tarde')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.session_closeouts sc
      WHERE sc.meeting_id = m.id AND sc.author_email = (SELECT email FROM me)
    )
  ORDER BY m.starts_at ASC;
$$;

REVOKE ALL ON FUNCTION public.my_open_closeouts() FROM public;
GRANT EXECUTE ON FUNCTION public.my_open_closeouts() TO authenticated;

-- ============================================================
-- 5. MI SITUACIÓN (nunca la de otro)
-- ============================================================
-- Compromiso, reciprocidad y elogios recibidos de quien llama. No expone en
-- ningún caso quién dijo qué: el compromiso llega ya promediado y los elogios
-- van sin autor.
--
-- Las reuniones EN DISPUTA (una respuesta dice que no se hizo y la otra que sí)
-- no puntúan para ninguno de los dos. Es lo que hace que acusar en falso no
-- sirva para hundir al otro: solo anula la reunión. Debe coincidir con
-- getEngagement en src/closeouts.js.
CREATE OR REPLACE FUNCTION public.my_closeout_standing()
RETURNS TABLE(
  engagement_pct INT,
  engagement_count BIGINT,
  reciprocity_pct INT,
  owed_count BIGINT,
  answered_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (SELECT lower(nullif(auth.jwt() ->> 'email', '')) AS email),
  en_disputa AS (
    SELECT sc.meeting_id
    FROM public.session_closeouts sc
    GROUP BY sc.meeting_id
    HAVING count(*) >= 2
       AND count(*) FILTER (WHERE sc.happened = 'no_se_hizo') > 0
       AND count(*) FILTER (WHERE sc.happened <> 'no_se_hizo') > 0
  ),
  sobre_mi AS (
    SELECT CASE sc.engagement
             WHEN 'preparado' THEN 1.0
             WHEN 'a_medias' THEN 0.5
             ELSE 0.0
           END AS val
    FROM public.session_closeouts sc
    JOIN public.meetings m ON m.id = sc.meeting_id
    WHERE lower(sc.subject_email) = (SELECT email FROM me)
      -- Solo sobres ABIERTOS: si el puntaje se moviera apenas responde el otro,
      -- consultarlo antes de contestar delataría cómo me calificó.
      AND public.closeout_is_open(sc.meeting_id)
      AND sc.meeting_id NOT IN (SELECT meeting_id FROM en_disputa)
      AND m.starts_at >= now() - interval '60 days'
  ),
  me_tocaba AS (
    SELECT m.id
    FROM public.meetings m
    JOIN public.meeting_attendees mia
      ON mia.meeting_id = m.id AND lower(mia.member_email) = (SELECT email FROM me)
    WHERE m.starts_at IS NOT NULL
      AND now() >= public.meeting_end_at(m.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.meeting_attendees c
        WHERE c.meeting_id = m.id AND c.status IN ('cancelado_con_aviso', 'cancelado_tarde')
      )
  ),
  respondi AS (
    SELECT sc.meeting_id FROM public.session_closeouts sc
    WHERE sc.author_email = (SELECT email FROM me)
  )
  SELECT
    CASE WHEN (SELECT count(*) FROM sobre_mi) = 0 THEN NULL
         ELSE round(avg(val) * 100)::INT END,
    (SELECT count(*) FROM sobre_mi),
    CASE WHEN (SELECT count(*) FROM me_tocaba) = 0 THEN NULL
         ELSE round(
           (SELECT count(*) FROM me_tocaba t WHERE t.id IN (SELECT meeting_id FROM respondi))::NUMERIC
           / (SELECT count(*) FROM me_tocaba) * 100
         )::INT END,
    (SELECT count(*) FROM me_tocaba),
    (SELECT count(*) FROM me_tocaba t WHERE t.id IN (SELECT meeting_id FROM respondi))
  FROM sobre_mi;
$$;

REVOKE ALL ON FUNCTION public.my_closeout_standing() FROM public;
GRANT EXECUTE ON FUNCTION public.my_closeout_standing() TO authenticated;

-- Elogios recibidos, sin autor y solo de sobres ya abiertos (los dos
-- respondieron, o venció el plazo).
CREATE OR REPLACE FUNCTION public.my_closeout_praise(p_limit INT DEFAULT 10)
RETURNS TABLE(praise TEXT, received_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (SELECT lower(nullif(auth.jwt() ->> 'email', '')) AS email)
  SELECT sc.praise, m.starts_at
  FROM public.session_closeouts sc
  JOIN public.meetings m ON m.id = sc.meeting_id
  WHERE lower(sc.subject_email) = (SELECT email FROM me)
    AND sc.praise IS NOT NULL
    AND public.closeout_is_open(sc.meeting_id)
  ORDER BY m.starts_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;

REVOKE ALL ON FUNCTION public.my_closeout_praise(int) FROM public;
GRANT EXECUTE ON FUNCTION public.my_closeout_praise(int) TO authenticated;

-- ============================================================
-- 6. LO QUE HAY QUE MIRAR A MANO (solo administrador)
-- ============================================================
-- Dos cosas que ningún promedio resuelve solo: los reportes de trato no cordial
-- y las reuniones en disputa. En la disputa se señala a quien quedó fuera del
-- consenso, porque lo que importa no es el caso suelto sino la reincidencia.
CREATE OR REPLACE FUNCTION public.list_closeout_flags()
RETURNS TABLE(
  kind TEXT,
  meeting_id UUID,
  room_id TEXT,
  happened_at TIMESTAMPTZ,
  subject_email TEXT,
  detail TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'NOT_PLATFORM_ADMIN' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT 'trato'::TEXT, sc.meeting_id, sc.room_id, m.starts_at,
         lower(sc.subject_email), sc.concern
  FROM public.session_closeouts sc
  JOIN public.meetings m ON m.id = sc.meeting_id
  WHERE sc.cordial = false AND sc.concern IS NOT NULL

  UNION ALL

  SELECT 'disputa'::TEXT, d.meeting_id, d.room_id, d.starts_at,
         d.outlier_email,
         'Una respuesta dice que la sesión no se hizo y la otra que sí.'
  FROM (
    SELECT sc.meeting_id, min(sc.room_id) AS room_id, min(m.starts_at) AS starts_at,
           min(lower(sc.author_email)) FILTER (WHERE sc.happened = 'no_se_hizo') AS outlier_email
    FROM public.session_closeouts sc
    JOIN public.meetings m ON m.id = sc.meeting_id
    GROUP BY sc.meeting_id
    HAVING count(*) >= 2
       AND count(*) FILTER (WHERE sc.happened = 'no_se_hizo') > 0
       AND count(*) FILTER (WHERE sc.happened <> 'no_se_hizo') > 0
  ) d
  ORDER BY 4 DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_closeout_flags() FROM public;
GRANT EXECUTE ON FUNCTION public.list_closeout_flags() TO authenticated;
