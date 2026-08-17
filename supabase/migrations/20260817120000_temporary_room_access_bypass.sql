-- Apertura temporal del enlace de invitación.
--
-- Motivo puntual: el rename de "role-plays" (ver 20260816100000) dejó
-- circulando enlaces con un código que ya no es el vigente, y regenerarlo
-- ahora mismo (Gestionar Sala → Renovar código) requiere estar frente a la
-- app, no solo al SQL Editor. Mientras tanto, se necesita poder sumar gente
-- nueva por el link desnudo, sin código, pero sólo por una ventana acotada.
--
-- No se toca el candado en sí: join_room() sigue exigiendo el código fuera de
-- la ventana. Se agrega una EXCEPCIÓN con vencimiento propio en la misma fila
-- de room_access_codes, que expira sola por tiempo — no depende de que nadie
-- se acuerde de "cerrarla" después.

ALTER TABLE public.room_access_codes
  ADD COLUMN IF NOT EXISTS bypass_until TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.join_room(
  p_room_id TEXT,
  p_access_code TEXT,
  p_name TEXT,
  p_country TEXT,
  p_timezone TEXT
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

  INSERT INTO public.members (room_id, email, name, country, timezone, active)
  VALUES (p_room_id, v_email, btrim(p_name), p_country, p_timezone, true)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.join_room(text, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.join_room(text, text, text, text, text) TO authenticated;

-- Para que, de acá en más, esto se pueda activar desde la propia app (sin
-- pasar por SQL Editor): un administrador de sala puede abrir o cerrar la
-- ventana. p_hours <= 0 cierra la ventana ya mismo; se limita a 72hs como
-- techo de seguridad para que un valor tipeado de más no deje la sala
-- abierta por semanas.
CREATE OR REPLACE FUNCTION public.set_room_access_bypass(p_room_id TEXT, p_hours NUMERIC)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_until TIMESTAMPTZ;
BEGIN
  IF NOT public.is_room_admin(p_room_id) THEN
    RAISE EXCEPTION 'NOT_ROOM_ADMIN' USING ERRCODE = '42501';
  END IF;
  v_until := CASE WHEN p_hours > 0 THEN now() + make_interval(hours => LEAST(p_hours, 72)) ELSE NULL END;
  UPDATE public.room_access_codes SET bypass_until = v_until, updated_at = now()
  WHERE room_id = p_room_id;
  RETURN v_until;
END;
$$;

REVOKE ALL ON FUNCTION public.set_room_access_bypass(text, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.set_room_access_bypass(text, numeric) TO authenticated;
