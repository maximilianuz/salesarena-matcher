-- Reseñas de la app (estrellas + comentario) y dos vitrinas públicas para la
-- landing: testimonios aprobados y el ranking mensual de más activos.
--
-- Es la PRIMERA vez desde el cierre de acceso público (20260813120000) que se
-- abre una función a rol anon a propósito. El resto de la tabla queda tan
-- cerrada como todo lo demás: cero políticas para anon/authenticated, todo
-- pasa por funciones SECURITY DEFINER que deciden exactamente qué exponer.
--
-- Decisiones (confirmadas con el dueño del producto):
--   * Moderación manual: toda reseña nace 'pending' y solo se ve en la web
--     pública si el admin la aprueba. Nunca se auto-publica.
--   * La web pública muestra nombre + foto de Google + estrellas + texto.
--     Nunca el email ni la sala.
--   * Se muestran TODAS las aprobadas, sin filtrar por puntaje: la curación
--     la hace el admin al aprobar/rechazar, no un umbral automático de
--     estrellas.
--   * El ranking de "más activos" mide role-plays con asistencia CONFIRMADA
--     (status='asistio') dentro del mes calendario en curso, global entre
--     TODAS las salas. Al calcularse siempre sobre "el mes actual" en vivo,
--     se renueva solo cada mes sin ningún cron ni tabla de snapshots.

-- ============================================================
-- 1. TABLA (sin políticas de lectura directa)
-- ============================================================
CREATE TABLE IF NOT EXISTS app_feedback (
  id BIGSERIAL PRIMARY KEY,
  member_email TEXT NOT NULL UNIQUE,
  -- Nombre y foto son una INSTANTÁNEA al momento de opinar, no una referencia
  -- viva a members: si esa persona cambia de nombre o foto después, el
  -- testimonio ya publicado no se reescribe solo.
  member_name TEXT NOT NULL,
  avatar_url TEXT,
  room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL CHECK (char_length(btrim(comment)) BETWEEN 1 AND 600),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

ALTER TABLE app_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages feedback" ON app_feedback;
CREATE POLICY "Service role manages feedback"
  ON app_feedback FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 2. ENVIAR / ACTUALIZAR MI RESEÑA (cualquier autenticado)
-- ============================================================
-- Una fila por cuenta (UNIQUE member_email): volver a opinar actualiza la
-- propia reseña en vez de acumular duplicados, y la vuelve a mandar a
-- 'pending' — un comentario editado necesita que lo revisen de nuevo.
CREATE OR REPLACE FUNCTION public.submit_app_feedback(p_rating SMALLINT, p_comment TEXT)
RETURNS public.app_feedback
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email   TEXT := lower(nullif(auth.jwt() ->> 'email', ''));
  v_name    TEXT;
  v_avatar  TEXT;
  v_room    TEXT;
  v_comment TEXT := btrim(p_comment);
  v_row     public.app_feedback;
BEGIN
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'INVALID_RATING' USING ERRCODE = 'P0010';
  END IF;
  IF v_comment IS NULL OR char_length(v_comment) = 0 THEN
    RAISE EXCEPTION 'EMPTY_COMMENT' USING ERRCODE = 'P0011';
  END IF;
  v_comment := left(v_comment, 600);

  -- Puede estar en más de una sala con el mismo email: se toma la ficha más
  -- reciente como instantánea de nombre/foto para el testimonio.
  SELECT name, avatar_url, room_id INTO v_name, v_avatar, v_room
  FROM public.members
  WHERE lower(email) = v_email
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'NOT_A_MEMBER' USING ERRCODE = 'P0012';
  END IF;

  INSERT INTO public.app_feedback (member_email, member_name, avatar_url, room_id, rating, comment, status, updated_at, reviewed_at)
  VALUES (v_email, v_name, v_avatar, v_room, p_rating, v_comment, 'pending', now(), NULL)
  ON CONFLICT (member_email) DO UPDATE SET
    member_name = EXCLUDED.member_name,
    avatar_url  = EXCLUDED.avatar_url,
    room_id     = EXCLUDED.room_id,
    rating      = EXCLUDED.rating,
    comment     = EXCLUDED.comment,
    status      = 'pending',
    reviewed_at = NULL,
    updated_at  = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_app_feedback(smallint, text) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_app_feedback(smallint, text) TO authenticated;

-- ============================================================
-- 3. VER MI PROPIA RESEÑA (para mostrar su estado en la app)
-- ============================================================
CREATE OR REPLACE FUNCTION public.my_app_feedback()
RETURNS public.app_feedback
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT * FROM public.app_feedback
  WHERE member_email = lower(nullif(auth.jwt() ->> 'email', ''));
$$;

REVOKE ALL ON FUNCTION public.my_app_feedback() FROM public;
GRANT EXECUTE ON FUNCTION public.my_app_feedback() TO authenticated;

-- ============================================================
-- 4. MODERACIÓN (solo administrador de plataforma)
-- ============================================================
CREATE OR REPLACE FUNCTION public.list_feedback_for_review()
RETURNS SETOF public.app_feedback
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
    SELECT * FROM public.app_feedback
    ORDER BY (status = 'pending') DESC, created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_feedback_for_review() FROM public;
GRANT EXECUTE ON FUNCTION public.list_feedback_for_review() TO authenticated;

CREATE OR REPLACE FUNCTION public.review_app_feedback(p_id BIGINT, p_approve BOOLEAN)
RETURNS public.app_feedback
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.app_feedback;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'NOT_PLATFORM_ADMIN' USING ERRCODE = '42501';
  END IF;

  UPDATE public.app_feedback
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      reviewed_at = now()
  WHERE id = p_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FEEDBACK_NOT_FOUND' USING ERRCODE = 'P0013';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.review_app_feedback(bigint, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.review_app_feedback(bigint, boolean) TO authenticated;

-- ============================================================
-- 5. VITRINA PÚBLICA (rol anon: la landing no requiere login)
-- ============================================================
-- Devuelve SOLO lo que se decidió que es público: nombre, foto, estrellas,
-- texto y fecha. Nunca email, nunca sala, nunca filas 'pending'/'rejected'.
CREATE OR REPLACE FUNCTION public.public_testimonials(p_limit INT DEFAULT 12)
RETURNS TABLE(member_name TEXT, avatar_url TEXT, rating SMALLINT, comment TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT member_name, avatar_url, rating, comment, created_at
  FROM public.app_feedback
  WHERE status = 'approved'
  ORDER BY created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;

REVOKE ALL ON FUNCTION public.public_testimonials(int) FROM public;
GRANT EXECUTE ON FUNCTION public.public_testimonials(int) TO anon, authenticated;

-- Top N de asistencia CONFIRMADA (no solo agendada) del mes calendario en
-- curso, global entre salas. Solo nombre + foto + cantidad: nunca email.
CREATE OR REPLACE FUNCTION public.public_top_roleplayers(p_limit INT DEFAULT 10)
RETURNS TABLE(member_name TEXT, avatar_url TEXT, sessions_count BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH monthly_counts AS (
    SELECT lower(ma.member_email) AS email, count(*) AS sessions_count
    FROM public.meeting_attendees ma
    JOIN public.meetings m ON m.id = ma.meeting_id
    WHERE ma.status = 'asistio'
      AND m.starts_at >= date_trunc('month', now())
      AND m.starts_at < date_trunc('month', now()) + interval '1 month'
    GROUP BY lower(ma.member_email)
  ),
  one_profile_per_email AS (
    SELECT DISTINCT ON (lower(email)) lower(email) AS email, name, avatar_url
    FROM public.members
    ORDER BY lower(email), updated_at DESC NULLS LAST
  )
  SELECT p.name, p.avatar_url, mc.sessions_count
  FROM monthly_counts mc
  JOIN one_profile_per_email p ON p.email = mc.email
  ORDER BY mc.sessions_count DESC, p.name ASC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;

REVOKE ALL ON FUNCTION public.public_top_roleplayers(int) FROM public;
GRANT EXECUTE ON FUNCTION public.public_top_roleplayers(int) TO anon, authenticated;
