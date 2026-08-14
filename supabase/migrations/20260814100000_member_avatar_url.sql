-- Foto de perfil de Google en vez del círculo con la inicial.
--
-- Google ya entrega la foto de perfil en el token de OAuth
-- (user_metadata.avatar_url, normalizado por Supabase desde el claim
-- "picture" de Google) pero la app la descartaba: solo guardaba nombre,
-- país y zona horaria al dar de alta a alguien.

ALTER TABLE members ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- join_room cambia de firma (se agrega p_avatar_url): se dropea la versión
-- anterior para no dejar dos funciones superpuestas con distinta cantidad de
-- parámetros.
DROP FUNCTION IF EXISTS public.join_room(text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.join_room(
  p_room_id TEXT,
  p_access_code TEXT,
  p_name TEXT,
  p_country TEXT,
  p_timezone TEXT,
  p_avatar_url TEXT DEFAULT NULL
)
RETURNS public.members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email    TEXT := lower(nullif(auth.jwt() ->> 'email', ''));
  v_expected TEXT;
  v_row      public.members;
BEGIN
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;

  -- Idempotente: quien ya es miembro entra sin volver a validar el código.
  -- No se toca avatar_url acá (la foto se refresca aparte, en el cliente, con
  -- un UPDATE directo sobre la fila propia cuando cambia la de Google — así
  -- no hay que tocar esta función cada vez que alguien vuelve a entrar).
  SELECT * INTO v_row
  FROM public.members
  WHERE room_id = p_room_id AND lower(email) = v_email;
  IF FOUND THEN
    RETURN v_row;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE id = p_room_id) THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT code INTO v_expected FROM public.room_access_codes WHERE room_id = p_room_id;

  IF NOT public.is_platform_admin() THEN
    IF v_expected IS NULL THEN
      RAISE EXCEPTION 'ROOM_CLOSED' USING ERRCODE = 'P0003';
    END IF;
    IF p_access_code IS NULL OR upper(btrim(p_access_code)) <> upper(v_expected) THEN
      RAISE EXCEPTION 'INVALID_CODE' USING ERRCODE = 'P0004';
    END IF;
  END IF;

  INSERT INTO public.members (room_id, email, name, country, timezone, active, avatar_url)
  VALUES (p_room_id, v_email, btrim(p_name), p_country, p_timezone, true, p_avatar_url)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.join_room(text, text, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.join_room(text, text, text, text, text, text) TO authenticated;
