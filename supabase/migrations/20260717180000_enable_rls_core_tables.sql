-- Enable RLS on core tables: rooms, members, availabilities, templates, meetings.
-- These tables were created outside migrations and may not have RLS enabled.

-- 1. rooms
ALTER TABLE IF EXISTS rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view their own room" ON rooms;
DROP POLICY IF EXISTS "Founders can manage their rooms" ON rooms;
DROP POLICY IF EXISTS "Founders can insert their rooms" ON rooms;
DROP POLICY IF EXISTS "Founders can update their rooms" ON rooms;
DROP POLICY IF EXISTS "Founders can delete their rooms" ON rooms;
DROP POLICY IF EXISTS "Service role can manage all rooms" ON rooms;

CREATE POLICY "Authenticated users can view their own room"
  ON rooms FOR SELECT
  TO authenticated
  USING (
    founder_email = auth.jwt() ->> 'email' OR
    id IN (SELECT room_id FROM members WHERE email = auth.jwt() ->> 'email')
  );

CREATE POLICY "Founders can insert their rooms"
  ON rooms FOR INSERT
  TO authenticated
  WITH CHECK (founder_email = auth.jwt() ->> 'email');

CREATE POLICY "Founders can update their rooms"
  ON rooms FOR UPDATE
  TO authenticated
  USING (founder_email = auth.jwt() ->> 'email')
  WITH CHECK (founder_email = auth.jwt() ->> 'email');

CREATE POLICY "Founders can delete their rooms"
  ON rooms FOR DELETE
  TO authenticated
  USING (founder_email = auth.jwt() ->> 'email');

CREATE POLICY "Service role can manage all rooms"
  ON rooms FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. members
ALTER TABLE IF EXISTS members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view their own record" ON members;
DROP POLICY IF EXISTS "Members can update their own profile data" ON members;
DROP POLICY IF EXISTS "Room owners can manage members" ON members;
DROP POLICY IF EXISTS "Room owners can insert members" ON members;
DROP POLICY IF EXISTS "Room owners can delete members" ON members;
DROP POLICY IF EXISTS "Service role can manage all members" ON members;

CREATE POLICY "Members can view their own record"
  ON members FOR SELECT
  TO authenticated
  USING (email = auth.jwt() ->> 'email');

CREATE POLICY "Members can update their own profile data"
  ON members FOR UPDATE
  TO authenticated
  USING (email = auth.jwt() ->> 'email')
  WITH CHECK (email = auth.jwt() ->> 'email');

CREATE POLICY "Room owners can insert members"
  ON members FOR INSERT
  TO authenticated
  WITH CHECK (room_id IN (SELECT id FROM rooms WHERE founder_email = auth.jwt() ->> 'email'));

CREATE POLICY "Room owners can delete members"
  ON members FOR DELETE
  TO authenticated
  USING (room_id IN (SELECT id FROM rooms WHERE founder_email = auth.jwt() ->> 'email'));

CREATE POLICY "Service role can manage all members"
  ON members FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 3. availabilities
ALTER TABLE IF EXISTS availabilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view their own availabilities" ON availabilities;
DROP POLICY IF EXISTS "Members can manage their own availabilities" ON availabilities;
DROP POLICY IF EXISTS "Service role can manage all availabilities" ON availabilities;

CREATE POLICY "Members can view their own availabilities"
  ON availabilities FOR SELECT
  TO authenticated
  USING (email = auth.jwt() ->> 'email');

CREATE POLICY "Members can insert their own availabilities"
  ON availabilities FOR INSERT
  TO authenticated
  WITH CHECK (email = auth.jwt() ->> 'email');

CREATE POLICY "Members can update their own availabilities"
  ON availabilities FOR UPDATE
  TO authenticated
  USING (email = auth.jwt() ->> 'email')
  WITH CHECK (email = auth.jwt() ->> 'email');

CREATE POLICY "Members can delete their own availabilities"
  ON availabilities FOR DELETE
  TO authenticated
  USING (email = auth.jwt() ->> 'email');

CREATE POLICY "Service role can manage all availabilities"
  ON availabilities FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 4. templates
ALTER TABLE IF EXISTS templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Template creator and room owner can access" ON templates;
DROP POLICY IF EXISTS "Authenticated users can create templates" ON templates;
DROP POLICY IF EXISTS "Service role can manage all templates" ON templates;

CREATE POLICY "Template creator and room owner can select"
  ON templates FOR SELECT
  TO authenticated
  USING (
    created_by = auth.jwt() ->> 'email' OR
    room_id IN (SELECT id FROM rooms WHERE founder_email = auth.jwt() ->> 'email')
  );

CREATE POLICY "Authenticated users can create templates"
  ON templates FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.jwt() ->> 'email' AND
    room_id IN (SELECT id FROM rooms WHERE founder_email = auth.jwt() ->> 'email')
  );

CREATE POLICY "Template creator and room owner can update"
  ON templates FOR UPDATE
  TO authenticated
  USING (
    created_by = auth.jwt() ->> 'email' OR
    room_id IN (SELECT id FROM rooms WHERE founder_email = auth.jwt() ->> 'email')
  )
  WITH CHECK (
    created_by = auth.jwt() ->> 'email' OR
    room_id IN (SELECT id FROM rooms WHERE founder_email = auth.jwt() ->> 'email')
  );

CREATE POLICY "Template creator and room owner can delete"
  ON templates FOR DELETE
  TO authenticated
  USING (
    created_by = auth.jwt() ->> 'email' OR
    room_id IN (SELECT id FROM rooms WHERE founder_email = auth.jwt() ->> 'email')
  );

CREATE POLICY "Service role can manage all templates"
  ON templates FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 5. meetings
ALTER TABLE IF EXISTS meetings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can view their meetings" ON meetings;
DROP POLICY IF EXISTS "Service role can manage all meetings" ON meetings;

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
    OR room_id IN (SELECT room_id FROM members WHERE email = auth.jwt() ->> 'email')
  );

CREATE POLICY "Service role can manage all meetings"
  ON meetings FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
