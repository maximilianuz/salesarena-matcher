-- Sobre SELLADO y costo de mentir en el cierre de sesión.
--
-- Dos cambios sobre 20260815120000_session_closeouts.sql.
--
-- 1) EL SOBRE NO SE ABRE NUNCA ENTRE PARTICIPANTES.
--
-- Antes el cierre "se abría" cuando respondían los dos o cuando vencía el
-- plazo, y a partir de ahí puntuaba y mostraba el elogio. El problema es el
-- primer disparador: si el puntaje se mueve en el instante en que el compañero
-- contesta, el MOMENTO en que se mueve ya es información sobre su respuesta.
-- Quien miraba su compromiso antes de cerrar podía deducir cómo lo habían
-- calificado, que es justo lo que el sobre venía a impedir.
--
-- Ahora el único disparador es el reloj: 48hs después de terminar la reunión.
-- Sobre el reloj no hay nada que deducir, porque el momento es el mismo haya
-- contestado uno solo o los dos. Las cuatro respuestas que puntúan no se
-- comparten nunca; lo único que cruza sigue siendo el elogio opcional, y
-- también por plazo.
--
-- Efecto lateral buscado: desaparece el congelamiento por "tu compañero ya
-- respondió". El cierre se puede corregir mientras el plazo corra y queda firme
-- al vencer, sin que el bloqueo delate que el otro contestó.
--
-- 2) MENTIR CUESTA.
--
-- Cuando una respuesta dice que la sesión no se hizo y la otra que sí, hasta
-- ahora la reunión quedaba neutra para los dos. Eso protegía al acusado en
-- falso, pero también volvía la mentira gratis y hasta rentable: negar una
-- sesión borraba la mala nota que uno ya sabía que iba a recibir.
--
-- Ahora se cruza con el registro de ingreso al Meet (meeting_attendees.joined_at).
-- Si los DOS abrieron el enlace desde la app, el "no se hizo" contradice el
-- registro y se trata como falso:
--   * se descarta la respuesta de quien mintió (la del compañero sí cuenta),
--   * su credibilidad se multiplica por 0.6 por cada mentira, con piso 0.2,
--   * dos mentiras en el mismo mes calendario lo dejan fuera de la rotación
--     hasta el 1° del mes siguiente, igual que 3 faltas.
-- Sin registro que respalde a nadie, la disputa sigue quedando neutra: el
-- silencio del registro no acusa.
--
-- Debe coincidir con src/closeouts.js y con la Edge Function weekly-matcher.

-- ============================================================
-- 1. EL PLAZO ES LO ÚNICO QUE ABRE EL CIERRE
-- ============================================================
-- Reemplaza a closeout_is_open(): el nombre viejo decía "abierto" y ahora
-- justamente nada se abre entre participantes. Lo que cambia a las 48hs es que
-- el cierre empieza a CONTAR.
CREATE OR REPLACE FUNCTION public.closeout_counts(p_meeting_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT now() >= public.meeting_end_at(p_meeting_id)
                  + make_interval(hours => public.closeout_window_hours());
$$;

-- ============================================================
-- 2. DISPUTAS Y EVIDENCIA
-- ============================================================
-- Una disputa es una reunión donde una respuesta niega la sesión y la otra la
-- da por hecha. 'completa' vs 'cortada' NO es disputa: son dos formas de decir
-- que ocurrió, y discutir el grado no hace a nadie mentiroso.
--
-- corroborated = los dos asistentes tienen joined_at, o sea que los dos
-- abrieron el enlace de Meet desde la app. No prueba que hayan hablado, pero sí
-- que los dos estuvieron ahí: contra eso, "no se hizo" deja de ser un
-- malentendido posible. Si a alguno le falta el dato —reuniones viejas, o quien
-- entró desde el mail de Calendar sin pasar por la app— no hay corroboración.
CREATE OR REPLACE FUNCTION public.closeout_disputes()
RETURNS TABLE(meeting_id UUID, outlier_email TEXT, corroborated BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    sc.meeting_id,
    min(lower(sc.author_email)) FILTER (WHERE sc.happened = 'no_se_hizo'),
    (SELECT count(*) FROM public.meeting_attendees a
      WHERE a.meeting_id = sc.meeting_id) >= 2
    AND NOT EXISTS (
      SELECT 1 FROM public.meeting_attendees a
      WHERE a.meeting_id = sc.meeting_id AND a.joined_at IS NULL
    )
  FROM public.session_closeouts sc
  GROUP BY sc.meeting_id
  HAVING count(*) >= 2
     AND count(*) FILTER (WHERE sc.happened = 'no_se_hizo') > 0
     AND count(*) FILTER (WHERE sc.happened <> 'no_se_hizo') > 0;
$$;

-- Constantes de la sanción, en un solo lugar para que el cliente y la Edge
-- Function tengan de dónde copiarlas sin desalinearse.
CREATE OR REPLACE FUNCTION public.lie_penalty()        RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$ SELECT 0.4  $$;
CREATE OR REPLACE FUNCTION public.veracity_floor()     RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$ SELECT 0.2  $$;
CREATE OR REPLACE FUNCTION public.monthly_lies_limit() RETURNS INT     LANGUAGE sql IMMUTABLE AS $$ SELECT 2    $$;

-- ============================================================
-- 3. RESPONDER EL CIERRE (sin congelar por respuesta ajena)
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

  -- El plazo es ahora el ÚNICO límite. Mientras corra se puede corregir la
  -- respuesta todas las veces que haga falta; al vencer queda firme. Ya no hay
  -- un congelamiento anticipado por "el otro ya contestó": ese bloqueo era en
  -- sí mismo una filtración, porque avisaba que el compañero había respondido.
  IF now() > v_end + make_interval(hours => public.closeout_window_hours()) THEN
    RAISE EXCEPTION 'CLOSEOUT_WINDOW_CLOSED' USING ERRCODE = 'P0021';
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

  -- Si esta respuesta completó el consenso de que la sesión ocurrió, se
  -- deshacen las ausencias que el barrido automático había puesto mal.
  PERFORM public.reconcile_attendance_from_closeouts(p_meeting_id);

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_session_closeout(uuid, text, text, text, boolean, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_session_closeout(uuid, text, text, text, boolean, text, text) TO authenticated;

-- ============================================================
-- 4. MI SITUACIÓN (nunca la de otro)
-- ============================================================
-- Compromiso, reciprocidad, veracidad y bloqueo por mentir. No expone en ningún
-- caso quién dijo qué: el compromiso llega ya promediado.
--
-- DROP y no CREATE OR REPLACE: esta función ya existía en 20260815120000 con
-- menos columnas de salida, y Postgres no permite cambiar el tipo de fila que
-- definen los parámetros OUT.
DROP FUNCTION IF EXISTS public.my_closeout_standing();
CREATE FUNCTION public.my_closeout_standing()
RETURNS TABLE(
  engagement_pct INT,
  engagement_count BIGINT,
  reciprocity_pct INT,
  owed_count BIGINT,
  answered_count BIGINT,
  veracity_pct INT,
  proven_lies BIGINT,
  monthly_lies BIGINT,
  blocked_for_lying BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (SELECT lower(nullif(auth.jwt() ->> 'email', '')) AS email),
  disputas AS (SELECT * FROM public.closeout_disputes()),
  -- Mentiras comprobadas: disputas donde quedé fuera del consenso Y el registro
  -- de ingreso desmiente lo que dije.
  mentiras AS (
    SELECT d.meeting_id, m.starts_at
    FROM disputas d
    JOIN public.meetings m ON m.id = d.meeting_id
    WHERE d.corroborated
      AND d.outlier_email = (SELECT email FROM me)
      AND m.starts_at >= now() - interval '60 days'
  ),
  sobre_mi AS (
    SELECT CASE sc.engagement
             WHEN 'preparado' THEN 1.0
             WHEN 'a_medias' THEN 0.5
             ELSE 0.0
           END AS val
    FROM public.session_closeouts sc
    JOIN public.meetings m ON m.id = sc.meeting_id
    LEFT JOIN disputas d ON d.meeting_id = sc.meeting_id
    WHERE lower(sc.subject_email) = (SELECT email FROM me)
      -- Solo por reloj: si contara al responder el compañero, mirar el propio
      -- puntaje antes de cerrar delataría la nota recibida.
      AND public.closeout_counts(sc.meeting_id)
      -- Disputa SIN evidencia: no puntúa para ninguno de los dos.
      AND (d.meeting_id IS NULL OR d.corroborated)
      -- Disputa CON evidencia: se descarta la respuesta de quien mintió, no la
      -- de su compañero. Es lo que le quita a la mentira su uso más rentable.
      AND (d.meeting_id IS NULL OR lower(sc.author_email) IS DISTINCT FROM d.outlier_email)
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
    (SELECT count(*) FROM me_tocaba t WHERE t.id IN (SELECT meeting_id FROM respondi)),
    round(GREATEST(
      public.veracity_floor(),
      1 - public.lie_penalty() * (SELECT count(*) FROM mentiras)
    ) * 100)::INT,
    (SELECT count(*) FROM mentiras),
    (SELECT count(*) FROM mentiras WHERE starts_at >= date_trunc('month', now() AT TIME ZONE 'UTC')),
    (SELECT count(*) FROM mentiras WHERE starts_at >= date_trunc('month', now() AT TIME ZONE 'UTC'))
      >= public.monthly_lies_limit()
  FROM sobre_mi;
$$;

REVOKE ALL ON FUNCTION public.my_closeout_standing() FROM public;
GRANT EXECUTE ON FUNCTION public.my_closeout_standing() TO authenticated;

-- Elogios recibidos, sin autor y solo de cierres cuyo plazo ya venció. El de
-- quien mintió no se entrega: su cierre queda descartado entero.
CREATE OR REPLACE FUNCTION public.my_closeout_praise(p_limit INT DEFAULT 10)
RETURNS TABLE(praise TEXT, received_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (SELECT lower(nullif(auth.jwt() ->> 'email', '')) AS email),
  disputas AS (SELECT * FROM public.closeout_disputes())
  SELECT sc.praise, m.starts_at
  FROM public.session_closeouts sc
  JOIN public.meetings m ON m.id = sc.meeting_id
  LEFT JOIN disputas d ON d.meeting_id = sc.meeting_id
  WHERE lower(sc.subject_email) = (SELECT email FROM me)
    AND sc.praise IS NOT NULL
    AND public.closeout_counts(sc.meeting_id)
    AND (d.meeting_id IS NULL
         OR NOT d.corroborated
         OR lower(sc.author_email) IS DISTINCT FROM d.outlier_email)
  ORDER BY m.starts_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;

REVOKE ALL ON FUNCTION public.my_closeout_praise(int) FROM public;
GRANT EXECUTE ON FUNCTION public.my_closeout_praise(int) TO authenticated;

-- ============================================================
-- 5. LO QUE HAY QUE MIRAR A MANO (solo administrador)
-- ============================================================
-- Ahora la disputa llega separada en dos: la que el registro desmiente —que ya
-- se sancionó sola— y la que quedó sin evidencia, que es la que efectivamente
-- necesita una mirada humana.
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

  SELECT
    CASE WHEN d.corroborated THEN 'mentira' ELSE 'disputa' END,
    d.meeting_id,
    m.room_id,
    m.starts_at,
    d.outlier_email,
    CASE WHEN d.corroborated
      THEN 'Dijo que la sesión no se hizo, pero los dos abrieron el enlace de Meet. Ya se le aplicó el descuento de credibilidad.'
      ELSE 'Una respuesta dice que la sesión no se hizo y la otra que sí. Sin registro de ingreso que respalde a ninguno.'
    END
  FROM public.closeout_disputes() d
  JOIN public.meetings m ON m.id = d.meeting_id
  ORDER BY 4 DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_closeout_flags() FROM public;
GRANT EXECUTE ON FUNCTION public.list_closeout_flags() TO authenticated;

-- ============================================================
-- 6. FUERA LA APERTURA POR RESPUESTA AJENA
-- ============================================================
-- Ya nadie la usa: los tres consumidores pasaron a closeout_counts(). Se borra
-- para que no quede un camino por el que el sobre se abra antes de tiempo.
DROP FUNCTION IF EXISTS public.closeout_is_open(uuid);
