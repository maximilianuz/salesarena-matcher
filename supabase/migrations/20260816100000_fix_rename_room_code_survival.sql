-- Bug: renombrar una sala invalidaba en silencio todos los enlaces de
-- invitación ya repartidos, sin que nadie tocara "Renovar código".
--
-- rename_room() (20260813122000) migra la sala a un slug nuevo con
--   INSERT INTO rooms (id, ...) VALUES (p_new_slug, ...)
-- y a continuación intenta trasladar el código de acceso original:
--   INSERT INTO room_access_codes (room_id, code)
--   SELECT p_new_slug, code FROM room_access_codes WHERE room_id = p_room_id
--   ON CONFLICT (room_id) DO NOTHING
--
-- Ese ON CONFLICT DO NOTHING asumía que la fila para p_new_slug todavía no
-- existía. Eso era cierto cuando se escribió, pero 20260813124000 agregó un
-- trigger AFTER INSERT ON rooms (ensure_room_access_code) que le pone un
-- código ALEATORIO a toda fila nueva de rooms — incluida la que el propio
-- rename_room acaba de insertar, unas líneas antes. Ese trigger corre primero
-- y deja la fila ocupada; cuando rename_room intenta trasladar el código
-- original, ON CONFLICT DO NOTHING no hace nada y el código aleatorio del
-- trigger queda como definitivo. El código original se pierde sin aviso.
--
-- Reproducido y confirmado contra un PostgreSQL real antes de este fix:
-- código antes del rename "JJ2YP9PD" -> después del rename "837C57UF".
--
-- Arreglo: DO UPDATE en vez de DO NOTHING. El trigger sigue disparando primero
-- (no hace falta tocarlo ni depender del orden), pero ahora la instrucción de
-- rename_room que sí conoce el código real GANA la carrera y lo sobrescribe.

CREATE OR REPLACE FUNCTION public.rename_room(
  p_room_id  TEXT,
  p_new_slug TEXT,
  p_new_name TEXT
)
RETURNS public.rooms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.rooms;
BEGIN
  IF NOT public.is_room_admin(p_room_id) THEN
    RAISE EXCEPTION 'NOT_ROOM_ADMIN' USING ERRCODE = '42501';
  END IF;

  IF p_new_slug IS NULL OR btrim(p_new_slug) = '' OR p_new_name IS NULL OR btrim(p_new_name) = '' THEN
    RAISE EXCEPTION 'INVALID_NAME' USING ERRCODE = 'P0005';
  END IF;

  IF p_new_slug = p_room_id THEN
    UPDATE public.rooms SET name = btrim(p_new_name), updated_at = now()
    WHERE id = p_room_id
    RETURNING * INTO v_room;
    RETURN v_room;
  END IF;

  IF EXISTS (SELECT 1 FROM public.rooms WHERE id = p_new_slug) THEN
    RAISE EXCEPTION 'SLUG_TAKEN' USING ERRCODE = 'P0006';
  END IF;

  INSERT INTO public.rooms (id, name, founder_email, created_at, updated_at)
  SELECT p_new_slug, btrim(p_new_name), r.founder_email, r.created_at, now()
  FROM public.rooms r WHERE r.id = p_room_id
  RETURNING * INTO v_room;

  -- El código de acceso viaja con la sala: los enlaces ya repartidos siguen
  -- sirviendo después del renombre. DO UPDATE y no DO NOTHING: el INSERT
  -- anterior ya disparó el trigger ensure_room_access_code, que le puso un
  -- código ALEATORIO a esta fila nueva. Acá se lo pisa con el código real de
  -- la sala original — es la única fuente de verdad para lo que ya se
  -- distribuyó, así que tiene que ganar sin importar qué corrió primero.
  INSERT INTO public.room_access_codes (room_id, code, updated_at)
  SELECT p_new_slug, c.code, now()
  FROM public.room_access_codes c WHERE c.room_id = p_room_id
  ON CONFLICT (room_id) DO UPDATE SET code = EXCLUDED.code, updated_at = now();

  UPDATE public.members           SET room_id = p_new_slug WHERE room_id = p_room_id;
  UPDATE public.availabilities    SET room_id = p_new_slug WHERE room_id = p_room_id;
  UPDATE public.templates         SET room_id = p_new_slug WHERE room_id = p_room_id;
  UPDATE public.meetings          SET room_id = p_new_slug WHERE room_id = p_room_id;
  UPDATE public.meeting_attendees SET room_id = p_new_slug WHERE room_id = p_room_id;
  UPDATE public.match_proposals   SET room_id = p_new_slug WHERE room_id = p_room_id;

  IF p_room_id <> 'grupo-a' THEN
    DELETE FROM public.rooms WHERE id = p_room_id;
  END IF;

  RETURN v_room;
END;
$$;

REVOKE ALL ON FUNCTION public.rename_room(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.rename_room(text, text, text) TO authenticated;
