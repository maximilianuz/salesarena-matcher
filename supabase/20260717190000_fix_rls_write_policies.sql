-- Ajusta las policies de escritura al comportamiento real de la app:
-- no existe un "founder" writer-gated; las salas se autocrean por URL,
-- los miembros se auto-registran con su propio email, y las reuniones /
-- asistencia se insertan directo desde el cliente.

-- rooms
DROP POLICY IF EXISTS "Founders can insert their rooms" ON rooms;
DROP POLICY IF EXISTS "Founders can update their rooms" ON rooms;
DROP POLICY IF EXISTS "Founders can delete their rooms" ON rooms;

CREATE POLICY "Authenticated users can create rooms"
  ON rooms FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update rooms they belong to"
  ON rooms FOR UPDATE
  TO authenticated
  USING (
    founder_email IS NULL
    OR founder_email = auth.jwt() ->> 'email'
    OR id IN (SELECT room_id FROM members WHERE email = auth.jwt() ->> 'email')
  )
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete rooms they belong to"
  ON rooms FOR DELETE
  TO authenticated
  USING (
    founder_email = auth.jwt() ->> 'email'
    OR id IN (SELECT room_id FROM members WHERE email = auth.jwt() ->> 'email')
  );

-- members
DROP POLICY IF EXISTS "Room owners can insert members" ON members;
DROP POLICY IF EXISTS "Room owners can delete members" ON members;

CREATE POLICY "Authenticated users can register themselves as members"
  ON members FOR INSERT
  TO authenticated
  WITH CHECK (email = auth.jwt() ->> 'email');

CREATE POLICY "Members can remove their own membership"
  ON members FOR DELETE
  TO authenticated
  USING (email = auth.jwt() ->> 'email');

-- templates
DROP POLICY IF EXISTS "Authenticated users can create templates" ON templates;
DROP POLICY IF EXISTS "Template creator and room owner can update" ON templates;
DROP POLICY IF EXISTS "Template creator and room owner can delete" ON templates;
DROP POLICY IF EXISTS "Template creator and room owner can select" ON templates;

CREATE POLICY "Room members can view templates"
  ON templates FOR SELECT
  TO authenticated
  USING (room_id IN (SELECT room_id FROM members WHERE email = auth.jwt() ->> 'email'));

CREATE POLICY "Room members can create templates"
  ON templates FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.jwt() ->> 'email'
    AND room_id IN (SELECT room_id FROM members WHERE email = auth.jwt() ->> 'email')
  );

CREATE POLICY "Template creator can update"
  ON templates FOR UPDATE
  TO authenticated
  USING (created_by = auth.jwt() ->> 'email')
  WITH CHECK (created_by = auth.jwt() ->> 'email');

CREATE POLICY "Template creator can delete"
  ON templates FOR DELETE
  TO authenticated
  USING (created_by = auth.jwt() ->> 'email');

-- meetings
DROP POLICY IF EXISTS "Participants can view their meetings" ON meetings;

CREATE POLICY "Room members can view meetings"
  ON meetings FOR SELECT
  TO authenticated
  USING (room_id IN (SELECT room_id FROM members WHERE email = auth.jwt() ->> 'email'));

CREATE POLICY "Room members can create meetings"
  ON meetings FOR INSERT
  TO authenticated
  WITH CHECK (room_id IN (SELECT room_id FROM members WHERE email = auth.jwt() ->> 'email'));

-- meeting_attendees: le faltaba la policy de INSERT (nunca existió)
DROP POLICY IF EXISTS "Room members can create attendance rows" ON meeting_attendees;

CREATE POLICY "Room members can create attendance rows"
  ON meeting_attendees FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM members m
      WHERE m.room_id = meeting_attendees.room_id
        AND m.email = auth.jwt() ->> 'email'
    )
  );
