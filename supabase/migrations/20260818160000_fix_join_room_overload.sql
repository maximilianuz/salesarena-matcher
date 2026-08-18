-- Bug: la ventana de acceso sin código nunca funcionó, y había dos join_room.
--
-- 20260813121000 creó join_room con CINCO parámetros. 20260814100000 agregó la
-- foto de perfil con un CREATE OR REPLACE de SEIS parámetros — pero en
-- PostgreSQL cambiar la cantidad de argumentos no reemplaza nada: crea una
-- SOBRECARGA nueva. Quedaron las dos funciones vivas al mismo tiempo.
--
-- El cliente llama siempre a la de seis (manda p_avatar_url), así que la de
-- cinco quedó muerta desde agosto. Y 20260817120000, que agregó la apertura
-- temporal por bypass_until, la escribió sobre la de CINCO: la ventana que se
-- abrió para la sala role-plays no tuvo ningún efecto — quien entraba por el
-- link sin código seguía recibiendo INVALID_CODE.
--
-- Dos arreglos:
--   1. Se elimina la sobrecarga de cinco parámetros. Mientras existan las dos,
--      cualquier migración futura puede volver a modificar la que no se usa y
--      el error pasa desapercibido, que es exactamente lo que ocurrió acá.
--   2. La lógica de bypass_until se traslada a la función real, la de seis.

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
  v_bypass   TIMESTAMPTZ;
  v_row      public.members;
BEGIN
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;

  -- Idempotente: quien ya es miembro entra sin volver a validar el código.
  -- No se toca avatar_url acá: la foto se refresca aparte, desde el cliente,
  -- con un UPDATE sobre la fila propia cuando cambia la de Google.
  SELECT * INTO v_row
  FROM public.members
  WHERE room_id = p_room_id AND lower(email) = v_email;
  IF FOUND THEN
    RETURN v_row;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE id = p_room_id) THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT code, bypass_until INTO v_expected, v_bypass
  FROM public.room_access_codes WHERE room_id = p_room_id;

  IF NOT public.is_platform_admin() THEN
    IF v_expected IS NULL THEN
      RAISE EXCEPTION 'ROOM_CLOSED' USING ERRCODE = 'P0003';
    END IF;
    -- Ventana de apertura temporal activa: se admite sin código.
    IF v_bypass IS NULL OR now() >= v_bypass THEN
      IF p_access_code IS NULL OR upper(btrim(p_access_code)) <> upper(v_expected) THEN
        RAISE EXCEPTION 'INVALID_CODE' USING ERRCODE = 'P0004';
      END IF;
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
