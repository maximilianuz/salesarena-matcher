-- Enable RLS on core tables: rooms, members, availabilities, templates, meetings.
-- These tables were created outside migrations and may not have RLS enabled.
-- This migration ensures they are protected with row-level security policies.
--
-- Esquema de acceso:
--   rooms, members: solo el creador/founder puede ver/editar su sala
--   availabilities: solo el miembro puede ver/editar su disponibilidad
--   templates: solo el creador puede ver/editar
--   meetings: solo participantes autenticados que estén en match_proposals
--
-- Nota: Se asume que existen foreign keys a auth.users(id) o al menos email como
-- identificador. Si la tabla usa otra columna para auth, hay que ajustar las policies.

-- 1. rooms: solo founder/owner puede ver/editar
ALTER TABLE IF EXISTS rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view their own room" ON rooms;
DROP POLICY IF EXISTS "Founders can create and manage rooms" ON rooms;

CREATE POLICY "Authenticated users can view their own room"
  ON rooms FOR SELECT
  TO authenticated
  USING (
    founder_email = auth.jwt() ->> 'email' OR
    id IN (
      SELECT room_id FROM members
      WHERE email = auth.jwt() ->> 'email'
    )
  );

CREATE POLICY "Founders can manage their rooms"
  ON rooms FOR INSERT, UPDATE, DELETE
  TO authenticated
  USING (founder_email = auth.jwt() ->> 'email')
  WITH CHECK (founder_email = auth.jwt() ->> 'email');

-- Service role puede hacer cualquier cosa
CREATE POLICY "Service role can manage all rooms"
  ON rooms FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. members: solo el miembro autenticado puede ver sus datos, solo sala owner puede editar
ALTER TABLE IF EXISTS members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view their own record" ON members;
DROP POLICY IF EXISTS "Members can update their own data" ON members;
DROP POLICY IF EXISTS "Room founders can manage members" ON members;

CREATE POLICY "Members can view their own record"
  ON members FOR SELECT
  TO authenticated
  USING (email = auth.jwt() ->> 'email');

CREATE POLICY "Members can update their own profile data"
  ON members FOR UPDATE
  TO authenticated
  USING (email = auth.jwt() ->> 'email')
  WITH CHECK (email = auth.jwt() ->> 'email');

CREATE POLICY "Room owners can manage members"
  ON members FOR INSERT, DELETE
  TO authenticated
  USING (
    room_id IN (
      SELECT id FROM rooms WHERE founder_email = auth.jwt() ->> 'email'
    )
  )
  WITH CHECK (
    room_id IN (
      SELECT id FROM rooms WHERE founder_email = auth.jwt() ->> 'email'
    )
  );

CREATE POLICY "Service role can manage all members"
  ON members FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 3. availabilities: solo el miembro puede ver/editar su disponibilidad
ALTER TABLE IF EXISTS availabilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view their own availabilities" ON availabilities;
DROP POLICY IF EXISTS "Members can manage their own availabilities" ON availabilities;

CREATE POLICY "Members can view their own availabilities"
  ON availabilities FOR SELECT
  TO authenticated
  USING (email = auth.jwt() ->> 'email');

CREATE POLICY "Members can manage their own availabilities"
  ON availabilities FOR INSERT, UPDATE, DELETE
  TO authenticated
  USING (email = auth.jwt() ->> 'email')
  WITH CHECK (email = auth.jwt() ->> 'email');

CREATE POLICY "Service role can manage all availabilities"
  ON availabilities FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 4. templates: solo creator o room founder puede ver/editar
ALTER TABLE IF EXISTS templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Template creator and room owner can access" ON templates;

CREATE POLICY "Template creator and room owner can access"
  ON templates FOR SELECT, UPDATE, DELETE
  TO authenticated
  USING (
    created_by = auth.jwt() ->> 'email' OR
    room_id IN (
      SELECT id FROM rooms WHERE founder_email = auth.jwt() ->> 'email'
    )
  );

CREATE POLICY "Authenticated users can create templates"
  ON templates FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.jwt() ->> 'email' AND
    room_id IN (
      SELECT id FROM rooms WHERE founder_email = auth.jwt() ->> 'email'
    )
  );

CREATE POLICY "Service role can manage all templates"
  ON templates FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 5. meetings: accesible por participantes (via match_proposals) o room members
ALTER TABLE IF EXISTS meetings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can view their meetings" ON meetings;

CREATE POLICY "Participants can view their meetings"
  ON meetings FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT DISTINCT mp.meeting_id
      FROM match_proposals mp
      WHERE mp.meeting_id IS NOT NULL
        AND (mp.member_a_email = auth.jwt() ->> 'email'
             OR mp.member_b_email = auth.jwt() ->> 'email')
    )
    OR room_id IN (
      SELECT room_id FROM members
      WHERE email = auth.jwt() ->> 'email'
    )
  );

CREATE POLICY "Service role can manage all meetings"
  ON meetings FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Si se necesita crear/editar meetings desde el cliente (ej. crear manual meeting):
-- descomenta lo siguiente y ajusta según necesidad:
-- CREATE POLICY "Authenticated users can create meetings in their room"
--   ON meetings FOR INSERT
--   TO authenticated
--   WITH CHECK (
--     room_id IN (
--       SELECT room_id FROM members
--       WHERE email = auth.jwt() ->> 'email'
--     )
--   );
