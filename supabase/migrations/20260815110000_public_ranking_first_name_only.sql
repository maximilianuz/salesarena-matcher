-- El ranking público de la landing muestra solo el NOMBRE DE PILA.
--
-- Los testimonios son opt-in: aparecen porque esa persona se sentó a escribir
-- una reseña y a mandarla. El ranking no: te incluye por haber asistido a un
-- role-play, sin que hayas pedido figurar en una web pública. Publicar nombre
-- y apellido junto a la foto de Google convierte eso en un perfil identificable
-- de alguien que nunca lo eligió.
--
-- Se recorta al primer token del nombre. La foto y el conteo quedan igual, así
-- que el bloque sigue funcionando y reconociéndose entre compañeros de sala,
-- pero deja de ser indexable como "Nombre Apellido" desde afuera.
--
-- Solo cambia esta función; public_testimonials sigue mostrando el nombre
-- completo, que es lo que la persona aceptó al enviar su reseña.

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
