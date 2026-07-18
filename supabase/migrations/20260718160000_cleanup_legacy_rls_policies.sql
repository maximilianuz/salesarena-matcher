-- Auditoría RLS 2026-07-18: limpieza de políticas legadas.
--
-- La auditoría de pg_policies contra producción reveló que `members` y `rooms`
-- arrastraban políticas del modelo original "founder/owner" conviviendo con
-- las canónicas del modelo actual (lecturas públicas + escrituras por
-- membresía de sala, definido en 20260718100000 / 20260718130000).
--
-- No son peligrosas —las políticas permisivas se suman con OR, así que solo
-- podrían AGREGAR acceso, nunca restringir— y de hecho están muertas: apuntan
-- a founder_email, que hoy es NULL en toda sala creada por la app. Se eliminan
-- por higiene, para que cada tabla quede solo con su modelo canónico. Borrar
-- una política permisiva es seguro: no quita ningún acceso que las políticas
-- canónicas restantes ya otorgan (verificado contra los flujos de la app).

-- ============ MEMBERS ============
DROP POLICY IF EXISTS "Room owners can insert members" ON members;
DROP POLICY IF EXISTS "Room owners can delete members" ON members;
DROP POLICY IF EXISTS "Members can update their own profile data" ON members;

-- ============ ROOMS ============
DROP POLICY IF EXISTS "Founders can insert their rooms" ON rooms;
DROP POLICY IF EXISTS "Founders can delete their rooms" ON rooms;
DROP POLICY IF EXISTS "Founders can update their rooms" ON rooms;
-- Redundante con "Public can view rooms" (SELECT a anon + authenticated)
DROP POLICY IF EXISTS "Authenticated users can view their own room" ON rooms;
