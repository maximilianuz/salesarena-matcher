-- Modelo de acceso alineado con la arquitectura real de la app:
--
--   * La app carga sala, miembros, disponibilidad, reuniones y asistencia
--     ANTES del login (rol anon), y auto-crea la sala al visitar la URL.
--     → Lecturas públicas; creación de sala permitida a anon.
--   * availabilities NO guarda email (usa `user` = nombre del miembro), así
--     que las escrituras se gatillan por membresía de sala, no por email.
--   * La política previa de members que consultaba members dentro de su
--     propia política SELECT causaba recursión infinita (42P17). Con el
--     SELECT público, las subconsultas a members desde otras políticas
--     terminan sin recursión.
--   * Escrituras: INSERT en members solo con el propio email del JWT;
--     el resto de escrituras exige ser miembro de la sala.

-- ============ ROOMS ============
ALTER TABLE IF EXISTS rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view rooms they're a member of" ON rooms;
DROP POLICY IF EXISTS "Authenticated users can create rooms" ON rooms;
DROP POLICY IF EXISTS "Room members can update their room" ON rooms;
DROP POLICY IF EXISTS "Public can view rooms" ON rooms;
DROP POLICY IF EXISTS "Public can create rooms" ON rooms;
DROP POLICY IF EXISTS "Room members can delete their room" ON rooms;

CREATE POLICY "Public can view rooms"
  ON rooms FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Public can create rooms"
  ON rooms FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Room members can update their room"
  ON rooms FOR UPDATE
  TO authenticated
  USING (
    id IN (
      SELECT room_id FROM members
      WHERE lower(email) = lower(auth.jwt() ->> 'email')
    )
  )
  WITH CHECK (true);

CREATE POLICY "Room members can delete their room"
  ON rooms FOR DELETE
  TO authenticated
  USING (
    id IN (
      SELECT room_id FROM members
      WHERE lower(email) = lower(auth.jwt() ->> 'email')
    )
  );

-- ============ MEMBERS ============
ALTER TABLE IF EXISTS members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view their own record" ON members;
DROP POLICY IF EXISTS "Members can view all members in their rooms" ON members;
DROP POLICY IF EXISTS "Authenticated users can register themselves as members" ON members;
DROP POLICY IF EXISTS "Members can update their own profile" ON members;
DROP POLICY IF EXISTS "Public can view members" ON members;
DROP POLICY IF EXISTS "Users can register themselves" ON members;
DROP POLICY IF EXISTS "Room members can update members" ON members;
DROP POLICY IF EXISTS "Room members can delete members" ON members;

CREATE POLICY "Public can view members"
  ON members FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Users can register themselves"
  ON members FOR INSERT
  TO authenticated
  WITH CHECK (lower(email) = lower(auth.jwt() ->> 'email'));

CREATE POLICY "Room members can update members"
  ON members FOR UPDATE
  TO authenticated
  USING (
    room_id IN (
      SELECT room_id FROM members
      WHERE lower(email) = lower(auth.jwt() ->> 'email')
    )
  )
  WITH CHECK (true);

CREATE POLICY "Room members can delete members"
  ON members FOR DELETE
  TO authenticated
  USING (
    room_id IN (
      SELECT room_id FROM members
      WHERE lower(email) = lower(auth.jwt() ->> 'email')
    )
  );

-- ============ AVAILABILITIES ============
ALTER TABLE IF EXISTS availabilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view their own availabilities" ON availabilities;
DROP POLICY IF EXISTS "Members can view availabilities of others in their rooms" ON availabilities;
DROP POLICY IF EXISTS "Members can insert their own availabilities" ON availabilities;
DROP POLICY IF EXISTS "Members can update their own availabilities" ON availabilities;
DROP POLICY IF EXISTS "Members can delete their own availabilities" ON availabilities;
DROP POLICY IF EXISTS "Public can view availabilities" ON availabilities;
DROP POLICY IF EXISTS "Room members can manage availabilities" ON availabilities;

CREATE POLICY "Public can view availabilities"
  ON availabilities FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Room members can manage availabilities"
  ON availabilities FOR ALL
  TO authenticated
  USING (
    room_id IN (
      SELECT room_id FROM members
      WHERE lower(email) = lower(auth.jwt() ->> 'email')
    )
  )
  WITH CHECK (
    room_id IN (
      SELECT room_id FROM members
      WHERE lower(email) = lower(auth.jwt() ->> 'email')
    )
  );

-- ============ TEMPLATES ============
ALTER TABLE IF EXISTS templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Template creator and room members can view" ON templates;
DROP POLICY IF EXISTS "Template creator can update" ON templates;
DROP POLICY IF EXISTS "Template creator can delete" ON templates;
DROP POLICY IF EXISTS "Template creator can update/delete" ON templates;
DROP POLICY IF EXISTS "Authenticated users can create templates in their rooms" ON templates;
DROP POLICY IF EXISTS "Public can view templates" ON templates;
DROP POLICY IF EXISTS "Room members can manage templates" ON templates;

CREATE POLICY "Public can view templates"
  ON templates FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Room members can manage templates"
  ON templates FOR ALL
  TO authenticated
  USING (
    room_id IN (
      SELECT room_id FROM members
      WHERE lower(email) = lower(auth.jwt() ->> 'email')
    )
  )
  WITH CHECK (
    room_id IN (
      SELECT room_id FROM members
      WHERE lower(email) = lower(auth.jwt() ->> 'email')
    )
  );

-- ============ MEETINGS ============
ALTER TABLE IF EXISTS meetings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can view their meetings" ON meetings;
DROP POLICY IF EXISTS "Public can view meetings" ON meetings;
DROP POLICY IF EXISTS "Room members can manage meetings" ON meetings;

CREATE POLICY "Public can view meetings"
  ON meetings FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Room members can manage meetings"
  ON meetings FOR ALL
  TO authenticated
  USING (
    room_id IN (
      SELECT room_id FROM members
      WHERE lower(email) = lower(auth.jwt() ->> 'email')
    )
  )
  WITH CHECK (
    room_id IN (
      SELECT room_id FROM members
      WHERE lower(email) = lower(auth.jwt() ->> 'email')
    )
  );

-- ============ MEETING_ATTENDEES ============
ALTER TABLE IF EXISTS meeting_attendees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Room members can view meeting attendees" ON meeting_attendees;
DROP POLICY IF EXISTS "Room members can insert meeting attendees" ON meeting_attendees;
DROP POLICY IF EXISTS "Public can view meeting attendees" ON meeting_attendees;
DROP POLICY IF EXISTS "Room members can manage meeting attendees" ON meeting_attendees;

CREATE POLICY "Public can view meeting attendees"
  ON meeting_attendees FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Room members can manage meeting attendees"
  ON meeting_attendees FOR ALL
  TO authenticated
  USING (
    room_id IN (
      SELECT room_id FROM members
      WHERE lower(email) = lower(auth.jwt() ->> 'email')
    )
  )
  WITH CHECK (
    room_id IN (
      SELECT room_id FROM members
      WHERE lower(email) = lower(auth.jwt() ->> 'email')
    )
  );
