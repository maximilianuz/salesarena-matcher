-- Auditoría 2026-08-13 — Hallazgo 08 (parte transaccional) + secuela del 01.
--
-- Renombrar una sala cambia su slug, que es la clave primaria. Como no hay
-- ON UPDATE CASCADE, la app lo resolvía copiando la sala al slug nuevo y
-- migrando las tablas dependientes una por una: SEIS escrituras sueltas, sin
-- transacción. Si la conexión se cortaba en el medio, la sala quedaba partida
-- entre dos slugs sin forma de volver atrás.
--
-- Además migraba solo members, availabilities, templates y meetings. Se
-- olvidaba de meeting_attendees y match_proposals, que también llevan room_id.
-- Con las lecturas abiertas eso pasaba inadvertido; ahora que cada tabla se lee
-- por pertenencia a la sala (20260813120000), esas filas huérfanas dejarían el
-- historial de asistencia y las propuestas fuera del alcance de sus dueños.
--
-- Esta función hace todo en una sola transacción: o se renombra entero, o no se
-- toca nada.

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

  -- Mismo slug: es solo un cambio de nombre visible, sin migración.
  IF p_new_slug = p_room_id THEN
    UPDATE public.rooms SET name = btrim(p_new_name), updated_at = now()
    WHERE id = p_room_id
    RETURNING * INTO v_room;
    RETURN v_room;
  END IF;

  -- Un slug ya ocupado fusionaría dos salas distintas sin avisar.
  IF EXISTS (SELECT 1 FROM public.rooms WHERE id = p_new_slug) THEN
    RAISE EXCEPTION 'SLUG_TAKEN' USING ERRCODE = 'P0006';
  END IF;

  -- La sala nueva hereda dueño y fecha de creación de la original.
  INSERT INTO public.rooms (id, name, founder_email, created_at, updated_at)
  SELECT p_new_slug, btrim(p_new_name), r.founder_email, r.created_at, now()
  FROM public.rooms r WHERE r.id = p_room_id
  RETURNING * INTO v_room;

  -- El código de acceso viaja con la sala: los enlaces ya repartidos siguen
  -- sirviendo después del renombre.
  INSERT INTO public.room_access_codes (room_id, code, updated_at)
  SELECT p_new_slug, c.code, now()
  FROM public.room_access_codes c WHERE c.room_id = p_room_id
  ON CONFLICT (room_id) DO NOTHING;

  UPDATE public.members           SET room_id = p_new_slug WHERE room_id = p_room_id;
  UPDATE public.availabilities    SET room_id = p_new_slug WHERE room_id = p_room_id;
  UPDATE public.templates         SET room_id = p_new_slug WHERE room_id = p_room_id;
  UPDATE public.meetings          SET room_id = p_new_slug WHERE room_id = p_room_id;
  UPDATE public.meeting_attendees SET room_id = p_new_slug WHERE room_id = p_room_id;
  UPDATE public.match_proposals   SET room_id = p_new_slug WHERE room_id = p_room_id;

  -- La sala por defecto se conserva siempre: es el destino al que vuelve la app
  -- cuando una sala deja de existir.
  IF p_room_id <> 'grupo-a' THEN
    DELETE FROM public.rooms WHERE id = p_room_id;
  END IF;

  RETURN v_room;
END;
$$;

REVOKE ALL ON FUNCTION public.rename_room(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.rename_room(text, text, text) TO authenticated;
