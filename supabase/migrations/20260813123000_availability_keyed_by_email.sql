-- Auditoría 2026-08-13 — Hallazgo 09: la disponibilidad se guardaba por nombre.
--
-- availabilities y templates vinculan cada bloque horario a su dueño por la
-- columna de texto libre "user", que guarda el NOMBRE que la persona escribió.
-- El nombre no identifica a nadie de forma estable:
--
--   * dos miembros homónimos en la misma sala comparten (y se pisan) sus
--     horarios, sin que ninguno de los dos se entere;
--   * si alguien cambia su nombre en members, sus filas de availabilities
--     quedan huérfanas y siguen pintando el mapa de calor hasta el próximo
--     guardado.
--
-- Se agrega member_email, que sí es estable (es la clave con la que el miembro
-- entra y la que usa el emparejador). La columna "user" se conserva: sigue
-- alimentando las etiquetas del mapa de calor y sirve de respaldo para las
-- filas que el backfill no pueda resolver sin ambigüedad.

ALTER TABLE availabilities ADD COLUMN IF NOT EXISTS member_email TEXT;
ALTER TABLE templates      ADD COLUMN IF NOT EXISTS member_email TEXT;

-- ============================================================
-- BACKFILL
-- ============================================================
-- Solo se completan las filas cuyo nombre corresponde a UN ÚNICO miembro de la
-- sala. Si dos personas comparten nombre no hay forma de saber de quién es cada
-- bloque, y adivinar seria peor que no tocar: esas filas quedan con
-- member_email NULL y siguen resolviéndose por nombre, exactamente como hasta
-- ahora. El caso ambiguo se corrige solo la próxima vez que cada quien guarde
-- su disponibilidad, porque desde este cambio se escribe siempre con email.
UPDATE availabilities a
SET member_email = unico.email
FROM (
  SELECT room_id, lower(name) AS lname, min(lower(email)) AS email
  FROM members
  GROUP BY room_id, lower(name)
  HAVING count(*) = 1
) unico
WHERE a.room_id = unico.room_id
  AND lower(a."user") = unico.lname
  AND a.member_email IS NULL;

UPDATE templates t
SET member_email = unico.email
FROM (
  SELECT room_id, lower(name) AS lname, min(lower(email)) AS email
  FROM members
  GROUP BY room_id, lower(name)
  HAVING count(*) = 1
) unico
WHERE t.room_id = unico.room_id
  AND lower(t."user") = unico.lname
  AND t.member_email IS NULL;

CREATE INDEX IF NOT EXISTS idx_availabilities_room_email
  ON availabilities(room_id, member_email);
CREATE INDEX IF NOT EXISTS idx_templates_room_email
  ON templates(room_id, member_email);

-- ============================================================
-- ESCRITURA ACOTADA A LAS FILAS PROPIAS
-- ============================================================
-- Con un dueño estable ya se puede exigir que cada quien escriba solo sus
-- horarios. Antes bastaba con pertenecer a la sala, así que cualquier miembro
-- podía sobrescribir la disponibilidad de otro.
--
-- Se contemplan tres casos: la fila es mía, la fila es antigua y todavía no
-- tiene dueño resuelto (member_email NULL), o quien escribe administra la sala
-- (necesario para limpiar los horarios de alguien al darlo de baja).
DROP POLICY IF EXISTS "Room members can manage availabilities" ON availabilities;
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
      member_email IS NULL
      OR lower(member_email) = lower(nullif(auth.jwt() ->> 'email', ''))
      OR public.is_room_admin(room_id)
    )
  );

DROP POLICY IF EXISTS "Room members can manage templates" ON templates;
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
      member_email IS NULL
      OR lower(member_email) = lower(nullif(auth.jwt() ->> 'email', ''))
      OR public.is_room_admin(room_id)
    )
  );
