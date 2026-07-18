-- Fix RLS policies to match actual app architecture
-- Changes:
-- 1. Remove founder-based gating (rooms auto-create, not founder-owned)
-- 2. Allow authenticated users to create and manage their own rooms
-- 3. Allow members to self-register with their email
-- 4. Add missing INSERT policy for meeting_attendees table
-- 5. Ensure email-based access control for members and availabilities

-- 1. rooms: any authenticated user can create rooms, can view rooms they're in
ALTER TABLE IF EXISTS rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view their own room" ON rooms;
DROP POLICY IF EXISTS "Founders can manage their rooms" ON rooms;
DROP POLICY IF EXISTS "Service role can manage all rooms" ON rooms;

CREATE POLICY "Anyone can view rooms they're a member of"
  ON rooms FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT room_id FROM members
      WHERE email = auth.jwt() ->> 'email'
    )
  );

CREATE POLICY "Authenticated users can create rooms"
  ON rooms FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Room members can update their room"
  ON rooms FOR UPDATE
  TO authenticated
  USING (
    id IN (
      SELECT room_id FROM members
      WHERE email = auth.jwt() ->> 'email'
    )
  )
  WITH CHECK (
    id IN (
      SELECT room_id FROM members
      WHERE email = auth.jwt() ->> 'email'
    )
  );

CREATE POLICY "Service role can manage all rooms"
  ON rooms FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. members: allow self-registration and viewing own record
ALTER TABLE IF EXISTS members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view their own record" ON members;
DROP POLICY IF EXISTS "Members can update their own profile data" ON members;
DROP POLICY IF EXISTS "Room owners can manage members" ON members;
DROP POLICY IF EXISTS "Service role can manage all members" ON members;

CREATE POLICY "Members can view their own record"
  ON members FOR SELECT
  TO authenticated
  USING (email = auth.jwt() ->> 'email');

CREATE POLICY "Members can view all members in their rooms"
  ON members FOR SELECT
  TO authenticated
  USING (
    room_id IN (
      SELECT room_id FROM members
      WHERE email = auth.jwt() ->> 'email'
    )
  );

CREATE POLICY "Authenticated users can register themselves as members"
  ON members FOR INSERT
  TO authenticated
  WITH CHECK (email = auth.jwt() ->> 'email');

CREATE POLICY "Members can update their own profile"
  ON members FOR UPDATE
  TO authenticated
  USING (email = auth.jwt() ->> 'email')
  WITH CHECK (email = auth.jwt() ->> 'email');

CREATE POLICY "Service role can manage all members"
  ON members FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 3. availabilities: member can view/edit their own
ALTER TABLE IF EXISTS availabilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view their own availabilities" ON availabilities;
DROP POLICY IF EXISTS "Members can manage their own availabilities" ON availabilities;
DROP POLICY IF EXISTS "Service role can manage all availabilities" ON availabilities;

CREATE POLICY "Members can view their own availabilities"
  ON availabilities FOR SELECT
  TO authenticated
  USING (email = auth.jwt() ->> 'email');

CREATE POLICY "Members can view availabilities of others in their rooms"
  ON availabilities FOR SELECT
  TO authenticated
  USING (
    room_id IN (
      SELECT room_id FROM members
      WHERE email = auth.jwt() ->> 'email'
    )
  );

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

-- 4. templates: creator or room member can access
ALTER TABLE IF EXISTS templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Template creator and room owner can access" ON templates;
DROP POLICY IF EXISTS "Authenticated users can create templates" ON templates;
DROP POLICY IF EXISTS "Service role can manage all templates" ON templates;

CREATE POLICY "Template creator and room members can view"
  ON templates FOR SELECT
  TO authenticated
  USING (
    created_by = auth.jwt() ->> 'email' OR
    room_id IN (
      SELECT room_id FROM members
      WHERE email = auth.jwt() ->> 'email'
    )
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

CREATE POLICY "Authenticated users can create templates in their rooms"
  ON templates FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.jwt() ->> 'email' AND
    room_id IN (
      SELECT room_id FROM members
      WHERE email = auth.jwt() ->> 'email'
    )
  );

CREATE POLICY "Service role can manage all templates"
  ON templates FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 5. meetings: participants or room members can access
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

-- 6. meeting_attendees: add INSERT policy (was missing before)
ALTER TABLE IF EXISTS meeting_attendees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Room members can view meeting attendees" ON meeting_attendees;
DROP POLICY IF EXISTS "Room members can insert meeting attendees" ON meeting_attendees;
DROP POLICY IF EXISTS "Service role can manage all attendees" ON meeting_attendees;

CREATE POLICY "Room members can view meeting attendees"
  ON meeting_attendees FOR SELECT
  TO authenticated
  USING (
    meeting_id IN (
      SELECT id FROM meetings
      WHERE room_id IN (
        SELECT room_id FROM members
        WHERE email = auth.jwt() ->> 'email'
      )
    )
  );

CREATE POLICY "Room members can insert meeting attendees"
  ON meeting_attendees FOR INSERT
  TO authenticated
  WITH CHECK (
    meeting_id IN (
      SELECT id FROM meetings
      WHERE room_id IN (
        SELECT room_id FROM members
        WHERE email = auth.jwt() ->> 'email'
      )
    )
  );

CREATE POLICY "Service role can manage all attendees"
  ON meeting_attendees FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
