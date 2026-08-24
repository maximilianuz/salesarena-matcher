-- Reincidencia sin evidencia: cierra el agujero que dejaba el registro de
-- ingreso al Meet.
--
-- 20260824120000 sancionó la mentira cruzando el cierre con joined_at. Pero
-- joined_at SOLO se escribe cuando la persona abre el enlace desde la app, y el
-- evento de Google Calendar trae su propio botón "Unirse con Google Meet" que
-- no se puede sacar mientras el evento tenga conferenceData. Quien entra por ahí
-- no deja rastro.
--
-- El agujero era peor que "cobertura parcial": era AUTO-SERVIDO. Al mentiroso le
-- alcanzaba con no pasar nunca por la app para que no existiera evidencia sobre
-- sí mismo, y la disputa quedaba neutra igual que antes.
--
-- Contra eso, el patrón es la evidencia. Ahora cada disputa se clasifica según
-- lo que el registro diga DEL QUE NIEGA la sesión:
--
--   'desmiente' → los dos abrieron el enlace. Mentira comprobada: -0.4 y, a la
--                 segunda del mes, fuera de la rotación. (Ya estaba.)
--   'respalda'  → él entró y el otro no. Se presentó y lo dejaron plantado:
--                 "no se hizo" es la respuesta correcta y no cuesta nada. Sin
--                 esta distinción, la víctima de varios plantones habría sido
--                 la más castigada por reincidencia.
--   'silencio'  → no hay registro suyo. La primera sale gratis; de la segunda
--                 en más, -0.2 cada una.
--   'sin_datos' → ni siquiera hay filas de asistencia. No se juzga.
--
-- La reincidencia pesa la mitad y NUNCA bloquea: es un patrón, no un hecho.
-- Para sacar a alguien de la rotación sigue haciendo falta el registro en
-- contra.
--
-- Debe coincidir con src/closeouts.js y con la Edge Function weekly-matcher.

CREATE OR REPLACE FUNCTION public.pattern_penalty() RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$ SELECT 0.2 $$;
CREATE OR REPLACE FUNCTION public.pattern_grace()   RETURNS INT     LANGUAGE sql IMMUTABLE AS $$ SELECT 1   $$;

-- ============================================================
-- 1. LA DISPUTA AHORA DICE QUÉ TIPO DE EVIDENCIA TIENE
-- ============================================================
DROP FUNCTION IF EXISTS public.closeout_disputes();
CREATE FUNCTION public.closeout_disputes()
RETURNS TABLE(meeting_id UUID, outlier_email TEXT, corroborated BOOLEAN, evidence TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH base AS (
    SELECT sc.meeting_id AS mid,
           min(lower(sc.author_email)) FILTER (WHERE sc.happened = 'no_se_hizo') AS outlier
    FROM public.session_closeouts sc
    GROUP BY sc.meeting_id
    HAVING count(*) >= 2
       AND count(*) FILTER (WHERE sc.happened = 'no_se_hizo') > 0
       AND count(*) FILTER (WHERE sc.happened <> 'no_se_hizo') > 0
  ),
  reg AS (
    SELECT b.mid, b.outlier,
      (SELECT count(*) FROM public.meeting_attendees a WHERE a.meeting_id = b.mid) AS total,
      (SELECT count(*) FROM public.meeting_attendees a
        WHERE a.meeting_id = b.mid AND a.joined_at IS NOT NULL) AS con_registro,
      EXISTS (SELECT 1 FROM public.meeting_attendees a
               WHERE a.meeting_id = b.mid
                 AND lower(a.member_email) = b.outlier
                 AND a.joined_at IS NOT NULL) AS outlier_entro
    FROM base b
  )
  SELECT
    r.mid,
    r.outlier,
    (r.total >= 2 AND r.con_registro = r.total),
    CASE WHEN r.total < 2                 THEN 'sin_datos'
         WHEN r.con_registro = r.total    THEN 'desmiente'
         WHEN r.outlier_entro             THEN 'respalda'
         ELSE                                  'silencio'
    END
  FROM reg r;
$$;

-- ============================================================
-- 2. MI SITUACIÓN, CON LA REINCIDENCIA ADENTRO
-- ============================================================
-- DROP y no CREATE OR REPLACE: la función suma dos columnas de salida, y
-- Postgres no deja cambiar el tipo de fila que definen los parámetros OUT.
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
  blocked_for_lying BOOLEAN,
  unbacked_disputes BIGINT,
  pattern_strikes BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (SELECT lower(nullif(auth.jwt() ->> 'email', '')) AS email),
  disputas AS (SELECT * FROM public.closeout_disputes()),
  -- Disputas mías dentro de la ventana del score, ya clasificadas.
  mias AS (
    SELECT d.evidence, m.starts_at
    FROM disputas d
    JOIN public.meetings m ON m.id = d.meeting_id
    WHERE d.outlier_email = (SELECT email FROM me)
      AND m.starts_at >= now() - interval '60 days'
  ),
  mentiras AS (SELECT starts_at FROM mias WHERE evidence = 'desmiente'),
  sin_respaldo AS (SELECT starts_at FROM mias WHERE evidence = 'silencio'),
  strikes AS (
    SELECT GREATEST(0, (SELECT count(*) FROM sin_respaldo) - public.pattern_grace()) AS n
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
      -- Disputa SIN evidencia dura: no puntúa para ninguno de los dos.
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
        - public.pattern_penalty() * (SELECT n FROM strikes)
    ) * 100)::INT,
    (SELECT count(*) FROM mentiras),
    (SELECT count(*) FROM mentiras WHERE starts_at >= date_trunc('month', now() AT TIME ZONE 'UTC')),
    (SELECT count(*) FROM mentiras WHERE starts_at >= date_trunc('month', now() AT TIME ZONE 'UTC'))
      >= public.monthly_lies_limit(),
    (SELECT count(*) FROM sin_respaldo),
    (SELECT n FROM strikes)
  FROM sobre_mi;
$$;

REVOKE ALL ON FUNCTION public.my_closeout_standing() FROM public;
GRANT EXECUTE ON FUNCTION public.my_closeout_standing() TO authenticated;

-- ============================================================
-- 3. LO QUE MIRA QUIEN ADMINISTRA
-- ============================================================
-- Tres categorías en vez de dos: la mentira ya sancionada, la reincidencia sin
-- respaldo (que es la que puede necesitar una charla) y el caso donde el
-- registro respalda a quien negó la sesión — ahí el que conviene mirar es el
-- OTRO, que dio por hecha una sesión a la que no se presentó.
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
    CASE d.evidence
      WHEN 'desmiente' THEN 'mentira'
      WHEN 'respalda'  THEN 'planton'
      ELSE 'disputa'
    END,
    d.meeting_id,
    m.room_id,
    m.starts_at,
    d.outlier_email,
    CASE d.evidence
      WHEN 'desmiente' THEN 'Dijo que la sesión no se hizo, pero los dos abrieron el enlace de Meet. Ya se le aplicó el descuento de credibilidad.'
      WHEN 'respalda'  THEN 'Dijo que la sesión no se hizo y el registro lo respalda: entró al Meet y su compañero no. Quien conviene mirar es el otro.'
      ELSE 'Una respuesta dice que la sesión no se hizo y la otra que sí. Sin registro de ingreso que respalde a ninguno.'
    END
  FROM public.closeout_disputes() d
  JOIN public.meetings m ON m.id = d.meeting_id
  ORDER BY 4 DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_closeout_flags() FROM public;
GRANT EXECUTE ON FUNCTION public.list_closeout_flags() TO authenticated;
