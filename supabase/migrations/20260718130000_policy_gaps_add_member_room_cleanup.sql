-- Dos huecos funcionales detectados en la auditoría de flujos:
--
-- 1. La app permite que un miembro agregue manualmente a otra persona a su
--    sala (handleAddMember), pero el INSERT en members solo estaba permitido
--    para el propio email del JWT. Se agrega una política para que miembros
--    de la sala puedan dar de alta a otros en ESA sala.
--
-- 2. Al renombrar una sala, la app migra todos los registros al nuevo slug y
--    luego intenta borrar la sala vieja; en ese momento el usuario ya no es
--    miembro de la vieja, así que el DELETE quedaba bloqueado y la sala
--    huérfana. Se permite borrar salas sin miembros.

DROP POLICY IF EXISTS "Room members can add members to their room" ON members;

CREATE POLICY "Room members can add members to their room"
  ON members FOR INSERT
  TO authenticated
  WITH CHECK (
    room_id IN (
      SELECT room_id FROM members
      WHERE lower(email) = lower(auth.jwt() ->> 'email')
    )
  );

DROP POLICY IF EXISTS "Room members can delete their room" ON rooms;
DROP POLICY IF EXISTS "Members can delete their room or empty rooms" ON rooms;

CREATE POLICY "Members can delete their room or empty rooms"
  ON rooms FOR DELETE
  TO authenticated
  USING (
    id IN (
      SELECT room_id FROM members
      WHERE lower(email) = lower(auth.jwt() ->> 'email')
    )
    OR NOT EXISTS (
      SELECT 1 FROM members m WHERE m.room_id = rooms.id
    )
  );
