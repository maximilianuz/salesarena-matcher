// Tests de las utilidades de presentación (src/utils/format.js).
// Son funciones chicas, pero su salida se muestra tal cual en pantalla —
// incluida la página pública— así que un caso borde mal resuelto se ve.

import test from 'node:test';
import assert from 'node:assert/strict';
import { getInitials, slugifyRoomName, nameFromEmail, escapeLikeLiteral } from '../src/utils/format.js';

test('getInitials: nombre y apellido, una sola palabra, y espacios de más', () => {
  assert.equal(getInitials('Ana Pérez'), 'AP');
  assert.equal(getInitials('Ana'), 'A');
  assert.equal(getInitials('  ana   pérez  '), 'AP');
  assert.equal(getInitials('Ana María Pérez'), 'AM'); // máximo 2
});

test('getInitials: sin nombre utilizable devuelve "?" y nunca el texto "UNDEFINED"', () => {
  // Un nombre de solo espacios es truthy, así que el guard `!name` no lo
  // atrapaba: parts[0][0] daba undefined y el avatar mostraba "UNDEFINED"
  // como si fueran las iniciales de la persona.
  for (const vacio of ['', '   ', '\t', '\n  \n', null, undefined]) {
    assert.equal(getInitials(vacio), '?', `falló con ${JSON.stringify(vacio)}`);
  }
});

test('slugifyRoomName: acentos, símbolos y espacios → slug de URL', () => {
  assert.equal(slugifyRoomName('Equipo Comercial'), 'equipo-comercial');
  assert.equal(slugifyRoomName('Ventas & Marketing 2026'), 'ventas-marketing-2026');
  assert.equal(slugifyRoomName('  Rôle Plays  '), 'role-plays');
  assert.equal(slugifyRoomName('¿?¡!'), '', 'sin letras ni números no hay slug');
});

test('nameFromEmail: deriva un nombre presentable cuando Google no manda uno', () => {
  assert.equal(nameFromEmail('carlos.mendoza@gmail.com'), 'Carlos Mendoza');
  assert.equal(nameFromEmail('ana_perez@x.com'), 'Ana Perez');
  assert.equal(nameFromEmail(''), 'Invitado');
});

test('escapeLikeLiteral: los comodines de LIKE en un email se escapan', () => {
  // El guion bajo es válido en un email y en ILIKE significa "cualquier
  // carácter": sin escapar, un patrón podía dar por buena a otra persona.
  assert.equal(escapeLikeLiteral('ana_perez@x.com'), 'ana\\_perez@x.com');
  assert.equal(escapeLikeLiteral('a%b@x.com'), 'a\\%b@x.com');
});
