-- Correcciones de la revisión de la auditoría 2026-08-13.
--
-- 1. TODA SALA NUEVA NACE SIN CÓDIGO DE ACCESO
--    20260813121000 generó códigos para las salas que existían en ese momento,
--    pero nada los crea después. Una sala creada desde entonces queda sin fila
--    en room_access_codes, así que:
--      * su enlace de invitación sale sin ?code=, y
--      * join_room rechaza a todo el mundo con ROOM_CLOSED.
--    Es decir: la sala nace inutilizable para invitar hasta que alguien entra a
--    la administración y aprieta "Renovar". Un trigger lo resuelve para todos
--    los caminos que crean salas (alta manual, bootstrap del administrador y
--    cualquiera futuro), en vez de tener que acordarse en cada uno.
--
-- 2. LA POLÍTICA DE ESCRITURA PERMITÍA CREAR FILAS SIN DUEÑO
--    La rama `member_email IS NULL` estaba pensada para poder LEER y limpiar
--    las filas anteriores a esa columna, pero al estar también en WITH CHECK
--    habilitaba a insertar filas nuevas sin dueño a nombre de otra persona,
--    justo lo que la política venía a impedir. Se saca de WITH CHECK y se
--    conserva solo en USING.

-- ============================================================
-- 1. CÓDIGO AUTOMÁTICO PARA CADA SALA NUEVA
-- ============================================================
CREATE OR REPLACE FUNCTION public.ensure_room_access_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.room_access_codes (room_id, code)
  VALUES (NEW.id, public.generate_access_code())
  ON CONFLICT (room_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_room_access_code ON rooms;
CREATE TRIGGER trg_room_access_code
  AFTER INSERT ON rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_room_access_code();

-- Red de seguridad para las salas creadas entre 20260813121000 y este trigger.
INSERT INTO room_access_codes (room_id, code)
SELECT r.id, public.generate_access_code()
FROM rooms r
WHERE NOT EXISTS (
  SELECT 1 FROM room_access_codes c WHERE c.room_id = r.id
);

-- ============================================================
-- 2. NO SE PUEDEN CREAR FILAS DE HORARIOS SIN DUEÑO
-- ============================================================
-- USING (qué filas puedo ver/borrar/actualizar) sigue contemplando las filas
-- sin dueño resuelto: son las anteriores a member_email y hay que poder
-- limpiarlas. WITH CHECK (qué filas puedo dejar escritas) ya no: desde el
-- cambio anterior el cliente siempre escribe member_email.
DROP POLICY IF EXISTS "Members manage their own availability" ON availabilities;
CREATE POLICY "Members manage their own availability"
  ON availabilities FOR ALL
  TO authenticated
  USING (
    public.is_room_member(room_id)
    AND (
      member_email IS NULL
      OR lower(member_email) = lower(nullif(auth.jwt() ->> 'email', ''))
      OR public.is_room_admin(room_id)
    )
  )
  WITH CHECK (
    public.is_room_member(room_id)
    AND (
      lower(member_email) = lower(nullif(auth.jwt() ->> 'email', ''))
      OR public.is_room_admin(room_id)
    )
  );

DROP POLICY IF EXISTS "Members manage their own templates" ON templates;
CREATE POLICY "Members manage their own templates"
  ON templates FOR ALL
  TO authenticated
  USING (
    public.is_room_member(room_id)
    AND (
      member_email IS NULL
      OR lower(member_email) = lower(nullif(auth.jwt() ->> 'email', ''))
      OR public.is_room_admin(room_id)
    )
  )
  WITH CHECK (
    public.is_room_member(room_id)
    AND (
      lower(member_email) = lower(nullif(auth.jwt() ->> 'email', ''))
      OR public.is_room_admin(room_id)
    )
  );
