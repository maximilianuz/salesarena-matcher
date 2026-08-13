-- Auditoría 2026-08-13 — Hallazgos 01, 03 y 04.
--
-- El modelo anterior (20260718100000) abrió TODAS las tablas a lectura pública
-- (rol anon incluido) porque la app cargaba los datos de la sala antes del
-- login. Eso ya no es cierto: la pantalla de login no muestra ningún dato de la
-- sala (solo marca y selector de tema), así que la lectura anónima no aporta
-- nada y expone, a cualquiera que consulte la API con la anon key:
--   * nombre y email de todos los miembros de todas las salas,
--   * su disponibilidad horaria,
--   * el enlace de Google Meet de las reuniones agendadas.
--
-- Esta migración deja el acceso así:
--
--   LECTURA   solo usuarios autenticados que son miembros de ESA sala.
--   ESCRITURA solo miembros de la sala; y las acciones destructivas
--             (renombrar/eliminar sala, sacar miembros) solo quien administra.
--   ASISTENCIA solo los dos participantes de ESA reunión pueden reportarla.
--
-- Modelo de administración: administrador de plataforma (cuenta única) MÁS el
-- dueño de cada sala (rooms.founder_email). Quien crea una sala la administra.
--
-- NOTA SOBRE RECURSIÓN: una política de SELECT sobre `members` que consulte
-- `members` provoca recursión infinita (42P17) — fue justamente lo que rompió
-- el modelo original y motivó abrir todo a lectura pública. La solución es
-- encapsular la comprobación de membresía en funciones SECURITY DEFINER, que
-- corren como su dueño y por lo tanto NO vuelven a evaluar RLS.

-- ============================================================
-- 1. HELPERS (SECURITY DEFINER: no re-evalúan RLS → sin recursión)
-- ============================================================

-- Administrador de la plataforma. Cuenta única, alineada con ADMIN_EMAIL en
-- src/App.jsx: si cambia allá, cambia acá.
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT lower(coalesce(auth.jwt() ->> 'email', '')) = 'community.argen.manager@gmail.com';
$$;

-- ¿El usuario actual es miembro de esta sala?
-- Si no hay JWT (rol anon), auth.jwt() ->> 'email' es NULL y la comparación
-- nunca se cumple → devuelve false.
CREATE OR REPLACE FUNCTION public.is_room_member(p_room_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.room_id = p_room_id
      AND lower(m.email) = lower(nullif(auth.jwt() ->> 'email', ''))
  );
$$;

-- ¿El usuario actual administra esta sala? Dueño de la sala o admin global.
-- El chequeo de founder_email exige NOT NULL explícito: sin él, una sala con
-- founder_email NULL haría que lower(NULL) = lower(NULL) se evaluara como
-- desconocido/verdadero según el operador y cualquiera pasaría como dueño.
CREATE OR REPLACE FUNCTION public.is_room_admin(p_room_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.is_platform_admin()
      OR EXISTS (
        SELECT 1 FROM public.rooms r
        WHERE r.id = p_room_id
          AND r.founder_email IS NOT NULL
          AND lower(r.founder_email) = lower(nullif(auth.jwt() ->> 'email', ''))
      );
$$;

-- ¿El usuario actual participó de ESTA reunión? Base del reporte de asistencia:
-- el compañero reporta al otro, pero nadie más de la sala puede hacerlo.
CREATE OR REPLACE FUNCTION public.is_meeting_participant(p_meeting_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.meeting_attendees a
    WHERE a.meeting_id = p_meeting_id
      AND lower(a.member_email) = lower(nullif(auth.jwt() ->> 'email', ''))
  );
$$;

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM public;
REVOKE ALL ON FUNCTION public.is_room_member(text) FROM public;
REVOKE ALL ON FUNCTION public.is_room_admin(text) FROM public;
REVOKE ALL ON FUNCTION public.is_meeting_participant(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_room_member(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_room_admin(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_meeting_participant(uuid) TO authenticated, service_role;

-- ============================================================
-- 2. DUEÑO DE SALA: backfill
-- ============================================================
-- Las salas creadas hasta hoy tienen founder_email NULL (la app nunca lo
-- escribió). Sin dueño, is_room_admin solo daría true al admin global y nadie
-- más podría administrarlas. Se asigna el admin de plataforma como dueño de
-- todas las salas existentes; las nuevas guardan a su creador.
UPDATE rooms SET founder_email = 'community.argen.manager@gmail.com'
WHERE founder_email IS NULL;

-- ============================================================
-- 3. LIMPIEZA: borrar TODA política previa de las tablas afectadas
-- ============================================================
-- Las políticas permisivas se suman con OR: si quedara viva una sola de las
-- viejas ("Public can view ..."), seguiría concediendo lectura pública y esta
-- migración no serviría de nada. Se borran dinámicamente por tabla para no
-- depender de acertar cada nombre histórico.
DO $$
DECLARE
  tbl text;
  pol record;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'rooms', 'members', 'availabilities', 'templates', 'meetings', 'meeting_attendees'
  ] LOOP
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = tbl
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, tbl);
    END LOOP;
  END LOOP;
END $$;

-- ============================================================
-- 4. ROOMS
-- ============================================================
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

-- Lectura para cualquier autenticado: al iniciar sesión por primera vez la app
-- necesita saber si la sala existe ANTES de que la persona sea miembro (si no
-- existe, corta el registro en vez de crear una sala fantasma). Solo expone id
-- y nombre de sala; los datos sensibles viven en las demás tablas, ya cerradas.
CREATE POLICY "Authenticated users can view rooms"
  ON rooms FOR SELECT
  TO authenticated
  USING (true);

-- Crear salas: solo el admin de plataforma, igual que el gate de handleCreateRoom.
CREATE POLICY "Platform admin can create rooms"
  ON rooms FOR INSERT
  TO authenticated
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "Room admins can update their room"
  ON rooms FOR UPDATE
  TO authenticated
  USING (public.is_room_admin(id))
  WITH CHECK (public.is_room_admin(id));

CREATE POLICY "Room admins can delete their room"
  ON rooms FOR DELETE
  TO authenticated
  USING (public.is_room_admin(id));

CREATE POLICY "Service role manages rooms"
  ON rooms FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 5. MEMBERS
-- ============================================================
ALTER TABLE members ENABLE ROW LEVEL SECURITY;

-- Solo miembros de la sala ven su padrón. Para quien todavía no es miembro
-- devuelve vacío, que es exactamente la respuesta que la app espera al decidir
-- si tiene que registrarlo.
CREATE POLICY "Room members can view their room roster"
  ON members FOR SELECT
  TO authenticated
  USING (public.is_room_member(room_id));

-- El auto-registro NO pasa por acá: va por la función join_room (que valida el
-- código de acceso de la sala). Este INSERT es el alta manual desde la pantalla
-- de administración.
CREATE POLICY "Room admins can add members"
  ON members FOR INSERT
  TO authenticated
  WITH CHECK (public.is_room_admin(room_id));

-- Cada quien edita su propia ficha (participación, país, zona horaria);
-- quien administra puede editar cualquiera de su sala.
CREATE POLICY "Members update their own row, admins any row"
  ON members FOR UPDATE
  TO authenticated
  USING (
    lower(email) = lower(nullif(auth.jwt() ->> 'email', ''))
    OR public.is_room_admin(room_id)
  )
  WITH CHECK (
    lower(email) = lower(nullif(auth.jwt() ->> 'email', ''))
    OR public.is_room_admin(room_id)
  );

-- Sacar a otra persona: solo quien administra. Cada quien puede darse de baja.
CREATE POLICY "Admins remove members, members can leave"
  ON members FOR DELETE
  TO authenticated
  USING (
    lower(email) = lower(nullif(auth.jwt() ->> 'email', ''))
    OR public.is_room_admin(room_id)
  );

CREATE POLICY "Service role manages members"
  ON members FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 6. AVAILABILITIES
-- ============================================================
ALTER TABLE availabilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Room members can view availabilities"
  ON availabilities FOR SELECT
  TO authenticated
  USING (public.is_room_member(room_id));

CREATE POLICY "Room members can manage availabilities"
  ON availabilities FOR ALL
  TO authenticated
  USING (public.is_room_member(room_id))
  WITH CHECK (public.is_room_member(room_id));

CREATE POLICY "Service role manages availabilities"
  ON availabilities FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 7. TEMPLATES
-- ============================================================
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Room members can view templates"
  ON templates FOR SELECT
  TO authenticated
  USING (public.is_room_member(room_id));

CREATE POLICY "Room members can manage templates"
  ON templates FOR ALL
  TO authenticated
  USING (public.is_room_member(room_id))
  WITH CHECK (public.is_room_member(room_id));

CREATE POLICY "Service role manages templates"
  ON templates FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 8. MEETINGS
-- ============================================================
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;

-- Cierra la fuga del enlace de Meet: antes cualquiera podía leerlo sin login.
CREATE POLICY "Room members can view meetings"
  ON meetings FOR SELECT
  TO authenticated
  USING (public.is_room_member(room_id));

CREATE POLICY "Room members can manage meetings"
  ON meetings FOR ALL
  TO authenticated
  USING (public.is_room_member(room_id))
  WITH CHECK (public.is_room_member(room_id));

CREATE POLICY "Service role manages meetings"
  ON meetings FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 9. MEETING_ATTENDEES — Hallazgo 04
-- ============================================================
ALTER TABLE meeting_attendees ENABLE ROW LEVEL SECURITY;

-- Ver la asistencia de la sala sigue siendo necesario para el score de
-- confiabilidad y los reportes agregados, así que la lectura es de sala.
CREATE POLICY "Room members can view attendance"
  ON meeting_attendees FOR SELECT
  TO authenticated
  USING (public.is_room_member(room_id));

-- Las filas se crean junto con la reunión, por cualquiera de los dos participantes.
CREATE POLICY "Room members can create attendance rows"
  ON meeting_attendees FOR INSERT
  TO authenticated
  WITH CHECK (public.is_room_member(room_id));

-- ESCRITURA RESTRINGIDA A LA DUPLA: el reporte de "asistió / llegó tarde / no
-- se presentó" y la cancelación propia solo pueden hacerlos las dos personas de
-- ESA reunión. Antes bastaba con estar en la misma sala, de modo que un tercero
-- podía marcar a alguien como ausente en una sesión en la que no estuvo y
-- hundirle el score de confiabilidad.
CREATE POLICY "Only the meeting pair can report attendance"
  ON meeting_attendees FOR UPDATE
  TO authenticated
  USING (public.is_meeting_participant(meeting_id))
  WITH CHECK (public.is_meeting_participant(meeting_id));

CREATE POLICY "Service role manages attendance"
  ON meeting_attendees FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 10. MATCH_PROPOSALS
-- ============================================================
-- Ya estaba correctamente acotada a los participantes (20260716130000); se
-- reafirma el estado canónico por si sobrevive alguna política vieja.
ALTER TABLE match_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own proposals" ON match_proposals;
DROP POLICY IF EXISTS "Users can update their own proposal status" ON match_proposals;
DROP POLICY IF EXISTS "Service role can manage proposals" ON match_proposals;

CREATE POLICY "Users can view their own proposals"
  ON match_proposals FOR SELECT
  TO authenticated
  USING (
    lower(nullif(auth.jwt() ->> 'email', '')) IN (lower(member_a_email), lower(member_b_email))
  );

CREATE POLICY "Users can update their own proposal status"
  ON match_proposals FOR UPDATE
  TO authenticated
  USING (
    lower(nullif(auth.jwt() ->> 'email', '')) IN (lower(member_a_email), lower(member_b_email))
  )
  WITH CHECK (
    lower(nullif(auth.jwt() ->> 'email', '')) IN (lower(member_a_email), lower(member_b_email))
  );

CREATE POLICY "Service role can manage proposals"
  ON match_proposals FOR ALL TO service_role USING (true) WITH CHECK (true);
