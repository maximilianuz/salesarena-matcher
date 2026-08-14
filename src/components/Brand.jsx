// Piezas visuales de marca reutilizadas en varias pantallas.
import React from 'react';
import { ShieldCheck, Handshake, Users, MessageCircle } from 'lucide-react';

// La app renderiza este ícono varias veces a la vez (header móvil + sidebar de
// escritorio quedan ambos en el DOM; uno se oculta solo por CSS según el
// viewport). Un id de gradiente fijo se duplicaba entonces en el documento, y
// un id duplicado en SVG es inválido: el navegador podía resolver mal la
// referencia fill="url(#...)" en alguna de las instancias y pintarla opaca en
// vez del degradé de marca. useId() le da a cada instancia su propio id.
export const ChessKnightIcon = ({ size = 26 }) => {
  const gradientId = `salesArenaKnightBg-${React.useId()}`;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 512 512" style={{ display: 'block' }} className="chess-knight-svg">
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0a84ff"/>
          <stop offset="55%" stopColor="#5e5ce6"/>
          <stop offset="100%" stopColor="#4d4ad9"/>
        </linearGradient>
      </defs>
      <rect className="knight-bg" width="512" height="512" rx="115" fill={`url(#${gradientId})`}/>
      <g transform="translate(112, 112) scale(12)" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 20a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/>
        <path d="M16.5 18c1-2 2.5-5 2.5-9a7 7 0 0 0-7-7H6.635a1 1 0 0 0-.768 1.64L7 5l-2.32 5.802a2 2 0 0 0 .95 2.526l2.87 1.456"/>
        <path d="m15 5 1.425-1.425"/>
        <path d="m17 8 1.53-1.53"/>
        <path d="M9.713 12.185 7 18"/>
      </g>
    </svg>
  );
};

// Isotipo oficial de Google para el botón de inicio de sesión
export const GoogleMark = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

// Foto de perfil de Google, si existe, en vez de las iniciales que ya traía
// cada avatar. `children` es ese respaldo (getInitials(...)): si no hay
// avatarUrl, o la imagen falla al cargar (borrada, o Google bloqueándola por
// privacidad — pasa), se muestra tal cual estaba antes. object-fit: cover +
// borderRadius: inherit para que la foto tome exactamente el tamaño y la
// forma del círculo del que ya depende el layout de cada lugar donde se usa
// (perfil, fila de miembro, avatar de la dupla del match...), sin tener que
// tocar el CSS de cada uno.
export const AvatarPhoto = ({ avatarUrl, children }) => {
  const [broken, setBroken] = React.useState(false);
  if (!avatarUrl || broken) return children;
  return (
    <img
      src={avatarUrl}
      alt=""
      onError={() => setBroken(true)}
      style={{ width: '100%', height: '100%', borderRadius: 'inherit', objectFit: 'cover' }}
    />
  );
};

// Piezas de ajedrez en el mismo estilo de trazo que lucide-react (esa
// librería no trae un set de ajedrez), para el halo del login: refuerzan el
// motivo de "partida"/"jugada" sin depender de un ícono de marca ya usado.
const chessStrokeProps = (size) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round'
});

export const ChessPawnIcon = ({ size = 20 }) => (
  <svg {...chessStrokeProps(size)} aria-hidden="true">
    <circle cx="12" cy="7" r="3" />
    <path d="M10.5 10 13.5 10 14.5 19 9.5 19 Z" />
  </svg>
);

export const ChessRookIcon = ({ size = 20 }) => (
  <svg {...chessStrokeProps(size)} aria-hidden="true">
    <rect x="7" y="10" width="10" height="9" rx="1" />
    <path d="M8 10 V6 H10 V8 H14 V6 H16 V10" />
  </svg>
);

export const ChessBishopIcon = ({ size = 20 }) => (
  <svg {...chessStrokeProps(size)} aria-hidden="true">
    <circle cx="12" cy="5" r="1.3" />
    <ellipse cx="12" cy="13.5" rx="4" ry="6" />
    <path d="M8 20 H16" />
  </svg>
);

// Halo decorativo del login: alterna piezas de ajedrez (la partida, el
// role-play) con íconos de conexión entre personas (lo que arma el matcher),
// orbitando alrededor de la tarjeta. Es puro CSS (@keyframes en App.css) para
// no sumar una librería de animación solo para esta pantalla.
// Los radios tienen que superar la mitad del ancho de la tarjeta (max-width
// 420px → ~210px) para que los íconos asomen por fuera en vez de quedar
// tapados detrás de ella.
const ORBIT_NODES = [
  { Icon: ChessPawnIcon, radius: 238, duration: 26, delay: 0 },
  { Icon: Handshake, radius: 238, duration: 26, delay: -8.6 },
  { Icon: ChessRookIcon, radius: 238, duration: 26, delay: -17.3 },
  { Icon: Users, radius: 300, duration: 34, delay: 0, reverse: true },
  { Icon: ChessBishopIcon, radius: 300, duration: 34, delay: -11.3, reverse: true },
  { Icon: MessageCircle, radius: 300, duration: 34, delay: -22.6, reverse: true }
];

export const LoginConnectionsOrbit = () => (
  <div className="login-orbit" aria-hidden="true">
    {ORBIT_NODES.map(({ Icon, radius, duration, delay, reverse }, i) => (
      <div
        key={i}
        className={`login-orbit-icon${reverse ? ' login-orbit-icon--reverse' : ''}`}
        style={{ '--radius': `${radius}px`, '--duration': `${duration}s`, '--delay': `${delay}s` }}
      >
        <Icon size={17} />
      </div>
    ))}
  </div>
);

// Badge de confiabilidad: % de asistencia en sesiones reportadas (60 días)
export const ReliabilityBadge = ({ pct }) => {
  if (pct === null || pct === undefined) {
    return (
      <span className="reliability-badge reliability-new" title="Sin historial de sesiones reportadas en los últimos 60 días">
        Nuevo
      </span>
    );
  }
  const tier = pct >= 80 ? 'high' : pct >= 50 ? 'mid' : 'low';
  return (
    <span
      className={`reliability-badge reliability-${tier}`}
      title={`Confiabilidad: ${pct}% de asistencia sobre sesiones reportadas en los últimos 60 días`}
    >
      <ShieldCheck size={10} /> {pct}%
    </span>
  );
};
