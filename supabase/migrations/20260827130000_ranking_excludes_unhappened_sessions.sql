-- El ranking público contaba sesiones que nunca se hicieron.
--
-- public_top_roleplayers suma filas de meeting_attendees con status = 'asistio'.
-- Ese estado lo pone el barrido automático del weekly-matcher a partir de
-- joined_at, que se graba con solo ABRIR el link del Meet (?join=<id>): un
-- click real, pero también el recordatorio de Google Calendar, un cliente de
-- correo que precachea enlaces, o alguien que entró, esperó y se fue porque el
-- otro nunca apareció. Ninguno de esos casos es "se hizo el role-play".
--
-- La app ya tiene la pregunta correcta: el cierre de sesión post-llamada, que
-- cada participante responde por separado con happened IN ('completa',
-- 'cortada', 'no_se_hizo'). Es la única señal sobre un hecho COMPARTIDO. Pero
-- hasta ahora esa respuesta solo alimentaba confiabilidad — nunca se cruzaba
-- con el ranking público, así que una sesión que las dos personas (o una sola)
-- reportan como "no se hizo" seguía sumando puesto en la landing.
--
-- El arreglo: si CUALQUIER cierre de esa reunión dice 'no_se_hizo', la sesión
-- no cuenta para nadie. Mismo criterio que ya usa my_closeout_standing con las
-- reuniones en disputa (20260815120000): no se trata de señalar a quién le
-- creemos, sino de que ninguno de los dos se queda con un role-play que no
-- pasó. Sin cierre de sesión —la mayoría de los casos, porque el formulario es
-- opcional— el comportamiento no cambia: sigue rigiendo joined_at como antes.

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
      AND NOT EXISTS (
        SELECT 1 FROM public.session_closeouts sc
        WHERE sc.meeting_id = ma.meeting_id AND sc.happened = 'no_se_hizo'
      )
    GROUP BY lower(ma.member_email)
  ),
  one_profile_per_email AS (
    SELECT DISTINCT ON (lower(email)) lower(email) AS email, name, avatar_url
    FROM public.members
    ORDER BY lower(email), updated_at DESC NULLS LAST
  )
  -- COALESCE por si el nombre guardado es solo espacios: antes que devolver
  -- una fila sin nombre, se cae al valor completo tal cual está.
  SELECT
    COALESCE(NULLIF(split_part(btrim(p.name), ' ', 1), ''), btrim(p.name)),
    p.avatar_url,
    mc.sessions_count
  FROM monthly_counts mc
  JOIN one_profile_per_email p ON p.email = mc.email
  ORDER BY mc.sessions_count DESC, p.name ASC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;

REVOKE ALL ON FUNCTION public.public_top_roleplayers(int) FROM public;
GRANT EXECUTE ON FUNCTION public.public_top_roleplayers(int) TO anon, authenticated;
