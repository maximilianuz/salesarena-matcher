// Tests de las utilidades de presentación (src/utils/format.js).
// Son funciones chicas, pero su salida se muestra tal cual en pantalla —
// incluida la página pública— así que un caso borde mal resuelto se ve.

import test from 'node:test';
import assert from 'node:assert/strict';
import { getInitials, slugifyRoomName, nameFromEmail, escapeLikeLiteral, googleCalendarUrl } from '../src/utils/format.js';

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

test('googleCalendarUrl: arma el enlace con la fecha en el formato de Google', () => {
  const url = googleCalendarUrl({
    title: 'Roleplay — Ana · Ivo',
    startsAt: '2026-08-19T17:00:00.000Z',
    durationMin: 60,
    meetLink: 'https://meet.google.com/abc-defg-hij'
  });
  const params = new URL(url).searchParams;
  assert.equal(params.get('action'), 'TEMPLATE');
  assert.equal(params.get('text'), 'Roleplay — Ana · Ivo');
  // Google espera YYYYMMDDTHHMMSSZ, sin guiones ni milisegundos.
  assert.equal(params.get('dates'), '20260819T170000Z/20260819T180000Z');
  assert.match(params.get('details'), /meet\.google\.com/);
});

test('googleCalendarUrl: la duración corre el fin, y sin duración asume una hora', () => {
  const media = googleCalendarUrl({ startsAt: '2026-08-19T17:00:00Z', durationMin: 30 });
  assert.equal(new URL(media).searchParams.get('dates'), '20260819T170000Z/20260819T173000Z');

  const porDefecto = googleCalendarUrl({ startsAt: '2026-08-19T17:00:00Z' });
  assert.equal(new URL(porDefecto).searchParams.get('dates'), '20260819T170000Z/20260819T180000Z');
});

test('googleCalendarUrl: sin fecha válida devuelve null y no un enlace roto', () => {
  // La tarjeta esconde el botón cuando esto es null: es preferible no ofrecerlo
  // a mandar a alguien a un calendario con una fecha inventada.
  for (const malo of ['', 'cualquier cosa', null, undefined]) {
    assert.equal(googleCalendarUrl({ startsAt: malo }), null);
  }
});
