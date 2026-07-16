import React, { useState, useEffect } from 'react';
import './App.css';
import { supabase } from './supabaseClient';
import { buildWeeklyPairs, currentWeekStartISO, MIN_LEAD_MS } from './matcher';
import {
  LayoutDashboard,
  CalendarRange,
  Flame,
  Users,
  UserCheck,
  Video,
  Clock,
  Sparkles,
  MapPin,
  Check,
  Trash2,
  AlertCircle,
  Sun,
  Moon,
  Monitor,
  Menu,
  X,
  Share2,
  Copy,
  LogOut,
  Settings,
  HelpCircle,
  ChevronRight,
  ChevronLeft,
  Globe,
  CalendarCheck,
  CalendarDays,
  Handshake,
  Trophy,
  Mail,
  Pencil,
  Save,
  Eraser,
  Target,
  UserPlus,
  Briefcase,
  Sunrise,
  Sunset,
  Lock,
  RefreshCw,
  ShieldCheck,
  MicOff
} from 'lucide-react';

const ChessKnightIcon = ({ size = 26 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 512 512" style={{ display: 'block' }} className="chess-knight-svg">
    <defs>
      <linearGradient id="salesArenaKnightBg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#0a84ff"/>
        <stop offset="55%" stopColor="#5e5ce6"/>
        <stop offset="100%" stopColor="#4d4ad9"/>
      </linearGradient>
    </defs>
    <rect className="knight-bg" width="512" height="512" rx="115" fill="url(#salesArenaKnightBg)"/>
    <g transform="translate(112, 112) scale(12)" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 20a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/>
      <path d="M16.5 18c1-2 2.5-5 2.5-9a7 7 0 0 0-7-7H6.635a1 1 0 0 0-.768 1.64L7 5l-2.32 5.802a2 2 0 0 0 .95 2.526l2.87 1.456"/>
      <path d="m15 5 1.425-1.425"/>
      <path d="m17 8 1.53-1.53"/>
      <path d="M9.713 12.185 7 18"/>
    </g>
  </svg>
);

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

// Paises y Zonas Horarias
const ZONAS = [
  // América
  { country: 'Argentina', tz: 'America/Argentina/Buenos_Aires', flag: '🇦🇷' },
  { country: 'Chile', tz: 'America/Santiago', flag: '🇨🇱' },
  { country: 'Colombia', tz: 'America/Bogota', flag: '🇨🇴' },
  { country: 'México', tz: 'America/Mexico_City', flag: '🇲🇽' },
  { country: 'Estados Unidos (Este)', tz: 'America/New_York', flag: '🇺🇸' },
  { country: 'Estados Unidos (Pacífico)', tz: 'America/Los_Angeles', flag: '🇺🇸' },
  { country: 'Perú', tz: 'America/Lima', flag: '🇵🇪' },
  { country: 'Uruguay', tz: 'America/Montevideo', flag: '🇺🇾' },
  { country: 'Ecuador', tz: 'America/Guayaquil', flag: '🇪🇨' },
  { country: 'Paraguay', tz: 'America/Asuncion', flag: '🇵🇾' },
  { country: 'Bolivia', tz: 'America/La_Paz', flag: '🇧🇴' },
  { country: 'Costa Rica', tz: 'America/Costa_Rica', flag: '🇨🇷' },
  { country: 'Panamá', tz: 'America/Panama', flag: '🇵🇦' },
  { country: 'Venezuela', tz: 'America/Caracas', flag: '🇻🇪' },

  // Europa Central / Occidental
  { country: 'España', tz: 'Europe/Madrid', flag: '🇪🇸' },
  { country: 'Alemania', tz: 'Europe/Berlin', flag: '🇩🇪' },
  { country: 'Francia', tz: 'Europe/Paris', flag: '🇫🇷' },
  { country: 'Italia', tz: 'Europe/Rome', flag: '🇮🇹' },
  { country: 'Reino Unido', tz: 'Europe/London', flag: '🇬🇧' },
  { country: 'Suiza', tz: 'Europe/Zurich', flag: '🇨🇭' },
  { country: 'Austria', tz: 'Europe/Vienna', flag: '🇦🇹' },
  { country: 'Polonia', tz: 'Europe/Warsaw', flag: '🇵🇱' },
  { country: 'Países Bajos', tz: 'Europe/Amsterdam', flag: '🇳🇱' },
  { country: 'Bélgica', tz: 'Europe/Brussels', flag: '🇧🇪' },
  { country: 'República Checa', tz: 'Europe/Prague', flag: '🇨🇿' }
];

// Bandera del país (fallback a globo si no está en la lista)
const getCountryFlag = (countryName) => {
  if (!countryName) return '🌐';
  const cleanName = countryName.trim().toLowerCase();
  const matched = ZONAS.find(z =>
    z.country.toLowerCase().includes(cleanName) ||
    cleanName.includes(z.country.toLowerCase())
  );
  return matched ? matched.flag : '🌐';
};

// Iniciales para avatares (máx. 2 letras)
const getInitials = (name) => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
};

// Color de avatar estable por nombre
const AVATAR_COLORS = ['#5e5ce6', '#0a84ff', '#30d158', '#ff9f0a', '#ff375f', '#bf5af2', '#64d2ff', '#ffd60a'];
const getAvatarColor = (name) => {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
};

// Nombre corto de la zona horaria (ciudad)
const tzCity = (tz) => (tz || 'UTC').split('/').pop().replace(/_/g, ' ');

// Badge de confiabilidad: % de asistencia en sesiones reportadas (60 días)
const ReliabilityBadge = ({ pct }) => {
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

// Offset real en minutos respecto de UTC para cualquier zona IANA.
// Usa Intl (nativo del navegador) y refleja automáticamente el horario
// de verano (DST) vigente en el momento del cálculo.
const tzOffsetCache = {};
const getOffsetMinutes = (tz) => {
  if (!tz || tz === 'UTC') return 0;
  if (tzOffsetCache[tz] !== undefined) return tzOffsetCache[tz];
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset'
    }).formatToParts(new Date());
    const name = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT';
    // name es "GMT-3", "GMT+5:30" o "GMT" (=UTC)
    const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    const offset = m
      ? (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + (m[3] ? parseInt(m[3], 10) : 0))
      : 0;
    tzOffsetCache[tz] = offset;
    return offset;
  } catch {
    return 0; // zona inválida → tratar como UTC
  }
};

const resolveTimezone = (countryName) => {
  if (!countryName) return 'UTC';
  const cleanName = countryName.trim().toLowerCase();
  
  // Buscar en las ZONAS predefinidas
  const matched = ZONAS.find(z => 
    z.country.toLowerCase().includes(cleanName) || 
    cleanName.includes(z.country.toLowerCase())
  );
  if (matched) return matched.tz;
  
  // Como fallback, usar la zona horaria real del navegador del usuario
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch (e) {
    return 'UTC';
  }
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Código de invitación de sala: 6 caracteres alfanuméricos en mayúscula
const generateInviteCode = () => {
  let code = '';
  while (code.length < 6) {
    code += Math.random().toString(36).replace(/[^a-z0-9]/g, '');
  }
  return code.substring(0, 6).toUpperCase();
};

// Fecha/hora UTC real de la próxima ocurrencia del match.
// match.startSlot codifica día (0=Lunes) y hora UTC dentro de la semana.
const getNextMatchDateUtc = (match) => {
  const dayIdx = Math.floor(match.startSlot / 24); // 0 = Lunes ... 6 = Domingo
  const hourUtc = match.startSlot % 24;
  const now = new Date();
  const start = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 0, 0
  ));
  // getUTCDay(): 0=Domingo..6=Sábado → convertir a 0=Lunes..6=Domingo
  const todayIdx = (start.getUTCDay() + 6) % 7;
  let delta = (dayIdx - todayIdx + 7) % 7;
  if (delta === 0 && start <= now) delta = 7; // ya pasó hoy → semana próxima
  start.setUTCDate(start.getUTCDate() + delta);
  return start;
};

const formatMeetingDateUtc = (date, dayName) => {
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  return `${dayName} ${dd}/${mm} · ${hh}:00 UTC`;
};

const useMockDb = !import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL.includes('placeholder');

const getRoomIdFromUrl = () => {
  const path = window.location.pathname;
  const match = path.match(/\/room\/([^/]+)/);
  return match ? match[1] : null;
};

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');

  const [currentRoomId, setCurrentRoomId] = useState(() => {
    const roomId = getRoomIdFromUrl();
    if (!roomId) {
      window.history.replaceState(null, '', '/room/grupo-a');
      return 'grupo-a';
    }
    return roomId;
  });
  
  // Tema (light | dark | system)
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('salesarena-theme') || 'system';
  });

  // Estado del Sidebar móvil
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Autenticación de Google (Simulada)
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
    return localStorage.getItem('salesarena-logged') === 'true';
  });

  // Estado del flujo de Login/Registro
  const [loginStep, setLoginStep] = useState(1); // 1: Google Email, 2: Profile setup Form, 3: Código de invitación
  const [loginEmail, setLoginEmail] = useState('');

  // Código de invitación de la sala (protección de acceso)
  const [roomInviteCode, setRoomInviteCode] = useState('');
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [urlInviteCode] = useState(() => new URLSearchParams(window.location.search).get('invite') || '');
  const [loginName, setLoginName] = useState('');
  const [loginCountry, setLoginCountry] = useState('Argentina');
  const [customLoginCountry, setCustomLoginCountry] = useState('');
  const [customNewMemberCountry, setCustomNewMemberCountry] = useState('');

  const [roomName, setRoomName] = useState(() => {
    const roomId = getRoomIdFromUrl() || 'grupo-a';
    return 'Sala ' + roomId.charAt(0).toUpperCase() + roomId.slice(1);
  });
  const [isRoomModalOpen, setIsRoomModalOpen] = useState(false);
  const [newRoomNameInput, setNewRoomNameInput] = useState('');
  const [renameRoomInput, setRenameRoomInput] = useState('');

  // Estado de Usuario Logueado (Simulado)
  const [currentUser, setCurrentUser] = useState(() => {
    const saved = localStorage.getItem('salesarena-user');
    return saved ? JSON.parse(saved) : null;
  });

  // Base de Datos en Estado (Vacia para producción)
  const [members, setMembers] = useState([]);

  // Disponibilidad: lista de { user, dayIdx, startHour, endHour }
  const [availabilities, setAvailabilities] = useState([]);

  // Plantillas Fijas: copia inicial
  const [templates, setTemplates] = useState([]);

  // Reuniones agendadas
  const [meetings, setMeetings] = useState([]);

  // Asistencia por reunión: {id, meetingId, memberEmail, memberName, status, reportedBy, reportedAt}
  // status: confirmado | asistio | no_show | cancelado_con_aviso
  const [attendances, setAttendances] = useState([]);

  // Propuestas de emparejamiento 1:1 (doble opt-in). Cada usuario ve SOLO la suya.
  // {id, weekStart, aEmail, aName, bEmail, bName, slot, statusA, statusB, status, respondBy, meetingId}
  const [proposals, setProposals] = useState([]);

  // true mientras se hace el fetch inicial a Supabase (members/proposals/meetings) de la sala.
  // Evita mostrar "Aún sin compañero asignado" como si fuera un hecho antes de que llegue el dato real.
  const [isRoomDataLoading, setIsRoomDataLoading] = useState(!useMockDb);

  // Tick por minuto: hace aparecer el prompt de asistencia cuando una sesión
  // termina con la página abierta, sin necesidad de recargar
  const [, setMinuteTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setMinuteTick(v => v + 1), 60000);
    return () => clearInterval(t);
  }, []);

  // Sistema de notificaciones premium (toast)
  const [toasts, setToasts] = useState([]); // [{id, msg, type}]
  const [confirmModal, setConfirmModal] = useState(null); // {msg, onConfirm, onCancel}
  const [promptModal, setPromptModal] = useState(null); // {msg, placeholder, onSubmit, onCancel}
  const [promptValue, setPromptValue] = useState('');

  // Estados de carga del Wizard
  const [wizardStep, setWizardStep] = useState(1); // 1: Bienvenida, 2: Opciones, 3: Grid
  const [wizardGrid, setWizardGrid] = useState([]); // [{dayIdx, hour}]
  const [saveAsTemplate, setSaveAsTemplate] = useState(true);
  const [wizardStatus, setWizardStatus] = useState(null); // {type, msg}

  // Nuevos miembros
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberCountry, setNewMemberCountry] = useState('Argentina');

  // Estados de simulación de Google Meet / Calendar API
  const [schedulingStatus, setSchedulingStatus] = useState(null); // null | 'loading' | 'authenticating' | 'creating' | 'success'
  const [scheduledDetails, setScheduledDetails] = useState(null); // { title, attendeesCount }

  // Resultados agregados calculados dinámicamente (heatmap y afinidad)
  const [heatmap, setHeatmap] = useState([]); // 7x24 grid
  const [affinity, setAffinity] = useState([]);

  // Celda del mapa de calor seleccionada (click o foco+Enter): reemplaza al
  // tooltip como única forma de ver quiénes están disponibles en ese bloque
  // (el tooltip solo no funciona en mobile ni con teclado/lector de pantalla).
  const [selectedHeatmapCell, setSelectedHeatmapCell] = useState(null); // { day, hour, count, names }

  // Variables para arrastre en la grilla visual
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [dragMode, setDragMode] = useState(true); // true = pintar, false = borrar

  // Rango horario visible en el editor (estilo Cal.com: horas útiles por defecto)
  const [showAllHours, setShowAllHours] = useState(false);

  // Guía de bienvenida (onboarding) para nuevos usuarios
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);

  // Mostrar la guía automáticamente en el primer ingreso de cada usuario
  useEffect(() => {
    if (isLoggedIn && currentUser && !localStorage.getItem(`salesarena-guide-${currentUser.email.toLowerCase()}`)) {
      setOnboardingStep(0);
      setShowOnboarding(true);
    }
  }, [isLoggedIn, currentUser?.email]);

  const closeOnboarding = () => {
    if (currentUser) {
      localStorage.setItem(`salesarena-guide-${currentUser.email.toLowerCase()}`, 'true');
    }
    setShowOnboarding(false);
  };

  const openOnboarding = () => {
    setOnboardingStep(0);
    setShowOnboarding(true);
  };

  // --- MOTOR DE COINCIDENCIAS (REACT PORT) ---
  useEffect(() => {
    calculateEngine();
  }, [members, availabilities]);

  // --- MANEJO DE TEMAS (DARK/LIGHT/SYSTEM) ---
  useEffect(() => {
    const root = document.documentElement;
    const applyTheme = (t) => {
      if (t === 'dark') {
        root.classList.add('dark');
      } else if (t === 'light') {
        root.classList.remove('dark');
      } else {
        // System preference
        const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (systemPrefersDark) {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
      }
    };

    applyTheme(theme);
    localStorage.setItem('salesarena-theme', theme);

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = (e) => {
        if (e.matches) root.classList.add('dark');
        else root.classList.remove('dark');
      };
      mediaQuery.addEventListener('change', listener);
      return () => mediaQuery.removeEventListener('change', listener);
    }
  }, [theme]);

  // Nota: la URL del navegador refleja siempre currentRoomId. Renombrar o crear
  // salas redirige explícitamente; no se reescribe la URL con el nombre
  // slugificado porque en salas con nombre por defecto ("Sala Grupo-a") ese
  // slug apunta a una sala distinta y rompía el refresh y los links copiados.

  // Código de invitación en modo demo local (sin Supabase): persistido por sala
  useEffect(() => {
    if (!useMockDb) return;
    const key = `salesarena-invite-${currentRoomId}`;
    let code = localStorage.getItem(key);
    if (!code) {
      code = generateInviteCode();
      localStorage.setItem(key, code);
    }
    setRoomInviteCode(code);
  }, [currentRoomId]);

  // Modo demo local: reuniones, asistencia y propuestas persisten en localStorage
  const mockHydratedRef = React.useRef(false);
  useEffect(() => {
    if (!useMockDb) return;
    try {
      const m = JSON.parse(localStorage.getItem(`salesarena-mock-meetings-${currentRoomId}`) || '[]');
      const a = JSON.parse(localStorage.getItem(`salesarena-mock-attendees-${currentRoomId}`) || '[]');
      const p = JSON.parse(localStorage.getItem(`salesarena-mock-proposals-${currentRoomId}`) || '[]');
      if (m.length) setMeetings(m);
      if (a.length) setAttendances(a);
      if (p.length) setProposals(p);
    } catch { /* datos corruptos: se ignoran */ }
    mockHydratedRef.current = true;
  }, [currentRoomId]);

  useEffect(() => {
    if (!useMockDb || !mockHydratedRef.current) return;
    localStorage.setItem(`salesarena-mock-meetings-${currentRoomId}`, JSON.stringify(meetings));
    localStorage.setItem(`salesarena-mock-attendees-${currentRoomId}`, JSON.stringify(attendances));
    localStorage.setItem(`salesarena-mock-proposals-${currentRoomId}`, JSON.stringify(proposals));
  }, [meetings, attendances, proposals, currentRoomId]);

  // Producción: cargar SOLO la propuesta propia de la semana actual
  useEffect(() => {
    if (useMockDb || !currentUser) return;
    const week = currentWeekStartISO();
    supabase.from('match_proposals')
      .select('*')
      .eq('room_id', currentRoomId)
      .eq('week_start', week)
      .or(`member_a_email.eq.${currentUser.email},member_b_email.eq.${currentUser.email}`)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) {
          setProposals(data.map(d => ({
            id: d.id,
            weekStart: d.week_start,
            aEmail: d.member_a_email,
            aName: d.member_a_name,
            bEmail: d.member_b_email,
            bName: d.member_b_name,
            slot: d.slot_start,
            statusA: d.status_a,
            statusB: d.status_b,
            status: d.status,
            respondBy: d.respond_by,
            meetingId: d.meeting_id
          })));
        }
      });
  }, [currentUser?.email, currentRoomId]);

  // Slots UTC (0..167) libres por miembro, a partir de su disponibilidad local
  const computeSlotSets = (mems, avails) => {
    const map = new Map();
    mems.forEach(member => {
      const offset = getOffsetMinutes(member.tz);
      const set = new Set();
      avails
        .filter(a => a.user.toLowerCase() === member.name.toLowerCase())
        .forEach(rule => {
          const startUtcMin = rule.dayIdx * 1440 + rule.startHour * 60 - offset;
          const endUtcMin = rule.dayIdx * 1440 + rule.endHour * 60 - offset;
          // Solapamiento (no contención total): con offsets no múltiplos de 60
          // (ej. India UTC+5:30) un bloque local de 1h nunca cae completamente
          // dentro de un slot UTC de 1h, y con "contención total" ese miembro
          // quedaría con 0 slots para siempre, sin ningún aviso.
          for (let s = 0; s < 168; s++) {
            if (s * 60 < endUtcMin && (s + 1) * 60 > startUtcMin) set.add(s);
          }
        });
      map.set(member.email, set);
    });
    return map;
  };

  // Slot UTC → etiqueta en la hora local de una zona ("Lunes 14:00")
  const slotToLocalLabel = (slot, tz) => {
    const localMin = slot * 60 + getOffsetMinutes(tz);
    const norm = ((localMin % 10080) + 10080) % 10080; // 10080 = minutos por semana
    const day = DIAS[Math.floor(norm / 1440)];
    const hour = Math.floor((norm % 1440) / 60);
    return `${day} ${String(hour).padStart(2, '0')}:00`;
  };

  // Plazo de respuesta en formato relativo y breve ("en 3 h", "en 2 días")
  const formatRespondByRelative = (iso) => {
    const diffMs = new Date(iso).getTime() - Date.now();
    if (diffMs <= 0) return 'está por vencer';
    const diffH = Math.round(diffMs / 3600000);
    if (diffH < 1) return 'en menos de 1 h';
    if (diffH < 24) return `en ${diffH} h`;
    const diffD = Math.round(diffH / 24);
    return `en ${diffD} día${diffD === 1 ? '' : 's'}`;
  };

  // Propuesta activa del usuario esta semana (y la última, para mensajes de estado)
  const myEmailLower = currentUser?.email?.toLowerCase();
  const myWeekProposals = !currentUser ? [] : proposals.filter(p =>
    p.weekStart === currentWeekStartISO() &&
    (p.aEmail.toLowerCase() === myEmailLower || p.bEmail.toLowerCase() === myEmailLower)
  );
  const myProposal = myWeekProposals.find(p => p.status === 'propuesto' || p.status === 'confirmado') || null;
  const myLastClosedProposal = myProposal ? null : myWeekProposals.sort((x, y) => (y.id || 0) - (x.id || 0))[0] || null;

  // Modo demo: correr el emparejador localmente (en producción lo hace la
  // Edge Function semanal weekly-matcher; el cliente solo lee su propuesta)
  useEffect(() => {
    if (!useMockDb || !currentUser || myProposal) return;
    const week = currentWeekStartISO();
    const takenOrRejected = new Set(
      proposals
        .filter(p => p.weekStart === week && (p.status === 'propuesto' || p.status === 'confirmado'))
        .flatMap(p => [p.aEmail.toLowerCase(), p.bEmail.toLowerCase()])
    );
    // Solo se excluyen parejas RECHAZADAS (se respeta el "no" explícito).
    const rejectedPairs = new Set(
      proposals
        .filter(p => p.weekStart === week && p.status === 'rechazado')
        .map(p => [p.aEmail.toLowerCase(), p.bEmail.toLowerCase()].sort().join('|'))
    );
    // Duplas EXPIRADAS (sin respuesta): se evitan si hay otro compañero
    // disponible; si no, se vuelven a ofrecer.
    const expiredPairs = new Set(
      proposals
        .filter(p => p.weekStart === week && p.status === 'expirado')
        .map(p => [p.aEmail.toLowerCase(), p.bEmail.toLowerCase()].sort().join('|'))
    );
    const pool = members.filter(m => m.active && !takenOrRejected.has(m.email.toLowerCase()));
    if (pool.length < 2) return;

    const slotSets = computeSlotSets(pool, availabilities);
    const scores = new Map(pool.map(m => [m.email, getReliability(m.email)]));
    const { pairs } = buildWeeklyPairs(
      pool, slotSets, scores, rejectedPairs, new Map(), new Date(), expiredPairs, MIN_LEAD_MS
    );
    if (pairs.length === 0) return;

    const baseId = Date.now();
    setProposals(prev => [...prev, ...pairs.map((p, i) => ({
      id: baseId + i,
      weekStart: week,
      aEmail: p.a.email,
      aName: p.a.name,
      bEmail: p.b.email,
      bName: p.b.name,
      slot: p.slot,
      statusA: 'pendiente',
      statusB: 'pendiente',
      status: 'propuesto',
      // Plazo = 24hs antes de la reunión (no 24h desde ahora)
      respondBy: new Date(getNextMatchDateUtc({ startSlot: p.slot }).getTime() - MIN_LEAD_MS).toISOString(),
      meetingId: null
    }))]);
  }, [members, availabilities, currentUser, proposals]);

  // ¿La sesión ya terminó? (inicio + duración)
  const meetingHasEnded = (meeting) => {
    if (!meeting.startsAt) return false; // reuniones viejas sin timestamp: sin prompt
    return Date.now() > new Date(meeting.startsAt).getTime() + (meeting.duration || 60) * 60000;
  };

  const meetingHasStarted = (meeting) => {
    if (!meeting.startsAt) return true; // sin timestamp no se permite cancelar
    return Date.now() >= new Date(meeting.startsAt).getTime();
  };

  // Score de confiabilidad (últimos 60 días), ponderado por puntualidad:
  //   asistió a tiempo = 1 · asistió tarde = 0.5 · no-show = 0 ·
  //   cancelado tarde = 0 · cancelado con aviso / sin reportar = no computa.
  // null = sin historial suficiente. Debe coincidir con la Edge Function.
  const scoreValue = (status, punctuality) => {
    if (status === 'asistio') return punctuality === 'tarde' ? 0.5 : 1;
    if (status === 'no_show' || status === 'cancelado_tarde') return 0;
    return null;
  };
  const getReliability = (email) => {
    const cutoff = Date.now() - 60 * 24 * 3600e3;
    const vals = attendances.filter(a => {
      if (a.memberEmail.toLowerCase() !== email.toLowerCase()) return false;
      const meeting = meetings.find(m => m.id === a.meetingId);
      const when = meeting?.startsAt ? Date.parse(meeting.startsAt) : (a.reportedAt ? Date.parse(a.reportedAt) : NaN);
      return !Number.isNaN(when) && when >= cutoff;
    }).map(a => scoreValue(a.status, a.punctuality)).filter(v => v !== null);
    if (vals.length === 0) return null;
    return Math.round((vals.reduce((s, x) => s + x, 0) / vals.length) * 100);
  };

  // Faltas del mes calendario (no_show + cancelado_tarde) y bloqueo (3+).
  // Refleja en la UI lo que la Edge Function aplica en el emparejamiento.
  const getMonthlyFaltas = (email) => {
    const now = new Date();
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    return attendances.filter(a => {
      if (a.memberEmail.toLowerCase() !== email.toLowerCase()) return false;
      if (a.status !== 'no_show' && a.status !== 'cancelado_tarde') return false;
      const meeting = meetings.find(m => m.id === a.meetingId);
      const when = meeting?.startsAt ? Date.parse(meeting.startsAt) : (a.reportedAt ? Date.parse(a.reportedAt) : NaN);
      return !Number.isNaN(when) && when >= monthStart;
    }).length;
  };
  const isBlocked = (email) => getMonthlyFaltas(email) >= 3;

  // Reportes pendientes del usuario actual: por cada sesión terminada en la que
  // participó, cada compañero que sigue en 'confirmado' (nadie reportó aún)
  const pendingReports = !currentUser ? [] : meetings
    .filter(m => m.id != null && meetingHasEnded(m))
    .flatMap(m => {
      const rows = attendances.filter(a => a.meetingId === m.id);
      const myRow = rows.find(a => a.memberEmail.toLowerCase() === currentUser.email.toLowerCase());
      if (!myRow || myRow.status === 'cancelado_con_aviso') return [];
      return rows
        .filter(a =>
          a.memberEmail.toLowerCase() !== currentUser.email.toLowerCase() &&
          a.status === 'confirmado'
        )
        .map(a => ({ meeting: m, attendance: a }));
    });

  // ¿El código provisto coincide con el de la sala?
  const hasValidInvite = (code) =>
    !!roomInviteCode && (code || '').trim().toUpperCase() === roomInviteCode.toUpperCase();

  // --- REAL-TIME DATA SYNCHRONIZATION WITH SUPABASE ---
  useEffect(() => {
    if (useMockDb) return;

    const loadSupabaseData = async () => {
      setIsRoomDataLoading(true);
      // 1. Fetch Room (or create it if it doesn't exist)
      let { data: roomData, error: roomError } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', currentRoomId)
        .maybeSingle();

      if (roomError || !roomData) {
        const defaultName = `Sala ${currentRoomId.charAt(0).toUpperCase() + currentRoomId.slice(1)}`;
        const newCode = generateInviteCode();
        await supabase.from('rooms').insert({ id: currentRoomId, name: defaultName });
        setRoomName(defaultName);
        setRenameRoomInput(defaultName);
        // Asignar código de invitación (si la columna aún no existe, se ignora
        // el error y la sala queda sin protección hasta correr la migración)
        const { error: codeError } = await supabase.from('rooms')
          .update({ invite_code: newCode })
          .eq('id', currentRoomId);
        if (!codeError) setRoomInviteCode(newCode);
      } else {
        setRoomName(roomData.name);
        setRenameRoomInput(roomData.name);
        if (roomData.invite_code) {
          setRoomInviteCode(roomData.invite_code);
        } else {
          // Sala creada antes de la migración: generar código ahora
          const newCode = generateInviteCode();
          const { error: codeError } = await supabase.from('rooms')
            .update({ invite_code: newCode })
            .eq('id', currentRoomId);
          if (!codeError) setRoomInviteCode(newCode);
        }
      }

      // 2. Fetch Members
      const { data: memData } = await supabase
        .from('members')
        .select('*')
        .eq('room_id', currentRoomId);
      if (memData) {
        setMembers(memData.map(d => ({
          name: d.name,
          email: d.email,
          country: d.country,
          tz: d.timezone,
          active: d.active
        })));
      }

      // 3. Fetch Availabilities
      const { data: availData } = await supabase
        .from('availabilities')
        .select('*')
        .eq('room_id', currentRoomId);
      if (availData) {
        setAvailabilities(availData.map(d => ({
          user: d.user,
          dayIdx: d.day_idx,
          startHour: d.start_hour,
          endHour: d.end_hour
        })));
      }

      // 4. Fetch Meetings
      const { data: meetData } = await supabase
        .from('meetings')
        .select('*')
        .eq('room_id', currentRoomId);
      if (meetData) {
        setMeetings(meetData.map(d => ({
          id: d.id,
          title: d.title,
          dateUtc: d.date_utc,
          duration: d.duration || 60,
          participants: d.participants,
          meetLink: d.meet_link,
          startsAt: d.starts_at,
          status: 'Creado (Meet)'
        })));
      }

      // 5. Fetch Asistencia (tabla meeting_attendees)
      const { data: attData, error: attError } = await supabase
        .from('meeting_attendees')
        .select('*')
        .eq('room_id', currentRoomId);
      if (!attError && attData) {
        setAttendances(attData.map(d => ({
          id: d.id,
          meetingId: d.meeting_id,
          memberEmail: d.member_email,
          memberName: d.member_name,
          status: d.status,
          punctuality: d.punctuality,
          cancelReason: d.cancel_reason,
          reportedBy: d.reported_by,
          reportedAt: d.reported_at
        })));
      }

      setIsRoomDataLoading(false);
    };

    loadSupabaseData();
  }, [currentRoomId]);

  // --- REAL GOOGLE OAUTH CALLBACK LISTENERS ---
  useEffect(() => {
    if (useMockDb) return;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && session.user) {
        handleOAuthSession(session);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && session.user) {
        handleOAuthSession(session);
      } else if (!session) {
        setIsLoggedIn(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [currentRoomId]);

  const handleOAuthSession = async (session) => {
    const email = session.user.email;
    setLoginEmail(email);

    try {
      const { data: existing } = await supabase
        .from('members')
        .select('*')
        .eq('room_id', currentRoomId)
        .eq('email', email)
        .maybeSingle();

      if (existing) {
        const userObj = {
          name: existing.name,
          email: existing.email,
          country: existing.country,
          tz: existing.timezone,
          active: existing.active
        };
        setCurrentUser(userObj);
        setIsLoggedIn(true);
        localStorage.setItem('salesarena-logged', 'true');
        localStorage.setItem('salesarena-user', JSON.stringify(userObj));
      } else {
        // Usuario nuevo: validar acceso a la sala por código de invitación.
        // Se consulta el código directo de la DB para evitar closures viejos.
        const { count } = await supabase
          .from('members')
          .select('*', { count: 'exact', head: true })
          .eq('room_id', currentRoomId);
        const { data: roomRow } = await supabase
          .from('rooms')
          .select('invite_code')
          .eq('id', currentRoomId)
          .maybeSingle();
        const realCode = roomRow?.invite_code || '';
        const isFounder = !count; // sala vacía: el primer miembro entra sin código
        const inviteOk = (urlInviteCode || '').trim().toUpperCase() === realCode.toUpperCase();

        if (isFounder || !realCode || inviteOk) {
          setLoginStep(2);
        } else {
          setLoginStep(3);
        }
        setIsLoggedIn(false);
      }
    } catch (err) {
      console.error('Error verificando usuario OAuth:', err);
      setLoginStep(2); // el guard de handleProfileRegisterSubmit re-valida el código
      setIsLoggedIn(false);
    }
  };

  // Calcula heatmap y afinidad (agregados). El emparejamiento ya NO se hace
  // acá: lo resuelve el job semanal 1:1 (weekly-matcher) vía match_proposals.
  const calculateEngine = () => {
    const activeMembers = members.filter(m => m.active);
    if (activeMembers.length < 2) {
      setHeatmap([]);
      setAffinity([]);
      return;
    }

    const nSlots = 7 * 24; // 168 slots de 1 hora
    const presence = Array.from({ length: nSlots }, () => []);
    const freeSlotsCount = activeMembers.map(() => 0);

    // Mapear intervalos locales a UTC
    activeMembers.forEach((member, memberIdx) => {
      const offset = getOffsetMinutes(member.tz);
      const userRules = availabilities.filter(a => a.user.toLowerCase() === member.name.toLowerCase());

      userRules.forEach(rule => {
        // Traducir inicio y fin local a minutos desde el lunes 00:00 local
        const startLocalMin = rule.dayIdx * 24 * 60 + rule.startHour * 60;
        const endLocalMin = rule.dayIdx * 24 * 60 + rule.endHour * 60;

        // Traducir a UTC minutes
        const startUtcMin = startLocalMin - offset;
        const endUtcMin = endLocalMin - offset;

        // Rellenar slots de 1 hora
        for (let s = 0; s < nSlots; s++) {
          const slotStartMin = s * 60;
          const slotEndMin = (s + 1) * 60;

          // Solapamiento (no contención total): ver computeSlotSets más arriba
          // para el motivo — evita que offsets no múltiplos de 60 (India, etc.)
          // dejen a un miembro con 0 slots libres sin ningún aviso.
          if (slotStartMin < endUtcMin && slotEndMin > startUtcMin) {
            presence[s].push(memberIdx);
            freeSlotsCount[memberIdx]++;
          }
        }
      });
    });

    // 1. Calcular Heatmap (7 días x 24 horas)
    const grid = [];
    const viewOffset = getOffsetMinutes(currentUser?.tz || 'UTC'); // Ver en hora local del usuario activo

    for (let d = 0; d < 7; d++) {
      const hoursRow = [];
      for (let h = 0; h < 24; h++) {
        // Convertir día/hora local de Tomás a UTC
        const localMin = d * 24 * 60 + h * 60;
        const utcMin = localMin - viewOffset;
        const slotIdx = Math.floor((utcMin / 60) + nSlots) % nSlots;

        // Personas libres en este slot
        const freeCount = presence[slotIdx] ? presence[slotIdx].length : 0;
        const freeNames = presence[slotIdx] ? presence[slotIdx].map(idx => activeMembers[idx].name).join(', ') : '';

        hoursRow.push({ count: freeCount, names: freeNames });
      }
      grid.push(hoursRow);
    }
    setHeatmap(grid);

    // 3. Matriz de Afinidad (Solapamientos relativos)
    const n = activeMembers.length;
    const affinityMatrix = Array.from({ length: n }, () => Array(n).fill(0));

    // Contar solapamientos
    for (let s = 0; s < nSlots; s++) {
      const here = presence[s];
      for (let a = 0; a < here.length; a++) {
        for (let b = a + 1; b < here.length; b++) {
          affinityMatrix[here[a]][here[b]]++;
          affinityMatrix[here[b]][here[a]]++;
        }
      }
    }

    // Convertir a porcentajes
    const calculatedAffinity = activeMembers.map((member, i) => {
      const partnerStats = activeMembers.map((partner, j) => {
        if (i === j) return { name: partner.name, pct: null };
        const denom = Math.min(freeSlotsCount[i], freeSlotsCount[j]);
        const pct = denom ? Math.round((affinityMatrix[i][j] / denom) * 100) : 0;
        return { name: partner.name, pct };
      });

      return {
        name: member.name,
        stats: partnerStats
      };
    });
    setAffinity(calculatedAffinity);
  };

  // --- ACCIONES DEL WIZARD ---
  const handleWizardParticipation = (participate) => {
    setWizardStatus({ type: 'loading', msg: 'Guardando tu estado...' });
    setTimeout(() => {
      // Modificar en la lista de miembros
      const updatedMembers = members.map(m =>
        m.email.toLowerCase() === currentUser.email.toLowerCase() ? { ...m, active: participate } : m
      );
      setMembers(updatedMembers);

      if (participate) {
        // Cargar horarios del usuario activo en la grilla visual
        const userRules = availabilities.filter(a => a.user.toLowerCase() === currentUser.name.toLowerCase());
        const gridSlots = [];
        userRules.forEach(rule => {
          for (let h = rule.startHour; h < rule.endHour; h++) {
            gridSlots.push({ dayIdx: rule.dayIdx, hour: h });
          }
        });
        setWizardGrid(gridSlots);
        setWizardStep(2);
      } else {
        // Borrar horarios semanales
        const cleanAvail = availabilities.filter(a => a.user.toLowerCase() !== currentUser.name.toLowerCase());
        setAvailabilities(cleanAvail);
        setWizardStatus({ type: 'success', msg: '¡Registrado! Has sido excluido por esta semana.' });
        setTimeout(() => {
          setActiveTab('dashboard');
          setWizardStep(1);
        }, 2000);
      }
    }, 1000);
  };

  // Dispara el weekly-matcher al instante cuando hay un cambio de disponibilidad
  const triggerWeeklyMatcher = async () => {
    try {
      const url = import.meta.env.VITE_SUPABASE_URL;
      if (!url || url.includes('placeholder')) {
        console.log('Mock DB: skipping weekly-matcher trigger');
        return;
      }

      const response = await fetch(`${url}/functions/v1/weekly-matcher`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Weekly-matcher triggered:', data);
        if (data.created && Object.values(data.created).some(v => v > 0)) {
          showNotification('✨ ¡Se generaron nuevas propuestas de emparejamiento!');
        }
      } else {
        console.error('Weekly-matcher error:', response.statusText);
      }
    } catch (err) {
      console.error('Failed to trigger weekly-matcher:', err);
    }
  };

  const handleUseTemplate = () => {
    setWizardStatus({ type: 'loading', msg: 'Aplicando horarios base de tu plantilla...' });
    setTimeout(() => {
      // Reemplazar horarios en la disponibilidad semanal
      const userTemplateRules = templates.filter(t => t.user.toLowerCase() === currentUser.name.toLowerCase());
      const cleanAvail = availabilities.filter(a => a.user.toLowerCase() !== currentUser.name.toLowerCase());
      setAvailabilities([...cleanAvail, ...userTemplateRules]);

      setWizardStatus({ type: 'success', msg: '¡Horario base cargado con éxito para esta semana!' });

      // Disparar weekly-matcher al instante para generar propuestas
      triggerWeeklyMatcher();

      setTimeout(() => {
        setActiveTab('dashboard');
        setWizardStep(1);
      }, 2000);
    }, 1000);
  };

  const saveWizardGrid = async () => {
    setWizardStatus({ type: 'loading', msg: 'Procesando horarios de la grilla...' });
    
    // 1. Agrupar los slots por día
    const slotsByDay = {};
    wizardGrid.forEach(slot => {
      if (!slotsByDay[slot.dayIdx]) slotsByDay[slot.dayIdx] = [];
      slotsByDay[slot.dayIdx].push(slot.hour);
    });

    // 2. Encontrar bloques contiguos
    const newRules = [];
    for (let d = 0; d < 7; d++) {
      const hours = slotsByDay[d] || [];
      if (hours.length === 0) continue;
      
      hours.sort((a, b) => a - b);
      let start = hours[0];
      let prev = hours[0];

      for (let k = 1; k <= hours.length; k++) {
        const current = hours[k];
        if (current === undefined || current !== prev + 1) {
          newRules.push({
            user: currentUser.name,
            dayIdx: d,
            startHour: start,
            endHour: prev + 1
          });
          if (current !== undefined) start = current;
        }
        prev = current;
      }
    }

    if (!useMockDb) {
      // Borrar antiguos bloques en Supabase
      const { error: delError } = await supabase.from('availabilities')
        .delete()
        .eq('room_id', currentRoomId)
        .eq('user', currentUser.name);

      if (delError) {
        setWizardStatus({ type: 'error', msg: 'Error al actualizar horarios en Supabase.' });
        return;
      }

      // Insertar nuevos bloques
      if (newRules.length > 0) {
        const toInsert = newRules.map(r => ({
          room_id: currentRoomId,
          user: r.user,
          day_idx: r.dayIdx,
          start_hour: r.startHour,
          end_hour: r.endHour
        }));
        const { error: insError } = await supabase.from('availabilities').insert(toInsert);
        if (insError) {
          setWizardStatus({ type: 'error', msg: 'Error al insertar horarios en Supabase.' });
          return;
        }
      }
    }

    // 3. Escribir a disponibilidad local
    const cleanAvail = availabilities.filter(a => a.user.toLowerCase() !== currentUser.name.toLowerCase());
    setAvailabilities([...cleanAvail, ...newRules]);

    // 4. Si se guarda como plantilla
    if (saveAsTemplate) {
      const cleanTemplate = templates.filter(t => t.user.toLowerCase() !== currentUser.name.toLowerCase());
      setTemplates([...cleanTemplate, ...newRules]);
    }

    setWizardStatus({ type: 'success', msg: '¡Disponibilidad guardada correctamente!' });

    // 5. Disparar weekly-matcher al instante para generar propuestas
    triggerWeeklyMatcher();

    setTimeout(() => {
      setActiveTab('dashboard');
      setWizardStep(1);
    }, 2000);
  };

  // --- SIMULACIÓN DE AUTENTICACIÓN GOOGLE ---
  const handleGoogleLoginSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();

    if (!useMockDb) {
      // Iniciar sesión con Google OAuth usando Supabase (no requiere ingresar email en nuestro input)
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          scopes: 'https://www.googleapis.com/auth/calendar.events',
          redirectTo: window.location.origin + `/room/${currentRoomId}`
        }
      });
      if (error) {
        showNotification('Error al iniciar sesión con Google: ' + error.message);
      }
      return;
    }

    // Lógica Mock (si se usa mock local)
    let emailToUse = loginEmail.trim();
    if (!emailToUse) {
      emailToUse = 'invitado@gmail.com'; // Default mock fallback
      setLoginEmail(emailToUse);
    }

    const existing = members.find(m => m.email.toLowerCase() === emailToUse.toLowerCase());
    
    if (existing) {
      setCurrentUser(existing);
      setIsLoggedIn(true);
      localStorage.setItem('salesarena-logged', 'true');
      localStorage.setItem('salesarena-user', JSON.stringify(existing));
      showNotification(`¡Bienvenido de vuelta, ${existing.name}!`);
    } else {
      // Usuario nuevo: la sala vacía no exige código (fundador);
      // con miembros existentes se requiere invitación válida
      const isFounder = members.length === 0;
      if (isFounder || !roomInviteCode || hasValidInvite(urlInviteCode)) {
        setLoginStep(2);
      } else {
        setLoginStep(3);
      }
    }
  };

  const handleInviteCodeSubmit = (e) => {
    e.preventDefault();
    if (hasValidInvite(inviteCodeInput)) {
      setInviteError('');
      setLoginStep(2);
    } else {
      setInviteError('Código incorrecto. Pídele el código vigente a quien administra la sala.');
    }
  };

  const handleProfileRegisterSubmit = async (e) => {
    e.preventDefault();
    if (!loginName || !loginCountry) return;

    // Guard de acceso: sin código válido no se puede registrar en una sala
    // protegida que ya tiene miembros (defensa en profundidad del paso 3)
    const inviteOk = members.length === 0 || !roomInviteCode ||
      hasValidInvite(urlInviteCode) || hasValidInvite(inviteCodeInput);
    if (!inviteOk) {
      setLoginStep(3);
      return;
    }

    const finalCountry = loginCountry === 'Otro' ? customLoginCountry.trim() : loginCountry;
    const finalTz = resolveTimezone(finalCountry);
    const newUser = {
      name: loginName.trim(),
      email: loginEmail.trim().toLowerCase(),
      country: finalCountry,
      tz: finalTz,
      active: true
    };

    if (!useMockDb) {
      const { error } = await supabase.from('members').insert({
        room_id: currentRoomId,
        email: newUser.email,
        name: newUser.name,
        country: newUser.country,
        timezone: newUser.tz,
        active: newUser.active
      });
      if (error) {
        showNotification('Error al registrar perfil en Supabase: ' + error.message);
        return;
      }
    }

    setMembers(prev => {
      if (prev.some(m => m.email.toLowerCase() === newUser.email.toLowerCase())) {
        return prev.map(m => m.email.toLowerCase() === newUser.email.toLowerCase() ? newUser : m);
      }
      return [...prev, newUser];
    });

    setCurrentUser(newUser);
    setIsLoggedIn(true);
    localStorage.setItem('salesarena-logged', 'true');
    localStorage.setItem('salesarena-user', JSON.stringify(newUser));

    showNotification(`¡Registro completo! Bienvenido a Sales-Arena Matcher, ${newUser.name}.`);
  };

  const handleLogout = async () => {
    if (!useMockDb) {
      await supabase.auth.signOut();
    }
    setIsLoggedIn(false);
    setLoginEmail('');
    setLoginName('');
    setLoginStep(1);
    localStorage.removeItem('salesarena-logged');
    localStorage.removeItem('salesarena-user');
  };

  // --- GESTIÓN DE SALAS (ROOMS) ---
  const handleRenameRoom = async (e) => {
    e.preventDefault();
    if (!renameRoomInput.trim()) return;

    const nextName = renameRoomInput.trim();
    const newSlug = nextName.toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // remove accents
      .replace(/[^a-z0-9\s-]/g, '') // remove special chars
      .trim()
      .replace(/\s+/g, '-');

    if (!newSlug) {
      showNotification('Nombre de sala inválido.');
      return;
    }

    setRoomName(nextName);

    if (!useMockDb) {
      if (newSlug !== currentRoomId) {
        // 1. Crear o actualizar la nueva sala con el slug correcto
        await supabase.from('rooms').upsert({ id: newSlug, name: nextName });
        // Conservar el código de invitación en el nuevo slug
        if (roomInviteCode) {
          await supabase.from('rooms').update({ invite_code: roomInviteCode }).eq('id', newSlug);
        }
        // 2. Migrar los registros vinculados a la nueva sala
        await supabase.from('members').update({ room_id: newSlug }).eq('room_id', currentRoomId);
        await supabase.from('availabilities').update({ room_id: newSlug }).eq('room_id', currentRoomId);
        await supabase.from('templates').update({ room_id: newSlug }).eq('room_id', currentRoomId);
        await supabase.from('meetings').update({ room_id: newSlug }).eq('room_id', currentRoomId);
        // 3. Eliminar la sala antigua si no es la sala por defecto
        if (currentRoomId !== 'grupo-a') {
          await supabase.from('rooms').delete().eq('id', currentRoomId);
        }
      } else {
        await supabase.from('rooms').update({ name: nextName }).eq('id', currentRoomId);
      }
    }

    if (newSlug !== currentRoomId) {
      if (useMockDb && roomInviteCode) {
        localStorage.setItem(`salesarena-invite-${newSlug}`, roomInviteCode);
      }
      showNotification(`¡Sala renombrada a "${nextName}"! Actualizando enlace a /room/${newSlug}...`);
      setIsRoomModalOpen(false);
      window.location.href = `/room/${newSlug}${roomInviteCode ? `?invite=${roomInviteCode}` : ''}`;
    } else {
      showNotification(`Sala renombrada con éxito a "${nextName}"`);
      setIsRoomModalOpen(false);
    }
  };

  const handleCreateRoom = async (e) => {
    e.preventDefault();
    if (!newRoomNameInput.trim()) return;

    const rawName = newRoomNameInput.trim();
    const slug = rawName.toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // remove accents
      .replace(/[^a-z0-9\s-]/g, '') // remove special chars
      .trim()
      .replace(/\s+/g, '-'); // replace spaces with hyphens

    if (!slug) {
      showNotification('Nombre de sala inválido.');
      return;
    }

    const newCode = generateInviteCode();

    if (!useMockDb) {
      // 1. Create the room in Supabase
      const { error } = await supabase.from('rooms').insert({ id: slug, name: rawName });
      if (error && error.code !== '23505') { // 23505 is duplicate key error, which means room already exists
        showNotification('Error al crear sala en base de datos: ' + error.message);
        return;
      }
      // 2. Asignar código de invitación (se ignora si la columna aún no existe)
      if (!error) {
        await supabase.from('rooms').update({ invite_code: newCode }).eq('id', slug);
      }
    } else {
      localStorage.setItem(`salesarena-invite-${slug}`, newCode);
    }

    showNotification(`¡Sala "${rawName}" creada con éxito! Redirigiendo...`);
    setIsRoomModalOpen(false);
    setNewRoomNameInput('');

    // Redirect browser to the new room URL (con invitación para el creador)
    window.location.href = `/room/${slug}?invite=${newCode}`;
  };

  const handleDeleteRoom = async () => {
    if (currentRoomId === 'grupo-a') {
      showNotification('La sala por defecto no se puede eliminar.', 'error');
      return;
    }

    const confirmed = await showConfirm(`¿Eliminar la sala "${roomName}"? Se borrarán todos los miembros, disponibilidades y reuniones guardadas en ella. Esta acción no se puede deshacer.`);
    if (!confirmed) return;

    if (!useMockDb) {
      const { error } = await supabase.from('rooms').delete().eq('id', currentRoomId);
      if (error) {
        showNotification('Error al eliminar sala: ' + error.message);
        return;
      }
    }

    showNotification(`Sala "${roomName}" eliminada correctamente.`);
    setIsRoomModalOpen(false);
    // Redirect to default room
    window.location.href = `/room/grupo-a`;
  };

  // El enlace de invitación apunta SIEMPRE al id real de la sala (no al nombre
  // slugificado, que puede diferir en salas con nombre por defecto)
  const buildInviteUrl = () => {
    return `${window.location.origin}/room/${currentRoomId}${roomInviteCode ? `?invite=${roomInviteCode}` : ''}`;
  };

  const handleRegenerateInviteCode = async () => {
    const newCode = generateInviteCode();
    if (!useMockDb) {
      const { error } = await supabase.from('rooms')
        .update({ invite_code: newCode })
        .eq('id', currentRoomId);
      if (error) {
        showNotification('No se pudo regenerar el código: ' + error.message, 'error');
        return;
      }
    } else {
      localStorage.setItem(`salesarena-invite-${currentRoomId}`, newCode);
    }
    setRoomInviteCode(newCode);
    showNotification('Código regenerado. Los enlaces de invitación anteriores dejaron de funcionar.', 'success');
  };

  const handleCopyRoomInvite = () => {
    const inviteUrl = buildInviteUrl();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(inviteUrl).then(() => {
        showNotification(`Enlace de la sala "${roomName}" copiado:\n\n${inviteUrl}\n\nIncluye el código de invitación: quien entre con este link va directo al registro de esta sala.`, 'success');
      }).catch(() => {
        prompt('Copia el enlace para compartir tu sala:', inviteUrl);
      });
    } else {
      prompt('Copia el enlace para compartir tu sala:', inviteUrl);
    }
  };

  // --- ADMINISTRAR MIEMBROS ---
  const handleAddMember = async (e) => {
    e.preventDefault();
    if (!newMemberName || !newMemberEmail) return;

    const finalCountry = newMemberCountry === 'Otro' ? customNewMemberCountry.trim() : newMemberCountry;
    const finalTz = resolveTimezone(finalCountry);
    const newMember = {
      name: newMemberName,
      email: newMemberEmail,
      country: finalCountry,
      tz: finalTz,
      active: true
    };

    if (!useMockDb) {
      const { error } = await supabase.from('members').insert({
        room_id: currentRoomId,
        email: newMember.email,
        name: newMember.name,
        country: newMember.country,
        timezone: newMember.tz,
        active: newMember.active
      });
      if (error) {
        showNotification('Error al agregar en Supabase: ' + error.message);
        return;
      }
    }

    setMembers([...members, newMember]);
    setNewMemberName('');
    setNewMemberEmail('');
    showNotification('Miembro agregado correctamente.');
  };

  const deleteMember = async (emailToDelete) => {
    if (emailToDelete.toLowerCase() === currentUser.email.toLowerCase()) {
      alert("No puedes eliminar al usuario logueado actualmente.");
      return;
    }
    
    if (!useMockDb) {
      const { error } = await supabase.from('members')
        .delete()
        .eq('room_id', currentRoomId)
        .eq('email', emailToDelete);
      if (error) {
        showNotification('Error al eliminar de Supabase: ' + error.message);
        return;
      }
    }

    const memberObj = members.find(m => m.email.toLowerCase() === emailToDelete.toLowerCase());
    setMembers(prev => prev.filter(m => m.email.toLowerCase() !== emailToDelete.toLowerCase()));
    if (memberObj) {
      setAvailabilities(prev => prev.filter(a => a.user.toLowerCase() !== memberObj.name.toLowerCase()));
      setTemplates(prev => prev.filter(t => t.user.toLowerCase() !== memberObj.name.toLowerCase()));
    }
  };

  // --- CAMBIAR ESTADO SEMANAL DEL USUARIO LOGUEADO ---
  const toggleCurrentUserActive = async () => {
    const nextActiveState = !currentUser.active;
    
    // Actualizar estado del usuario conectado
    setCurrentUser(prev => ({ ...prev, active: nextActiveState }));

    // Actualizar estado en la base de datos de miembros
    setMembers(prev => prev.map(m => 
      m.email.toLowerCase() === currentUser.email.toLowerCase() ? { ...m, active: nextActiveState } : m
    ));

    if (!useMockDb) {
      const { error } = await supabase.from('members')
        .update({ active: nextActiveState })
        .eq('room_id', currentRoomId)
        .eq('email', currentUser.email);
      if (error) {
        showNotification('Error al actualizar estado en Supabase');
        return;
      }
    }

    if (!nextActiveState) {
      // Limpiar horarios semanales (evitar falsos positivos de reuniones vacías)
      if (!useMockDb) {
        await supabase.from('availabilities')
          .delete()
          .eq('room_id', currentRoomId)
          .eq('user', currentUser.name);
      }
      setAvailabilities(prev => prev.filter(a => a.user.toLowerCase() !== currentUser.name.toLowerCase()));
      showNotification('Has desactivado tu participación. No serás coordinado para los role-plays de esta semana.');
    } else {
      // Cargar disponibilidad desde la plantilla habitual
      const userTemplateRules = templates.filter(t => t.user.toLowerCase() === currentUser.name.toLowerCase());
      
      if (!useMockDb && userTemplateRules.length > 0) {
        const toInsert = userTemplateRules.map(r => ({
          room_id: currentRoomId,
          user: r.user,
          day_idx: r.dayIdx,
          start_hour: r.startHour,
          end_hour: r.endHour
        }));
        await supabase.from('availabilities').insert(toInsert);
      }
      
      setAvailabilities(prev => [...prev, ...userTemplateRules]);
      showNotification('¡Participación activada! Hemos cargado tus horarios semanales desde tu plantilla base.');

      // Disparar weekly-matcher al instante para generar propuestas
      triggerWeeklyMatcher();
    }
  };

  // --- AGENDAR REUNIÓN CON APIS REALES DE GOOGLE CALENDAR / MEET ---
  // Crea la reunión real (Meet + registro + compromiso de asistencia) para una
  // propuesta 1:1 confirmada por ambas partes
  const createProposalMeeting = async (proposal) => {
    const participantsStr = `${proposal.aName}, ${proposal.bName}`;
    const title = `Roleplay — ${proposal.aName.split(' ')[0]} · ${proposal.bName.split(' ')[0]}`;

    setSchedulingStatus('loading');
    setScheduledDetails({
      title,
      attendeesCount: 2
    });

    // Fecha/hora UTC real de la próxima ocurrencia del slot propuesto
    const startDate = getNextMatchDateUtc({ startSlot: proposal.slot });
    const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

    await sleep(1000);
    setSchedulingStatus('authenticating');
    await sleep(1200);
    setSchedulingStatus('creating');

    let meetUrl;

    if (useMockDb) {
      // Solo para demo local sin Supabase: enlace simulado
      meetUrl = `https://meet.google.com/${Math.random().toString(36).substring(2, 5)}-${Math.random().toString(36).substring(2, 6)}-${Math.random().toString(36).substring(2, 5)}`;
    } else {
      // Producción: el enlace DEBE venir de Google Calendar. Si algo falla,
      // se informa el error y no se guarda ninguna reunión falsa.
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const providerToken = sessionData.session?.provider_token; // Token de Google OAuth

        if (!providerToken) {
          throw new Error('Tu sesión de Google expiró o no otorgó permisos de Calendar. Cierra sesión y vuelve a ingresar con Google.');
        }

        const eventPayload = {
          summary: `Sales-Arena Roleplay: ${participantsStr}`,
          description: 'Videollamada de entrenamiento agendada mediante Sales-Arena Matcher.',
          start: { dateTime: startDate.toISOString(), timeZone: 'UTC' },
          end: { dateTime: endDate.toISOString(), timeZone: 'UTC' },
          attendees: [{ email: proposal.aEmail }, { email: proposal.bEmail }],
          conferenceData: {
            createRequest: {
              requestId: Math.random().toString(36).substring(2),
              conferenceSolutionKey: { type: 'hangoutsMeet' }
            }
          }
        };

        // Petición oficial a la REST API de Google Calendar
        const response = await fetch(
          'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${providerToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(eventPayload)
          }
        );

        if (!response.ok) {
          const errBody = await response.json().catch(() => null);
          throw new Error(errBody?.error?.message || `Google Calendar respondió con error ${response.status}.`);
        }

        const eventData = await response.json();
        if (!eventData.hangoutLink) {
          throw new Error('Google Calendar creó el evento pero no devolvió un enlace de Meet.');
        }
        meetUrl = eventData.hangoutLink;
      } catch (err) {
        console.error('Error al agendar en Google Calendar:', err);
        setSchedulingStatus(null);
        showNotification(`No se pudo crear el Meet: ${err.message}. La dupla quedó confirmada; reintenta desde la tarjeta de tu propuesta.`, 'error');
        return;
      }
    }

    const newMeeting = {
      id: null,
      title,
      dateUtc: formatMeetingDateUtc(startDate, DIAS[Math.floor(proposal.slot / 24)]),
      duration: 60,
      participants: participantsStr,
      meetLink: meetUrl,
      startsAt: startDate.toISOString(),
      status: 'Creado (Meet)'
    };

    // Participantes de la dupla (para las filas de compromiso de asistencia)
    const participantRows = [
      { name: proposal.aName, email: proposal.aEmail },
      { name: proposal.bName, email: proposal.bEmail }
    ];

    if (!useMockDb) {
      const { data: inserted, error: insertError } = await supabase.from('meetings').insert({
        room_id: currentRoomId,
        title: newMeeting.title,
        date_utc: newMeeting.dateUtc,
        duration: newMeeting.duration,
        participants: newMeeting.participants,
        meet_link: newMeeting.meetLink,
        starts_at: newMeeting.startsAt
      }).select().single();

      if (insertError || !inserted) {
        // El evento de Calendar ya existe; avisar que no quedó registrado en la sala
        showNotification('La reunión se creó en Google Calendar, pero no se pudo guardar en la sala: ' + (insertError?.message || 'error desconocido'), 'error');
      } else {
        newMeeting.id = inserted.id;
        // Compromiso de asistencia: una fila 'confirmado' por participante
        const { data: attInserted, error: attError } = await supabase
          .from('meeting_attendees')
          .insert(participantRows.map(p => ({
            meeting_id: inserted.id,
            room_id: currentRoomId,
            member_email: p.email,
            member_name: p.name,
            status: 'confirmado'
          })))
          .select();
        if (attError) {
          showNotification('La reunión se guardó, pero no se pudo registrar el compromiso de asistencia: ' + attError.message, 'error');
        } else if (attInserted) {
          setAttendances(prev => [...prev, ...attInserted.map(d => ({
            id: d.id,
            meetingId: d.meeting_id,
            memberEmail: d.member_email,
            memberName: d.member_name,
            status: d.status,
            punctuality: d.punctuality,
            cancelReason: d.cancel_reason,
            reportedBy: d.reported_by,
            reportedAt: d.reported_at
          }))]);
        }
      }
    } else {
      // Modo demo: ids locales
      newMeeting.id = Date.now();
      setAttendances(prev => [...prev, ...participantRows.map((p, i) => ({
        id: newMeeting.id + i + 1,
        meetingId: newMeeting.id,
        memberEmail: p.email,
        memberName: p.name,
        status: 'confirmado',
        reportedBy: null,
        reportedAt: null
      }))]);
    }

    // Vincular la reunión creada a la propuesta
    if (!useMockDb && newMeeting.id != null) {
      await supabase.from('match_proposals').update({ meeting_id: newMeeting.id }).eq('id', proposal.id);
    }
    setProposals(prev => prev.map(p => p.id === proposal.id ? { ...p, meetingId: newMeeting.id } : p));

    setMeetings(prev => [...prev, newMeeting]);
    setSchedulingStatus('success');

    setTimeout(() => {
      setSchedulingStatus(null);
    }, 3000);
  };

  // Doble opt-in: aceptar o rechazar mi propuesta semanal. La reunión real
  // solo se crea cuando AMBAS partes aceptaron.
  const respondToProposal = async (proposal, accept) => {
    const meIsA = proposal.aEmail.toLowerCase() === currentUser.email.toLowerCase();
    const otherStatus = meIsA ? proposal.statusB : proposal.statusA;
    const newSide = accept ? 'aceptado' : 'rechazado';

    let newStatus = proposal.status;
    if (!accept) newStatus = 'rechazado';
    else if (otherStatus === 'aceptado') newStatus = 'confirmado';

    if (!useMockDb) {
      const dbPatch = meIsA ? { status_a: newSide } : { status_b: newSide };
      dbPatch.status = newStatus;
      const { error } = await supabase.from('match_proposals').update(dbPatch).eq('id', proposal.id);
      if (error) {
        showNotification('No se pudo guardar tu respuesta: ' + error.message, 'error');
        return;
      }
    }

    const updated = {
      ...proposal,
      [meIsA ? 'statusA' : 'statusB']: newSide,
      status: newStatus
    };
    setProposals(prev => prev.map(p => p.id === proposal.id ? updated : p));

    if (!accept) {
      showNotification('Rechazaste la propuesta. El emparejador te asignará otro compañero disponible en la próxima corrida.');
      return;
    }
    if (newStatus === 'confirmado') {
      await createProposalMeeting(updated);
    } else {
      const partnerName = meIsA ? proposal.bName : proposal.aName;
      showNotification(`¡Aceptaste! Esperando la confirmación de ${partnerName.split(' ')[0]}.`, 'success');
    }
  };

  // --- COMPROMISO DE ASISTENCIA ---
  // El compañero reporta el resultado del otro. outcome:
  //   'a_tiempo' → asistió dentro de los 10 min de tolerancia
  //   'tarde'    → asistió pero fuera de la tolerancia
  //   'no_show'  → no se presentó (cuenta como falta)
  const reportAttendance = async (attendance, outcome) => {
    const newStatus = outcome === 'no_show' ? 'no_show' : 'asistio';
    const punctuality = outcome === 'no_show' ? null : outcome;
    const reportedAt = new Date().toISOString();

    if (!useMockDb) {
      const { error } = await supabase.from('meeting_attendees')
        .update({ status: newStatus, punctuality, reported_by: currentUser.email, reported_at: reportedAt })
        .eq('id', attendance.id);
      if (error) {
        showNotification('No se pudo guardar el reporte: ' + error.message, 'error');
        return;
      }
    }

    setAttendances(prev => prev.map(a =>
      a.id === attendance.id
        ? { ...a, status: newStatus, punctuality, reportedBy: currentUser.email, reportedAt }
        : a
    ));
    const msg = {
      a_tiempo: `Confirmaste que ${attendance.memberName} asistió a tiempo.`,
      tarde: `Registraste que ${attendance.memberName} llegó tarde.`,
      no_show: `Reportaste que ${attendance.memberName} no se presentó.`
    }[outcome];
    showNotification(msg, 'success');
  };

  // El propio usuario cancela su asistencia ANTES del inicio.
  //   +24hs de antelación → 'cancelado_con_aviso' (no penaliza)
  //   <24hs               → 'cancelado_tarde' con MOTIVO obligatorio (cuenta
  //                          como falta; 3 en el mes bloquean al miembro)
  const cancelMyAttendance = async (meeting) => {
    const mine = attendances.find(a =>
      a.meetingId === meeting.id &&
      a.memberEmail.toLowerCase() === currentUser.email.toLowerCase()
    );
    if (!mine || mine.status !== 'confirmado' || meetingHasStarted(meeting)) return;

    const hoursUntil = meeting.startsAt
      ? (new Date(meeting.startsAt).getTime() - Date.now()) / 3600000
      : Infinity;
    const isLate = hoursUntil < 24;

    let newStatus, cancelReason = null;
    if (isLate) {
      const reason = await showPrompt(
        `Faltan menos de 24hs para "${meeting.title}". Cancelar ahora cuenta como falta. Detallá el motivo (obligatorio). Con 3 faltas en el mes quedarás sin emparejamientos hasta el mes siguiente.`,
        'Ej: surgió una urgencia laboral...'
      );
      if (reason === null) return; // el usuario desistió
      newStatus = 'cancelado_tarde';
      cancelReason = reason;
    } else {
      const confirmed = await showConfirm(
        `¿Cancelar con aviso tu asistencia a "${meeting.title}"? Faltan más de 24hs, así que NO cuenta como falta. Tus compañeros lo verán reflejado.`
      );
      if (!confirmed) return;
      newStatus = 'cancelado_con_aviso';
    }

    const reportedAt = new Date().toISOString();
    if (!useMockDb) {
      const { error } = await supabase.from('meeting_attendees')
        .update({ status: newStatus, cancel_reason: cancelReason, reported_by: currentUser.email, reported_at: reportedAt })
        .eq('id', mine.id);
      if (error) {
        showNotification('No se pudo cancelar: ' + error.message, 'error');
        return;
      }
    }

    setAttendances(prev => prev.map(a =>
      a.id === mine.id
        ? { ...a, status: newStatus, cancelReason, reportedBy: currentUser.email, reportedAt }
        : a
    ));
    showNotification(
      isLate
        ? 'Cancelaste sobre la hora. Quedó registrada como falta del mes.'
        : 'Cancelaste tu asistencia con aviso. No cuenta como falta.',
      isLate ? 'error' : 'success'
    );
  };

  const showNotification = (msg, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  };

  const showConfirm = (msg) => new Promise((resolve) => {
    setConfirmModal({
      msg,
      onConfirm: () => { setConfirmModal(null); resolve(true); },
      onCancel:  () => { setConfirmModal(null); resolve(false); }
    });
  });

  // Pide un texto obligatorio (ej. motivo de cancelación tardía). Resuelve con
  // el texto ingresado, o null si el usuario cancela.
  const showPrompt = (msg, placeholder = '') => new Promise((resolve) => {
    setPromptValue('');
    setPromptModal({
      msg,
      placeholder,
      onSubmit: (val) => { setPromptModal(null); resolve(val); },
      onCancel: () => { setPromptModal(null); resolve(null); }
    });
  });

  // --- GESTIÓN DE CELDAS DEL CALENDARIO ---
  const handleCellMouseDown = (dayIdx, hour) => {
    setIsMouseDown(true);
    const exists = wizardGrid.some(s => s.dayIdx === dayIdx && s.hour === hour);
    const active = !exists;
    setDragMode(active);
    toggleCell(dayIdx, hour, active);
  };

  const handleCellMouseEnter = (dayIdx, hour) => {
    if (isMouseDown) {
      toggleCell(dayIdx, hour, dragMode);
    }
  };

  const toggleCell = (dayIdx, hour, active) => {
    if (active) {
      setWizardGrid(prev => {
        if (prev.some(s => s.dayIdx === dayIdx && s.hour === hour)) return prev;
        return [...prev, { dayIdx, hour }];
      });
    } else {
      setWizardGrid(prev => prev.filter(s => !(s.dayIdx === dayIdx && s.hour === hour)));
    }
  };

  const clearAllCells = () => {
    setWizardGrid([]);
  };

  // Presets rápidos de disponibilidad (se suman a la selección actual)
  const applyPreset = (preset) => {
    const slots = [];
    const addRange = (days, from, to) => {
      days.forEach(d => {
        for (let h = from; h < to; h++) slots.push({ dayIdx: d, hour: h });
      });
    };
    const WORKDAYS = [0, 1, 2, 3, 4];
    const ALLDAYS = [0, 1, 2, 3, 4, 5, 6];

    if (preset === 'work') addRange(WORKDAYS, 9, 18);
    if (preset === 'mornings') addRange(ALLDAYS, 8, 12);
    if (preset === 'evenings') addRange(ALLDAYS, 18, 22);

    setWizardGrid(prev => {
      const merged = [...prev];
      slots.forEach(s => {
        if (!merged.some(m => m.dayIdx === s.dayIdx && m.hour === s.hour)) merged.push(s);
      });
      return merged;
    });
  };

  const handleTabClick = (tab) => {
    setActiveTab(tab);
    setIsSidebarOpen(false); // Cierra el menú al cambiar de pestaña en móvil
  };

  if (!isLoggedIn || !currentUser) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: 'var(--bg-main)',
        backgroundImage: 'var(--bg-glows)',
        backgroundAttachment: 'fixed',
        color: 'var(--text-main)',
        fontFamily: 'var(--font-sans)',
        padding: '20px',
        boxSizing: 'border-box'
      }}>
        {/* Theme select widget float top-right */}
        <div style={{ position: 'absolute', top: '20px', right: '20px', display: 'flex', gap: '8px', zIndex: 10 }}>
          <div className="theme-selector" style={{ margin: 0 }}>
            <button className={`theme-btn ${theme === 'light' ? 'active' : ''}`} onClick={() => setTheme('light')} title="Modo Claro">
              <Sun size={12} />
            </button>
            <button className={`theme-btn ${theme === 'dark' ? 'active' : ''}`} onClick={() => setTheme('dark')} title="Modo Oscuro">
              <Moon size={12} />
            </button>
            <button className={`theme-btn ${theme === 'system' ? 'active' : ''}`} onClick={() => setTheme('system')} title="Seguir Sistema">
              <Monitor size={12} />
            </button>
          </div>
        </div>

        <div className="glass" style={{
          width: '100%',
          maxWidth: '440px',
          padding: '40px 30px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
          border: '1px solid var(--border-color)',
          textAlign: 'center',
          boxSizing: 'border-box'
        }}>
          {/* Logo Brand Header */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '24px' }}>
            <a 
              href="https://sales-arena.netlify.app/" 
              target="_blank" 
              rel="noopener noreferrer" 
              title="Haz clic en el caballo para visitar el portal oficial de Sales Arena"
              className="brand-logo-interactive"
            >
              <div className="brand-logo-container horse-glow-pulse">
                <ChessKnightIcon size={44} />
              </div>
              <div className="brand-title-stacked" style={{ textAlign: 'left' }}>
                <span className="brand-title-sales" style={{ fontSize: '12px' }}>Sales-Arena</span>
                <span className="brand-title-arena" style={{ fontSize: '20px' }}>Matcher</span>
              </div>
            </a>
          </div>

          {/* STEP 1: GOOGLE EMAIL INPUT */}
          {loginStep === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ textAlign: 'center', marginBottom: '4px' }}>
                <div className="room-indicator-badge">
                  <span className="room-indicator-dot"></span>
                  <span>Sala de coordinación: <strong>{roomName}</strong></span>
                </div>
                {urlInviteCode && hasValidInvite(urlInviteCode) && (
                  <div className="invite-valid-badge">
                    <Check size={11} /> Invitación válida detectada
                  </div>
                )}
                <h2 style={{ margin: '10px 0 6px 0', fontSize: '22px', fontWeight: '800', letterSpacing: '-0.5px', color: 'var(--text-main)' }}>Iniciar Sesión</h2>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.4' }}>Utiliza tu cuenta de Google para ingresar al coordinador de roleplays.</p>
              </div>

              {!useMockDb ? (
                /* REAL PRODUCTION OAUTH: Single-click Google login */
                <button 
                  type="button" 
                  className="btn btn-indigo" 
                  onClick={handleGoogleLoginSubmit}
                  style={{ padding: '12px', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: '600' }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Iniciar Sesión con Google
                </button>
              ) : (
                /* LOCAL MOCK TESTING: With optional email input */
                <form onSubmit={handleGoogleLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div className="form-group" style={{ textAlign: 'left' }}>
                    <label htmlFor="login-email" style={{ fontSize: '11px', fontWeight: '600', marginBottom: '6px', display: 'block' }}>Correo de Prueba (Gmail)</label>
                    <input
                      type="email"
                      id="login-email"
                      className="form-input"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="Ej. tu.nombre@gmail.com o @example.com"
                      style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px' }}
                    />
                  </div>
                  <button type="submit" className="btn btn-indigo" style={{ padding: '12px', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: '600' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    Continuar con Google (Simulado)
                  </button>
                </form>
              )}
            </div>
          )}

          {/* STEP 2: PROFILE SETUP FORM */}
          {loginStep === 2 && (
            <form onSubmit={handleProfileRegisterSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                <h2 style={{ margin: '0 0 8px 0', fontSize: '20px', fontWeight: '800', letterSpacing: '-0.5px' }}>Completar Perfil</h2>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>Es tu primera vez ingresando con esta cuenta. Completa tu información base.</p>
              </div>

              <div className="form-group" style={{ textAlign: 'left' }}>
                <label htmlFor="reg-email-readonly" style={{ fontSize: '11px', fontWeight: '600', marginBottom: '6px', display: 'block' }}>Email de Registro (Gmail)</label>
                <input
                  id="reg-email-readonly"
                  type="email"
                  className="form-input"
                  value={loginEmail}
                  readOnly
                  disabled
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '10px 14px',
                    backgroundColor: 'rgba(120, 120, 120, 0.08)',
                    cursor: 'not-allowed',
                    color: 'var(--text-muted)'
                  }}
                />
              </div>

              <div className="form-group" style={{ textAlign: 'left' }}>
                <label htmlFor="reg-name" style={{ fontSize: '11px', fontWeight: '600', marginBottom: '6px', display: 'block' }}>Nombre Completo</label>
                <input
                  type="text"
                  id="reg-name"
                  className="form-input"
                  value={loginName}
                  onChange={(e) => setLoginName(e.target.value)}
                  placeholder="Ej. Carlos Mendoza"
                  required
                  style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px' }}
                />
              </div>

              <div className="form-group" style={{ textAlign: 'left' }}>
                <label htmlFor="reg-country" style={{ fontSize: '11px', fontWeight: '600', marginBottom: '6px', display: 'block' }}>País de Origen</label>
                <select
                  id="reg-country"
                  className="form-select"
                  value={loginCountry}
                  onChange={(e) => setLoginCountry(e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', marginBottom: loginCountry === 'Otro' ? '12px' : '0' }}
                >
                  {ZONAS.map(z => (
                    <option key={z.country} value={z.country}>{z.country}</option>
                  ))}
                  <option value="Otro">Otro (Escribir país)...</option>
                </select>
                {loginCountry === 'Otro' && (
                  <input
                    type="text"
                    className="form-input"
                    value={customLoginCountry}
                    onChange={(e) => setCustomLoginCountry(e.target.value)}
                    placeholder="Escribe tu país de origen... Ej. Italia"
                    required
                    style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px' }}
                  />
                )}
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                <button type="button" className="btn btn-outline" style={{ flex: 1, padding: '10px' }} onClick={() => setLoginStep(1)}>
                  Atrás
                </button>
                <button type="submit" className="btn btn-indigo" style={{ flex: 2, padding: '10px', fontWeight: '600' }}>
                  Finalizar Registro
                </button>
              </div>
            </form>
          )}

          {/* STEP 3: CÓDIGO DE INVITACIÓN (SALA PROTEGIDA) */}
          {loginStep === 3 && (
            <form onSubmit={handleInviteCodeSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div style={{ textAlign: 'center' }}>
                <div className="invite-lock-icon">
                  <Lock size={26} />
                </div>
                <h2 style={{ margin: '14px 0 8px 0', fontSize: '20px', fontWeight: '800', letterSpacing: '-0.5px' }}>Sala Privada</h2>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                  Para unirte a <strong>{roomName}</strong> necesitas un código de invitación.
                  Pídeselo a la persona que te compartió la sala, o usa su enlace de invitación completo.
                </p>
              </div>

              <div className="form-group" style={{ textAlign: 'left' }}>
                <label htmlFor="invite-code" style={{ fontSize: '11px', fontWeight: '600', marginBottom: '6px', display: 'block' }}>Código de Invitación</label>
                <input
                  type="text"
                  id="invite-code"
                  className="form-input invite-code-input"
                  value={inviteCodeInput}
                  onChange={(e) => { setInviteCodeInput(e.target.value.toUpperCase()); setInviteError(''); }}
                  placeholder="······"
                  maxLength={6}
                  autoComplete="off"
                  required
                />
                {inviteError && (
                  <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <AlertCircle size={13} /> {inviteError}
                  </p>
                )}
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button type="button" className="btn btn-outline" style={{ flex: 1, padding: '10px' }} onClick={() => { setLoginStep(1); setInviteError(''); setInviteCodeInput(''); }}>
                  Atrás
                </button>
                <button type="submit" className="btn btn-indigo" style={{ flex: 2, padding: '10px', fontWeight: '600' }}>
                  Validar Código
                </button>
              </div>
            </form>
          )}

          {/* Elegant Footer to official portal */}
          <div style={{ marginTop: '28px', paddingTop: '18px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'center' }}>
            <a
              href="https://sales-arena.netlify.app/"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12.5px',
                color: 'var(--text-muted)',
                textDecoration: 'none',
                fontWeight: '500',
                transition: 'color 0.2s'
              }}
            >
              <span>¿Conoces Sales Arena?</span>
              <span style={{ color: 'var(--color-primary)', fontWeight: '700' }}>Visitar Portal Oficial ↗</span>
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="layout-container">

      {/* SKIP LINK: keyboard users can bypass the sidebar nav and jump straight to content */}
      <a href="#main-content" className="skip-to-content">Saltar al contenido principal</a>

      {/* TOAST NOTIFICATION SYSTEM */}
      <div className="toast-container" aria-live="polite" role="status">
        {toasts.map(t => (
          <div key={t.id} className={`toast-item toast-${t.type}`}>
            <span className="toast-icon" aria-hidden="true">
              {t.type === 'error' ? '✕' : t.type === 'success' ? '✓' : 'i'}
            </span>
            <span className="toast-msg">{t.msg}</span>
            <button className="toast-close" aria-label="Cerrar notificación" onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}>✕</button>
          </div>
        ))}
      </div>

      {/* CONFIRM MODAL */}
      {confirmModal && (
        <div className="confirm-overlay" role="dialog" aria-modal="true">
          <div className="confirm-card">
            <div className="confirm-icon"><AlertCircle size={36} /></div>
            <p className="confirm-msg">{confirmModal.msg}</p>
            <div className="confirm-actions">
              <button className="btn btn-outline" onClick={confirmModal.onCancel}>Cancelar</button>
              <button className="btn btn-danger" onClick={confirmModal.onConfirm}>Sí, eliminar</button>
            </div>
          </div>
        </div>
      )}

      {promptModal && (
        <div className="confirm-overlay" role="dialog" aria-modal="true">
          <div className="confirm-card">
            <div className="confirm-icon"><AlertCircle size={36} /></div>
            <p className="confirm-msg">{promptModal.msg}</p>
            <textarea
              className="prompt-textarea"
              autoFocus
              rows={3}
              maxLength={300}
              value={promptValue}
              placeholder={promptModal.placeholder}
              onChange={(e) => setPromptValue(e.target.value)}
              style={{ width: '100%', resize: 'vertical', marginBottom: '14px' }}
            />
            <div className="confirm-actions">
              <button className="btn btn-outline" onClick={promptModal.onCancel}>Cancelar</button>
              <button
                className="btn btn-danger"
                disabled={promptValue.trim().length < 3}
                onClick={() => promptModal.onSubmit(promptValue.trim())}
              >
                Confirmar cancelación
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MOBILE HEADER BAR */}
      <div className="mobile-header-bar">
        <button
          className="menu-toggle-btn"
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          aria-label={isSidebarOpen ? 'Cerrar menú de navegación' : 'Abrir menú de navegación'}
          aria-expanded={isSidebarOpen}
        >
          {isSidebarOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
        </button>
        <a href="https://sales-arena.netlify.app/" target="_blank" rel="noopener noreferrer" title="Ir a la web principal de Sales Arena" className="brand-logo-interactive" style={{ margin: 0 }}>
          <div className="brand-logo-container horse-glow-pulse">
            <ChessKnightIcon size={34} />
          </div>
          <div className="brand-title-stacked">
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span className="brand-title-sales">Sales-Arena</span>
              <span className="portal-badge-mini">PORTAL ↗</span>
            </div>
            <span className="brand-title-arena">Matcher</span>
          </div>
        </a>
        <div style={{ width: '34px' }}></div> {/* Spacer to center the logo */}
      </div>

      {/* MOBILE DRAWER OVERLAY */}
      <div className={`sidebar-overlay ${isSidebarOpen ? 'open' : ''}`} onClick={() => setIsSidebarOpen(false)}></div>

      {/* 1. SIDEBAR NAVIGATION */}
      <nav className={`nav-sidebar ${isSidebarOpen ? 'open' : ''}`}>
        <div style={{ marginBottom: '28px' }}>
          <a 
            href="https://sales-arena.netlify.app/" 
            target="_blank" 
            rel="noopener noreferrer" 
            title="Haz clic para visitar el Portal Oficial de Sales Arena" 
            className="brand-logo-interactive"
          >
            <div className="brand-logo-container horse-glow-pulse">
              <ChessKnightIcon size={34} />
            </div>
            <div className="brand-title-stacked">
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="brand-title-sales">Sales-Arena</span>
                <span className="portal-badge-mini">PORTAL ↗</span>
              </div>
              <span className="brand-title-arena">Matcher</span>
            </div>
          </a>
        </div>

        <div className="nav-links" role="navigation" aria-label="Navegación principal">
          <button type="button" className={`nav-link ${activeTab === 'dashboard' ? 'active' : ''}`} aria-current={activeTab === 'dashboard' ? 'page' : undefined} onClick={() => handleTabClick('dashboard')}>
            <LayoutDashboard size={17} /> Panel de Control
          </button>
          <button type="button" className={`nav-link ${activeTab === 'wizard' ? 'active' : ''}`} aria-current={activeTab === 'wizard' ? 'page' : undefined} onClick={() => { handleTabClick('wizard'); setWizardStep(1); }}>
            <CalendarRange size={17} /> Cargar Disponibilidad
          </button>
          <button type="button" className={`nav-link ${activeTab === 'heatmap' ? 'active' : ''}`} aria-current={activeTab === 'heatmap' ? 'page' : undefined} onClick={() => handleTabClick('heatmap')}>
            <Flame size={17} /> Mapa de Calor
          </button>
          <button type="button" className={`nav-link ${activeTab === 'affinity' ? 'active' : ''}`} aria-current={activeTab === 'affinity' ? 'page' : undefined} onClick={() => handleTabClick('affinity')}>
            <Users size={17} /> Afinidad Horaria
          </button>
          <button type="button" className={`nav-link ${activeTab === 'members' ? 'active' : ''}`} aria-current={activeTab === 'members' ? 'page' : undefined} onClick={() => handleTabClick('members')}>
            <UserCheck size={17} /> Gestionar Equipo
          </button>
        </div>

        {/* THEME SELECTOR WIDGET */}
        <div className="theme-selector" role="group" aria-label="Selector de tema">
          <button className={`theme-btn ${theme === 'light' ? 'active' : ''}`} onClick={() => setTheme('light')} title="Modo Claro" aria-pressed={theme === 'light'}>
            <Sun size={12} aria-hidden="true" /> Claro
          </button>
          <button className={`theme-btn ${theme === 'dark' ? 'active' : ''}`} onClick={() => setTheme('dark')} title="Modo Oscuro" aria-pressed={theme === 'dark'}>
            <Moon size={12} aria-hidden="true" /> Oscuro
          </button>
          <button className={`theme-btn ${theme === 'system' ? 'active' : ''}`} onClick={() => setTheme('system')} title="Seguir Sistema" aria-pressed={theme === 'system'}>
            <Monitor size={12} aria-hidden="true" /> Auto
          </button>
        </div>

        <div className="profile-card">
          <div className="profile-card-top">
            <div className="profile-avatar" style={{ backgroundColor: getAvatarColor(currentUser.name) }}>
              {getInitials(currentUser.name)}
              <span className={`profile-status-dot ${currentUser.active ? 'on' : 'off'}`} title={currentUser.active ? 'Participando esta semana' : 'Inactivo esta semana'}></span>
            </div>
            <div className="profile-card-info">
              <div className="profile-card-name">
                {currentUser.name}
                <span className="profile-flag" title={currentUser.country}>{getCountryFlag(currentUser.country)}</span>
              </div>
              <div className="profile-card-email">{currentUser.email}</div>
              <div className="profile-card-tz">
                <Globe size={10} /> {tzCity(currentUser.tz)}
              </div>
            </div>
          </div>
          <div className="profile-card-actions">
            <button type="button" className="profile-action-btn" onClick={openOnboarding} title="Ver la guía de uso">
              <HelpCircle size={13} /> Guía
            </button>
            <button type="button" className="profile-action-btn danger" onClick={handleLogout} title="Cerrar sesión">
              <LogOut size={13} /> Salir
            </button>
          </div>
        </div>
      </nav>

      {/* 2. MAIN APP CONTENT */}
      <main className="main-view">
        
        {/* HEADER BAR */}
        <header className="view-header">
          <div>
            <h2 className="view-title">
              {activeTab === 'dashboard' && 'Panel de Control Principal'}
              {activeTab === 'wizard' && 'Asistente de Configuración'}
              {activeTab === 'heatmap' && 'Mapa de Calor Semanal'}
              {activeTab === 'affinity' && 'Afinidad Horaria y Matrices'}
              {activeTab === 'members' && 'Miembros y Roles de la Sala'}
            </h2>
            <p className="view-subtitle">
              {activeTab === 'dashboard' && 'Revisa el estado de la sala, coincidencias activas y links de Meet.'}
              {activeTab === 'wizard' && 'Configura tu participación en los role-plays de esta semana en pocos clics.'}
              {activeTab === 'heatmap' && 'Visualiza de forma horaria colectiva en qué momento hay más personas disponibles.'}
              {activeTab === 'affinity' && '% de coincidencia relativa entre parejas de role-players.'}
              {activeTab === 'members' && 'Administra quiénes participan del grupo y configura sus correos y países.'}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              onClick={() => setIsRoomModalOpen(true)}
              className="glass room-chip"
              title="Gestionar salas"
            >
              <span className="room-indicator-dot" aria-hidden="true"></span>
              <span>Sala Activa: <strong>{roomName}</strong></span>
              <Settings size={13} style={{ opacity: 0.75 }} aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* CONTAINER CONTENT */}
        <div className="view-content" id="main-content" tabIndex={-1}>

          {/* VIEW: DASHBOARD */}
          {activeTab === 'dashboard' && (
            <div>
              {/* Tarjeta para compartir sala rápidamente */}
              <div className="glass share-room-banner" style={{ padding: '16px 20px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '12px',
                    background: 'linear-gradient(135deg, rgba(10,132,255,0.15), rgba(94,92,230,0.15))',
                    border: '1px solid rgba(10,132,255,0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--color-primary)'
                  }}>
                    <Share2 size={20} />
                  </div>
                  <div>
                    <div style={{ fontWeight: '700', fontSize: '14px', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      Invitar a la Sala: <span className="room-badge-pill">{roomName}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '3px' }}>
                      Comparte este enlace con tu equipo. Al ingresar los llevará directamente al registro inicial de esta sala.
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-indigo"
                  onClick={handleCopyRoomInvite}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px', fontWeight: '600' }}
                >
                  <Share2 size={15} />
                  Copiar Link de Invitación
                </button>
              </div>

              {/* Aviso de bloqueo por faltas del mes (3+) */}
              {currentUser && isBlocked(currentUser.email) && (
                <div className="glass" style={{ padding: '14px 18px', marginBottom: '16px', border: '1px solid var(--color-danger)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Lock size={18} style={{ color: 'var(--color-danger)', flexShrink: 0 }} />
                  <div style={{ fontSize: '13px', color: 'var(--text-main)' }}>
                    <strong>Estás sin emparejamientos este mes.</strong> Acumulaste {getMonthlyFaltas(currentUser.email)} faltas (no presentarte o cancelar sobre la hora). Volverás a entrar en la rotación el 1ero del mes que viene.
                  </div>
                </div>
              )}

              {/* Tarjeta de Estado Semanal de Tomás */}
              <div className="glass" style={{ padding: '16px 20px', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    backgroundColor: currentUser.active ? 'var(--color-accent)' : 'var(--color-danger)',
                    boxShadow: currentUser.active ? '0 0 10px var(--color-accent)' : '0 0 10px var(--color-danger)'
                  }}></div>
                  <div>
                    <div style={{ fontWeight: '700', fontSize: '13.5px', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      Mi Participación Semanal:
                      <span className={currentUser.active ? 'member-badge-active' : 'member-badge-inactive'}>
                        {currentUser.active ? 'ACTIVO' : 'INACTIVO'}
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2.5px' }}>
                      {currentUser.active
                        ? 'Estás participando de los emparejamientos semanales. Tus compañeros pueden coincidir contigo.'
                        : 'Estás excluido de esta semana. Tus horarios no serán cruzados con los del equipo.'}
                    </div>
                  </div>
                </div>
                <button
                  className={`btn ${currentUser.active ? 'btn-outline' : 'btn-indigo'}`}
                  style={{ fontSize: '12px', padding: '6px 14px' }}
                  onClick={toggleCurrentUserActive}
                >
                  {currentUser.active ? 'Desactivar participación' : 'Activar participación'}
                </button>
              </div>

              {/* PROMPTS DE ASISTENCIA PENDIENTES */}
              {pendingReports.length > 0 && (
                <div className="attendance-prompts">
                  {pendingReports.map(({ meeting, attendance }) => (
                    <div className="attendance-prompt-card glass" key={attendance.id}>
                      <div className="attendance-prompt-info">
                        <div className="attendance-prompt-avatar" style={{ backgroundColor: getAvatarColor(attendance.memberName) }}>
                          {getInitials(attendance.memberName)}
                        </div>
                        <div>
                          <div className="attendance-prompt-question">
                            ¿Se conectó <strong>{attendance.memberName}</strong> y llegó a tiempo? <span style={{ fontWeight: 400, opacity: 0.7 }}>(tolerancia 10 min)</span>
                          </div>
                          <div className="attendance-prompt-meta">
                            {meeting.title} · {meeting.dateUtc}
                          </div>
                        </div>
                      </div>
                      <div className="attendance-prompt-actions">
                        <button
                          type="button"
                          className="attendance-btn attendance-btn-yes"
                          onClick={() => reportAttendance(attendance, 'a_tiempo')}
                        >
                          <Check size={14} /> Sí, a tiempo
                        </button>
                        <button
                          type="button"
                          className="attendance-btn attendance-btn-late"
                          onClick={() => reportAttendance(attendance, 'tarde')}
                        >
                          <Clock size={14} /> Llegó tarde
                        </button>
                        <button
                          type="button"
                          className="attendance-btn attendance-btn-no"
                          onClick={() => reportAttendance(attendance, 'no_show')}
                        >
                          <X size={14} /> No se presentó
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* KPIs */}
              <div className="metrics-grid">
                <div className="kpi-card glass glass-hover">
                  <div className="kpi-icon-container" style={{ backgroundColor: 'rgba(0,113,227,0.08)', color: 'var(--color-primary)' }}>
                    <Users size={18} />
                  </div>
                  <div className="kpi-info">
                    <span className="kpi-val">{members.filter(m => m.active).length}</span>
                    <span className="kpi-label">Miembros Activos</span>
                  </div>
                </div>
                <div className="kpi-card glass glass-hover">
                  <div className="kpi-icon-container" style={{ backgroundColor: 'rgba(120,120,120,0.08)', color: 'var(--text-muted)' }}>
                    <Clock size={18} />
                  </div>
                  <div className="kpi-info">
                    <span className="kpi-val">{availabilities.length}</span>
                    <span className="kpi-label">Bloques Semanales</span>
                  </div>
                </div>
                <div className="kpi-card glass glass-hover">
                  <div className="kpi-icon-container" style={{ backgroundColor: 'rgba(52,199,89,0.12)', color: '#34c759' }}>
                    <Sparkles size={18} />
                  </div>
                  <div className="kpi-info">
                    <span className="kpi-val">{myProposal ? 1 : 0}</span>
                    <span className="kpi-label">Mi Propuesta Activa</span>
                  </div>
                </div>
                <div className="kpi-card glass glass-hover">
                  <div className="kpi-icon-container" style={{ backgroundColor: 'rgba(255,149,0,0.12)', color: '#ff9500' }}>
                    <Video size={18} />
                  </div>
                  <div className="kpi-info">
                    <span className="kpi-val">{meetings.length}</span>
                    <span className="kpi-label">Meets Creados</span>
                  </div>
                </div>
              </div>

              {/* 2-Columns */}
              <div className="dashboard-sections">
                
                {/* Left Col: Mi propuesta 1:1 de la semana (privada) */}
                <div className="section-card glass">
                  <h4 className="section-title">
                    <Sparkles size={15} className="section-title-icon" />
                    Mi Role-Play de la Semana
                  </h4>
                  {isRoomDataLoading ? (
                    <div className="match-card-skeleton" aria-busy="true" aria-label="Cargando tu propuesta de la semana">
                      <div className="skeleton" style={{ width: '40px', height: '40px', borderRadius: '50%' }}></div>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div className="skeleton" style={{ width: '55%', height: '14px' }}></div>
                        <div className="skeleton" style={{ width: '80%', height: '11px' }}></div>
                      </div>
                    </div>
                  ) : !myProposal ? (
                    <div className="empty-state">
                      <AlertCircle size={30} />
                      <span className="empty-state-title">
                        {myLastClosedProposal ? 'Buscando nuevo compañero' : 'Aún sin compañero asignado'}
                      </span>
                      <span className="empty-state-desc">
                        {myLastClosedProposal
                          ? 'Tu propuesta anterior se cerró. El emparejador te asignará otro candidato disponible en su próxima corrida.'
                          : 'El emparejador semanal te asigna un compañero 1:1 según tu disponibilidad y confiabilidad. Asegúrate de tener tu disponibilidad cargada.'}
                      </span>
                    </div>
                  ) : (() => {
                    const meIsA = myProposal.aEmail.toLowerCase() === myEmailLower;
                    const partnerName = meIsA ? myProposal.bName : myProposal.aName;
                    const partnerEmail = meIsA ? myProposal.bEmail : myProposal.aEmail;
                    const partnerMember = members.find(m => m.email.toLowerCase() === partnerEmail.toLowerCase());
                    const mySide = meIsA ? myProposal.statusA : myProposal.statusB;
                    const linkedMeeting = meetings.find(mm => mm.id === myProposal.meetingId);
                    const isConfirmed = myProposal.status === 'confirmado';

                    return (
                      <div className={`match-card glass ${isConfirmed ? 'match-card-mine' : ''}`}>
                        <div className="match-card-header">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                            <span className="participant-avatar-mini match-avatar-lg" style={{ backgroundColor: getAvatarColor(partnerName) }}>
                              {getInitials(partnerName)}
                            </span>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-main)' }}>
                                {partnerName}
                              </div>
                              <div className="match-card-subline">
                                {partnerMember && <span>{getCountryFlag(partnerMember.country)} {partnerMember.country}</span>}
                                <ReliabilityBadge pct={getReliability(partnerEmail)} />
                              </div>
                            </div>
                          </div>
                          <span className={`proposal-status-pill ${isConfirmed ? 'confirmed' : 'pending'}`}>
                            <span className="status-dot" aria-hidden="true"></span>
                            {isConfirmed ? 'Confirmado' : 'Propuesto'}
                          </span>
                        </div>

                        <div className="match-card-body">
                          <div className="match-section-label"><Clock size={11} /> Horario de la sesión (hora local de cada uno)</div>
                          <div className="match-time-compare">
                            <div className="match-time-side">
                              <span className="match-time-side-label">Tú</span>
                              <span className="match-time-side-value">{slotToLocalLabel(myProposal.slot, currentUser.tz)}</span>
                            </div>
                            <div className="match-time-divider" aria-hidden="true">
                              <Clock size={12} />
                            </div>
                            {partnerMember && (
                              <div className="match-time-side match-time-side-right">
                                <span className="match-time-side-label">{partnerName.split(' ')[0]}</span>
                                <span className="match-time-side-value">{slotToLocalLabel(myProposal.slot, partnerMember.tz)}</span>
                              </div>
                            )}
                          </div>
                          {!isConfirmed && myProposal.respondBy && (
                            <div className="match-deadline-chip" title={`Vence el ${new Date(myProposal.respondBy).toLocaleString()}`}>
                              <AlertCircle size={12} />
                              Respondé {formatRespondByRelative(myProposal.respondBy)} o el cupo se reasigna
                            </div>
                          )}
                        </div>

                        <div className="match-card-footer">
                          {isConfirmed ? (
                            linkedMeeting ? (
                              <a href={linkedMeeting.meetLink} target="_blank" rel="noopener noreferrer" className="btn btn-indigo" style={{ width: '100%', textDecoration: 'none', boxSizing: 'border-box' }}>
                                <Video size={14} /> Abrir Google Meet
                              </a>
                            ) : (
                              <button className="btn btn-indigo" style={{ width: '100%' }} onClick={() => createProposalMeeting(myProposal)}>
                                <Video size={14} /> Crear Meet de la dupla
                              </button>
                            )
                          ) : mySide === 'pendiente' ? (
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button className="attendance-btn attendance-btn-yes" style={{ flex: 1, justifyContent: 'center' }} onClick={() => respondToProposal(myProposal, true)}>
                                <Check size={14} /> Aceptar
                              </button>
                              <button className="attendance-btn attendance-btn-no" style={{ flex: 1, justifyContent: 'center' }} onClick={() => respondToProposal(myProposal, false)}>
                                <X size={14} /> Rechazar
                              </button>
                            </div>
                          ) : (
                            <div className="proposal-waiting">
                              <span className="spinner" style={{ width: '14px', height: '14px' }}></span>
                              Aceptaste la propuesta. Esperando a {partnerName.split(' ')[0]}...
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Right Col: Historial / Meets */}
                <div className="section-card glass">
                  <h4 className="section-title">
                    <CalendarCheck size={15} className="section-title-icon" />
                    Próximos Role-Plays Agendados
                  </h4>
                  <p className="section-subtitle">
                    Estos links son visibles para toda la sala: si querés mirar o sumarte como observador a un role-play de otros compañeros, podés unirte desde acá. Ingresá con el micrófono apagado para no interrumpir la práctica.
                  </p>
                  <div className="meetings-list">
                    {isRoomDataLoading ? (
                      <div aria-busy="true" aria-label="Cargando reuniones agendadas" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div className="skeleton" style={{ height: '48px', borderRadius: '12px' }}></div>
                        <div className="skeleton" style={{ height: '48px', borderRadius: '12px' }}></div>
                      </div>
                    ) : meetings.length === 0 ? (
                      <div className="empty-state">
                        <CalendarDays size={30} />
                        <span className="empty-state-title">Sin reuniones agendadas</span>
                        <span className="empty-state-desc">Agenda un horario coincidente y aparecerá aquí con su link de Meet, visible para toda la sala.</span>
                      </div>
                    ) : (
                      meetings.map((meet, idx) => {
                        const meetRows = attendances.filter(a => a.meetingId === meet.id);
                        const myRow = currentUser && meetRows.find(a => a.memberEmail.toLowerCase() === currentUser.email.toLowerCase());
                        const canCancel = myRow && myRow.status === 'confirmado' && !meetingHasStarted(meet);
                        const statusRows = meetRows.filter(a => a.status !== 'confirmado');
                        const isLive = meetingHasStarted(meet) && !meetingHasEnded(meet);

                        return (
                          <div className="meeting-item" key={meet.id ?? idx} style={{ flexWrap: 'wrap' }}>
                            <div className="meeting-info">
                              <span className="meeting-title" style={{ fontSize: '13px' }}>{meet.title}</span>
                              <span className="meeting-meta" style={{ fontSize: '11px' }}>{meet.dateUtc}</span>
                              <span className="meeting-meta" style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <Users size={10} /> {meet.participants}
                              </span>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                {isLive && (
                                  <span className="meeting-live-badge" role="status">
                                    <span className="meeting-live-dot" aria-hidden="true"></span>
                                    En vivo ahora
                                  </span>
                                )}
                                <span className="meeting-open-badge" title="Cualquier miembro de la sala puede sumarse a este Meet como observador, con el micrófono apagado">
                                  <Globe size={10} /> Abierto a la sala
                                </span>
                              </div>
                              {isLive && (
                                <span className="meeting-mic-note">
                                  <MicOff size={10} /> Si entrás como observador, hacelo con el micrófono apagado para no interrumpir
                                </span>
                              )}
                              {statusRows.length > 0 && (
                                <div className="attendance-chips">
                                  {statusRows.map(a => (
                                    <span key={a.id} className={`attendance-chip attendance-chip-${a.status}`} title={a.cancelReason || undefined}>
                                      {a.status === 'asistio' && <Check size={9} />}
                                      {a.status === 'no_show' && <X size={9} />}
                                      {(a.status === 'cancelado_con_aviso' || a.status === 'cancelado_tarde') && <AlertCircle size={9} />}
                                      {a.memberName.split(' ')[0]}
                                      {a.status === 'asistio'
                                        ? (a.punctuality === 'tarde' ? ' llegó tarde' : ' asistió a tiempo')
                                        : a.status === 'no_show' ? ' no asistió'
                                        : a.status === 'cancelado_tarde' ? ' canceló tarde'
                                        : ' canceló con aviso'}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
                              <a
                                href={meet.meetLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-indigo"
                                style={{ padding: '6px 10px', fontSize: '11px', textDecoration: 'none' }}
                                aria-label={`Unirse al Meet de ${meet.participants} (${meet.dateUtc})`}
                              >
                                <Video size={12} /> Meet
                              </a>
                              {canCancel && (
                                <button
                                  type="button"
                                  className="btn-cancel-notice"
                                  onClick={() => cancelMyAttendance(meet)}
                                  title="Cancela tu asistencia antes del inicio; no cuenta como ausencia"
                                >
                                  Cancelar con aviso
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* VIEW: WIZARD */}
          {activeTab === 'wizard' && (
            <div className="wizard-card glass">
              
              {/* Wizard Status Alert */}
              {wizardStatus && (
                <div id="status" className={`status-${wizardStatus.type}`} style={{ display: 'block', marginBottom: '16px' }}>
                  {wizardStatus.type === 'loading' && <span className="spinner"></span>} {wizardStatus.msg}
                </div>
              )}

              {/* STEP 1: Bienvenida */}
              {wizardStep === 1 && (
                <div>
                  <div className="wizard-hero-icon">
                    <Target size={30} />
                  </div>
                  <h3 className="wizard-title">¡Hola de nuevo, {currentUser.name}!</h3>
                  <p className="wizard-desc">¿Vas a participar en las sesiones de role-plays programadas para esta semana?</p>

                  <div className="participation-choice">
                    <button className="choice-card choice-yes" onClick={() => handleWizardParticipation(true)}>
                      <span className="choice-icon">
                        <Check size={24} strokeWidth={3} />
                      </span>
                      <span className="choice-text">
                        <span className="choice-title">Sí, participaré</span>
                        <span className="choice-sub">Coincidiré con mi equipo esta semana</span>
                      </span>
                    </button>
                    <button className="choice-card choice-no" onClick={() => handleWizardParticipation(false)}>
                      <span className="choice-icon">
                        <X size={24} strokeWidth={3} />
                      </span>
                      <span className="choice-text">
                        <span className="choice-title">No puedo esta semana</span>
                        <span className="choice-sub">Me excluyo de los emparejamientos</span>
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 2: Usar Plantilla vs Carga manual */}
              {wizardStep === 2 && (
                <div>
                  <div className="wizard-hero-icon">
                    <CalendarRange size={30} />
                  </div>
                  <h3 className="wizard-title">Carga de Disponibilidad</h3>
                  <p className="wizard-desc">Elige si deseas restablecer tu disponibilidad desde tu plantilla base cargada o configurarlo a mano:</p>

                  <div className="wizard-options">
                    <button className="wizard-btn wizard-btn-primary" onClick={handleUseTemplate}>
                      <CalendarCheck size={16} /> Usar mi horario base habitual (Plantilla)
                    </button>
                    <button className="wizard-btn wizard-btn-outline" onClick={() => setWizardStep(3)}>
                      <Pencil size={15} /> Cargar/Editar horarios específicos para esta semana
                    </button>
                    <button className="wizard-btn wizard-btn-outline" onClick={() => setWizardStep(1)}>
                      <ChevronLeft size={15} /> Atrás
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 3: Grid Semanal (estilo Cal.com) */}
              {wizardStep === 3 && (
                <div className="editor-grid-container">
                  <h3 className="wizard-title">Marca tu Disponibilidad</h3>
                  <p className="wizard-desc" style={{ fontSize: '12px', margin: 0 }}>
                    Haz clic o arrastra sobre el calendario para marcar los horarios en los que podés hacer un role-play.
                  </p>

                  <div className="editor-toolbar">
                    <span className="tz-chip" title="Tus horarios se guardan en esta zona horaria">
                      <Globe size={12} /> {tzCity(currentUser?.tz)}
                    </span>
                    <span className="hours-counter">
                      <Clock size={12} /> {wizardGrid.length} {wizardGrid.length === 1 ? 'hora seleccionada' : 'horas seleccionadas'}
                    </span>
                  </div>

                  <div className="preset-bar">
                    <button type="button" className="preset-btn" onClick={() => applyPreset('work')} title="Lunes a Viernes, 9:00 a 18:00">
                      <Briefcase size={12} /> Laboral 9–18
                    </button>
                    <button type="button" className="preset-btn" onClick={() => applyPreset('mornings')} title="Todos los días, 8:00 a 12:00">
                      <Sunrise size={12} /> Mañanas
                    </button>
                    <button type="button" className="preset-btn" onClick={() => applyPreset('evenings')} title="Todos los días, 18:00 a 22:00">
                      <Sunset size={12} /> Noches
                    </button>
                    <button type="button" className="preset-btn preset-btn-clear" onClick={clearAllCells} title="Borrar toda la selección">
                      <Eraser size={12} /> Limpiar
                    </button>
                  </div>

                  <div className="editor-grid-scroll" onMouseLeave={() => setIsMouseDown(false)}>
                    <table className="editor-table">
                      <thead>
                        <tr>
                          <th className="editor-th editor-th-hour">Hora</th>
                          {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d, i) => (
                            <th key={d} className={`editor-th ${i >= 5 ? 'weekend' : ''}`}>{d}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from({ length: 24 }).map((_, h) => {
                          if (!showAllHours && (h < 6)) return null;
                          return (
                            <tr key={h}>
                              <td className="editor-hour-label">{String(h).padStart(2, '0')}:00</td>
                              {Array.from({ length: 7 }).map((_, d) => {
                                const isActive = wizardGrid.some(s => s.dayIdx === d && s.hour === h);
                                return (
                                  <td
                                    key={d}
                                    className={`editor-cell ${isActive ? 'active' : ''}`}
                                    onMouseDown={() => handleCellMouseDown(d, h)}
                                    onMouseEnter={() => handleCellMouseEnter(d, h)}
                                    onMouseUp={() => setIsMouseDown(false)}
                                  ></td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <button type="button" className="show-hours-toggle" onClick={() => setShowAllHours(!showAllHours)}>
                    {showAllHours ? 'Ocultar madrugada (00:00–06:00)' : 'Mostrar madrugada (00:00–06:00)'}
                  </button>

                  <div className="checkbox-container" style={{ margin: '4px 0' }}>
                    <input
                      type="checkbox"
                      id="saveTemplate"
                      checked={saveAsTemplate}
                      onChange={(e) => setSaveAsTemplate(e.target.checked)}
                    />
                    <label htmlFor="saveTemplate" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Save size={13} /> Guardar como mi Plantilla Base habitual
                    </label>
                  </div>

                  <button className="wizard-btn wizard-btn-primary" onClick={saveWizardGrid}>
                    <Check size={16} /> Guardar Horarios
                  </button>
                  <button className="wizard-btn wizard-btn-outline" onClick={() => setWizardStep(2)}>
                    <ChevronLeft size={15} /> Atrás
                  </button>
                </div>
              )}

            </div>
          )}

          {/* VIEW: HEATMAP */}
          {activeTab === 'heatmap' && (() => {
            const totalActive = members.filter(m => m.active).length;
            // Escalones fijos (no una rampa continua): con muchos miembros la opacidad
            // lineal (count/total) vuelve casi indistinguibles conteos distintos.
            // Los escalones garantizan contraste perceptible sin importar el tamaño del equipo.
            const HEATMAP_LEVELS = [
              { max: 0,    bg: 'transparent',                 ink: 'var(--text-muted)', label: 'Nadie' },
              { max: 0.25, bg: 'rgba(52, 199, 89, 0.18)',      ink: 'var(--text-main)',  label: 'Hasta 25%' },
              { max: 0.5,  bg: 'rgba(52, 199, 89, 0.38)',      ink: 'var(--text-main)',  label: '26–50%' },
              // Niveles 3 y 4: el verde ya es lo bastante saturado en claro y oscuro
              // como para que el texto oscuro pierda contraste sobre fondo oscuro (bg-main).
              // Blanco funciona en ambos temas para estos dos escalones.
              { max: 0.75, bg: 'rgba(52, 199, 89, 0.62)',      ink: '#ffffff',           label: '51–75%' },
              { max: 1,    bg: 'rgba(52, 199, 89, 0.9)',       ink: '#ffffff',           label: 'Más de 75%' },
            ];
            const levelFor = (count) => {
              const ratio = totalActive ? count / totalActive : 0;
              if (ratio === 0) return HEATMAP_LEVELS[0];
              return HEATMAP_LEVELS.find(l => ratio <= l.max) || HEATMAP_LEVELS[HEATMAP_LEVELS.length - 1];
            };

            return (
              <div className="section-card glass" style={{ maxWidth: '100%' }}>
                <div className="heatmap-container">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <h3 style={{ margin: 0, fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Flame size={17} className="section-title-icon" /> Mapa de Calor Colectivo
                    </h3>
                    <span className="tz-chip">
                      <Globe size={12} /> Hora local de {currentUser?.name?.split(' ')[0] || ''} ({tzCity(currentUser?.tz)})
                    </span>
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '12.5px', margin: 0 }}>
                    Cada celda muestra cuántas personas están disponibles. Hacé click (o Enter con teclado) en un bloque para ver quiénes son.
                  </p>

                  {/* SCALE LEGEND: la única forma antes era el tooltip, ahora la escala es siempre visible */}
                  <div className="heatmap-legend" role="img" aria-label="Escala de disponibilidad: de nadie a más del 75% del equipo">
                    {HEATMAP_LEVELS.map(l => (
                      <div className="heatmap-legend-item" key={l.label}>
                        <span className="heatmap-legend-swatch" style={{ backgroundColor: l.bg === 'transparent' ? 'var(--bg-card-hover)' : l.bg }}></span>
                        <span className="heatmap-legend-text">{l.label}</span>
                      </div>
                    ))}
                  </div>

                  <div className="table-responsive-wrapper">
                    <table className="heatmap-table">
                      <thead>
                        <tr>
                          <th className="heatmap-th" style={{ width: '60px' }}>Hora</th>
                          {DIAS.map(d => (
                            <th className="heatmap-th" key={d}>{d.substring(0, 3)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from({ length: 24 }).map((_, h) => (
                          <tr key={h}>
                            <td className="heatmap-td-hour">{String(h).padStart(2, '0')}:00</td>
                            {Array.from({ length: 7 }).map((_, d) => {
                              const cellData = heatmap[d]?.[h] || { count: 0, names: '' };
                              const level = levelFor(cellData.count);
                              const isSelected = selectedHeatmapCell?.day === d && selectedHeatmapCell?.hour === h;

                              return (
                                <td key={d} className="heatmap-cell-wrap">
                                  <button
                                    type="button"
                                    className={`heatmap-cell-btn ${isSelected ? 'selected' : ''}`}
                                    style={{ backgroundColor: level.bg, color: level.ink }}
                                    onClick={() => setSelectedHeatmapCell({ day: d, hour: h, count: cellData.count, names: cellData.names })}
                                    aria-label={`${DIAS[d]} ${String(h).padStart(2, '0')}:00 — ${cellData.count === 0 ? 'nadie disponible' : `${cellData.count} ${cellData.count === 1 ? 'persona disponible' : 'personas disponibles'}`}`}
                                  >
                                    {cellData.count > 0 ? cellData.count : ''}
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* DETALLE ACCESIBLE: reemplaza al tooltip como fuente de la lista de nombres.
                      Funciona con click, teclado (Enter/Espacio en el botón) y touch (tap). */}
                  <div className="heatmap-detail-panel" aria-live="polite">
                    {selectedHeatmapCell ? (
                      selectedHeatmapCell.count > 0 ? (
                        <>
                          <div className="heatmap-detail-title">
                            <Clock size={13} /> {DIAS[selectedHeatmapCell.day]} {String(selectedHeatmapCell.hour).padStart(2, '0')}:00 · {selectedHeatmapCell.count} {selectedHeatmapCell.count === 1 ? 'persona disponible' : 'personas disponibles'}
                          </div>
                          <div className="heatmap-detail-names">{selectedHeatmapCell.names}</div>
                        </>
                      ) : (
                        <div className="heatmap-detail-title heatmap-detail-empty">
                          <Clock size={13} /> {DIAS[selectedHeatmapCell.day]} {String(selectedHeatmapCell.hour).padStart(2, '0')}:00 · Nadie disponible en ese bloque
                        </div>
                      )
                    ) : (
                      <div className="heatmap-detail-placeholder">Elegí un bloque de la grilla para ver quiénes están disponibles.</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* VIEW: AFFINITY */}
          {activeTab === 'affinity' && (() => {
            const AFFINITY_LEVELS = [
              { label: 'Baja o sin coincidencia aún', min: 0, max: 39, bg: 'rgba(120, 120, 120, 0.1)', text: 'var(--text-muted)' },
              { label: 'Moderada (40-69%)', min: 40, max: 69, bg: 'rgba(255, 159, 10, 0.12)', text: 'var(--color-warning)' },
              { label: 'Alta (70-100%)', min: 70, max: 100, bg: 'rgba(52, 199, 89, 0.15)', text: '#34c759' }
            ];
            const levelForAffinity = (pct) => AFFINITY_LEVELS.find(l => pct >= l.min && pct <= l.max) || AFFINITY_LEVELS[0];

            return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div className="section-card glass">
                <h4 className="section-title">
                  <Handshake size={15} className="section-title-icon" />
                  Tu Solapamiento Horario con el Equipo
                </h4>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 10px 0' }}>
                  Porcentaje de solapamiento relativo entre tus horas disponibles y las de cada compañero. Solo ves tu propia fila: la disponibilidad detallada del resto del equipo es privada.
                </p>

                <div className="heatmap-legend" role="img" aria-label="Escala de afinidad horaria: de baja o sin coincidencia a alta">
                  {AFFINITY_LEVELS.map(l => (
                    <div className="heatmap-legend-item" key={l.label}>
                      <span className="heatmap-legend-swatch" style={{ backgroundColor: l.bg }}></span>
                      <span className="heatmap-legend-text">{l.label}</span>
                    </div>
                  ))}
                </div>
                <div className="table-responsive-wrapper">
                  <table className="affinity-table">
                    <thead>
                      <tr>
                        <th className="affinity-th" style={{ backgroundColor: 'var(--bg-card-hover)' }}>Jugador</th>
                        {members.filter(m => m.active).map(m => (
                          <th className="affinity-th" key={m.name}>{m.name.split(' ')[0]}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {affinity.filter(row => row.name.toLowerCase() === currentUser.name.toLowerCase()).map((row, i) => (
                        <tr key={i}>
                          <td className="affinity-td-label">{row.name}</td>
                          {row.stats.map((col, j) => {
                            const pct = col.pct;
                            const level = pct !== null ? levelForAffinity(pct) : null;
                            return (
                              <td
                                key={j}
                                className="affinity-cell"
                                style={{ backgroundColor: level ? level.bg : 'transparent', color: level ? level.text : 'var(--text-muted)' }}
                              >
                                {pct !== null ? `${pct}%` : '—'}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Best Partners List */}
              <div className="section-card glass">
                <h4 className="section-title">
                  <Trophy size={15} className="section-title-icon" />
                  Tus Compañeros con Mayor Afinidad
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {affinity.filter(row => row.name.toLowerCase() === currentUser.name.toLowerCase()).map((row, i) => {
                    const sortedStats = [...row.stats]
                      .filter(s => s.pct !== null)
                      .sort((a, b) => b.pct - a.pct);
                    const topStats = sortedStats.filter(s => s.pct > 0).slice(0, 2);

                    if (sortedStats.length === 0) {
                      return (
                        <div className="empty-state" key={i}>
                          <Users size={30} />
                          <span className="empty-state-title">Todavía no hay compañeros activos</span>
                          <span className="empty-state-desc">Cuando se sumen más personas a la sala, vas a ver acá con quién más coincidís.</span>
                        </div>
                      );
                    }

                    if (topStats.length === 0) {
                      return (
                        <div className="empty-state" key={i}>
                          <AlertCircle size={30} />
                          <span className="empty-state-title">Aún sin coincidencias horarias</span>
                          <span className="empty-state-desc">Por ahora ningún compañero comparte horas libres con las tuyas. Cargá más franjas en "Cargar Disponibilidad" para aumentar tus chances.</span>
                        </div>
                      );
                    }

                    return (
                      <React.Fragment key={i}>
                        {topStats.map(s => {
                          const level = levelForAffinity(s.pct);
                          return (
                            <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', borderBottom: '1px solid var(--border-color)', fontSize: '13px', flexWrap: 'wrap', gap: '8px' }}>
                              <span style={{ fontWeight: '600', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span className="participant-avatar-mini" style={{ backgroundColor: getAvatarColor(s.name) }}>
                                  {getInitials(s.name)}
                                </span>
                                {s.name}
                              </span>
                              <span className="affinity-pct-badge" style={{ backgroundColor: level.bg, color: level.text }}>
                                {s.pct}%
                              </span>
                            </div>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            </div>
            );
          })()}

          {/* VIEW: MEMBERS */}
          {activeTab === 'members' && (
            <div className="dashboard-sections">
              
              {/* Left Col: List of Members */}
              <div className="section-card glass">
                <h4 className="section-title">
                  <Users size={15} className="section-title-icon" />
                  Miembros Registrados
                </h4>
                <div className="members-list-card">
                  {members.map((m, idx) => {
                    const isSelf = m.email.toLowerCase() === currentUser.email.toLowerCase();
                    return (
                    <div className={`member-row ${isSelf ? 'member-row-self' : ''}`} key={idx}>
                      <div className="member-row-avatar" style={{ backgroundColor: getAvatarColor(m.name) }}>
                        {getInitials(m.name)}
                      </div>
                      <div className="member-row-info">
                        <span className="member-row-name">
                          {m.name}
                          <span className="participant-flag" title={m.country}>{getCountryFlag(m.country)}</span>
                          {isSelf && <span className="member-badge-self">Tú</span>}
                          <span className={m.active ? 'member-badge-active' : 'member-badge-inactive'}>
                            {m.active ? 'Participa' : 'Excluido'}
                          </span>
                          <ReliabilityBadge pct={getReliability(m.email)} />
                        </span>
                        <span className="member-row-details"><Mail size={11} /> {m.email}</span>
                        <span className="member-row-details"><MapPin size={11} /> {m.country} · {tzCity(m.tz)}</span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                        {isSelf ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Participa:</span>
                            <label className="switch-control" title="Activa o desactiva tu participación">
                              <input
                                type="checkbox"
                                checked={m.active}
                                onChange={toggleCurrentUserActive}
                                aria-label="Activa o desactiva tu participación esta semana"
                              />
                              <span className="switch-slider" aria-hidden="true"></span>
                            </label>
                          </div>
                        ) : (
                          <span className="member-lock-chip" title="Solo este miembro puede cambiar su propia participación">
                            <Lock size={11} /> Solo {m.name.split(' ')[0]}
                          </span>
                        )}
                        {!isSelf && (
                          <button
                            type="button"
                            className="btn-danger-icon"
                            onClick={() => deleteMember(m.email)}
                            title="Eliminar de la sala"
                            aria-label={`Eliminar a ${m.name} de la sala`}
                          >
                            <Trash2 size={15} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>

              {/* Right Col: Add Member Form */}
              <div className="section-card glass" style={{ height: 'fit-content' }}>
                <h4 className="section-title">
                  <UserPlus size={15} className="section-title-icon" />
                  Agregar Nuevo Role-Player
                </h4>
                <form className="add-member-form" onSubmit={handleAddMember}>
                  <div className="form-group">
                    <label htmlFor="mem-name" style={{ fontSize: '11px', fontWeight: '600' }}>Nombre Completo</label>
                    <input
                      type="text"
                      id="mem-name"
                      className="form-input"
                      value={newMemberName}
                      onChange={(e) => setNewMemberName(e.target.value)}
                      placeholder="Ej. Juan Pérez"
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="mem-email" style={{ fontSize: '11px', fontWeight: '600' }}>Correo Electrónico (Gmail)</label>
                    <input
                      type="email"
                      id="mem-email"
                      className="form-input"
                      value={newMemberEmail}
                      onChange={(e) => setNewMemberEmail(e.target.value)}
                      placeholder="Ej. juan@gmail.com"
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="mem-country" style={{ fontSize: '11px', fontWeight: '600' }}>País de Origen</label>
                    <select
                      id="mem-country"
                      className="form-select"
                      value={newMemberCountry}
                      onChange={(e) => setNewMemberCountry(e.target.value)}
                      style={{ marginBottom: newMemberCountry === 'Otro' ? '10px' : '0' }}
                    >
                      {ZONAS.map(z => (
                        <option key={z.country} value={z.country}>{z.country}</option>
                      ))}
                      <option value="Otro">Otro (Escribir país)...</option>
                    </select>
                    {newMemberCountry === 'Otro' && (
                      <input
                        type="text"
                        className="form-input"
                        value={customNewMemberCountry}
                        onChange={(e) => setCustomNewMemberCountry(e.target.value)}
                        placeholder="Escribe el país... Ej. Italia"
                        required
                        style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px' }}
                      />
                    )}
                  </div>

                  <button type="submit" className="btn btn-indigo" style={{ marginTop: '8px', width: '100%' }}>
                    <UserPlus size={16} /> Agregar a la Sala
                  </button>
                </form>
              </div>

            </div>
          )}

        </div>

      </main>

      {/* GOOGLE MEET CREATOR OVERLAY MODAL */}
      {schedulingStatus && (
        <div style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(9, 9, 11, 0.85)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 500,
          animation: 'fadeIn 0.2s ease'
        }}>
          <div className="glass" style={{
            width: '400px',
            padding: '30px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
            border: '1px solid var(--border-color)',
            boxSizing: 'border-box'
          }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
              {schedulingStatus === 'success' ? (
                <div style={{
                  width: '52px', height: '52px', borderRadius: '50%',
                  backgroundColor: 'rgba(48, 209, 88, 0.12)', color: '#30d158',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px'
                }}>
                  <Check size={28} />
                </div>
              ) : (
                <span className="spinner" style={{ width: '32px', height: '32px', color: 'var(--color-primary)' }}></span>
              )}
            </div>

            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: 'var(--text-main)' }}>
              {schedulingStatus === 'loading' && 'Conectando con Google Calendar API...'}
              {schedulingStatus === 'authenticating' && 'Autenticando Usuario (OAuth 2.0)...'}
              {schedulingStatus === 'creating' && 'Generando sala de Google Meet...'}
              {schedulingStatus === 'success' && '¡Reunión Agendada con Éxito!'}
            </h3>

            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
              {schedulingStatus === 'loading' && 'Estableciendo comunicación segura con los servicios de Google Cloud.'}
              {schedulingStatus === 'authenticating' && 'Verificando permisos y tokens del organizador de la sala.'}
              {schedulingStatus === 'creating' && `Creando el evento y agregando a los ${scheduledDetails?.attendeesCount} participantes correspondientes.`}
              {schedulingStatus === 'success' && '📧 Google Calendar ha enviado invitaciones de correo oficiales a todos los participantes con el enlace de Google Meet para unirse.'}
            </p>
          </div>
        </div>
      )}
      {/* MODAL DE GESTIÓN DE SALAS (ROOM MANAGER) */}
      {isRoomModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div className="glass" style={{
            width: '100%',
            maxWidth: '480px',
            backgroundColor: 'var(--color-bg-sidebar)',
            borderRadius: '16px',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
            border: '1px solid var(--border-color)',
            boxSizing: 'border-box',
            position: 'relative'
          }}>
            {/* Header del Modal */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Settings size={17} className="section-title-icon" /> Gestión de Salas
              </h3>
              <button
                onClick={() => setIsRoomModalOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex'
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Sección de Compartir Enlace de Invitación */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '18px' }}>
              <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Share2 size={14} /> Compartir Enlace de Invitación
              </label>
              <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                Al enviar este enlace, cualquier nuevo integrante accederá al registro inicial específicamente vinculado a la sala <strong>{roomName}</strong>.
              </p>
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <input
                  type="text"
                  readOnly
                  className="form-input"
                  value={buildInviteUrl()}
                  style={{ flex: 1, padding: '8px 12px', fontSize: '12px', color: 'var(--text-muted)', background: 'var(--bg-card)' }}
                />
                <button
                  type="button"
                  onClick={handleCopyRoomInvite}
                  className="btn btn-indigo"
                  style={{ padding: '8px 16px', fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Copy size={14} />
                  Copiar
                </button>
              </div>

              {/* Código de invitación de la sala */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <Lock size={12} /> Código de acceso:
                  </span>
                  <span className="invite-code-chip">{roomInviteCode || 'Sin protección'}</span>
                </div>
                <button
                  type="button"
                  className="btn-small"
                  onClick={handleRegenerateInviteCode}
                  title="Genera un código nuevo e invalida los enlaces anteriores"
                  style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
                >
                  <RefreshCw size={12} /> Regenerar
                </button>
              </div>
            </div>

            {/* Formulario 1: Renombrar Sala */}
            <form onSubmit={handleRenameRoom} style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '20px' }}>
              <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Renombrar Sala Actual</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  className="form-input"
                  value={renameRoomInput}
                  onChange={(e) => setRenameRoomInput(e.target.value)}
                  placeholder="Ej. Equipo Comercial"
                  required
                  style={{ flex: 1, padding: '8px 12px' }}
                />
                <button type="submit" className="btn btn-indigo" style={{ padding: '8px 16px', fontSize: '13px' }}>
                  Guardar
                </button>
              </div>
            </form>

            {/* Formulario 2: Crear Nueva Sala */}
            <form onSubmit={handleCreateRoom} style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '20px' }}>
              <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>Crear Nueva Sala (Desde Cero)</label>
              <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                Al crear una nueva sala con un nombre personalizado, se generará una URL limpia. Compartirás esa nueva URL para invitar a otras personas a participar de forma aislada.
              </p>
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <input
                  type="text"
                  className="form-input"
                  value={newRoomNameInput}
                  onChange={(e) => setNewRoomNameInput(e.target.value)}
                  placeholder="Ej. Marketing 2026"
                  required
                  style={{ flex: 1, padding: '8px 12px' }}
                />
                <button type="submit" className="btn btn-indigo" style={{ padding: '8px 16px', fontSize: '13px' }}>
                  Crear
                </button>
              </div>
            </form>

            {/* Sección 3: Eliminar Sala */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-danger-hover, #ff453a)' }}>Zona de Peligro</label>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', maxWidth: '280px', lineHeight: '1.4' }}>
                  Eliminar permanentemente esta sala y todos sus miembros de la base de datos.
                </span>
                <button 
                  onClick={handleDeleteRoom}
                  disabled={currentRoomId === 'grupo-a'}
                  className="btn"
                  style={{ 
                    backgroundColor: 'rgba(255, 69, 58, 0.15)', 
                    color: '#ff453a', 
                    padding: '8px 16px', 
                    fontSize: '13px', 
                    fontWeight: '600',
                    border: '1px solid rgba(255, 69, 58, 0.3)',
                    cursor: currentRoomId === 'grupo-a' ? 'not-allowed' : 'pointer',
                    opacity: currentRoomId === 'grupo-a' ? 0.5 : 1
                  }}
                >
                  Eliminar Sala
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* GUÍA DE BIENVENIDA (ONBOARDING) */}
      {showOnboarding && (() => {
        const steps = [
          {
            icon: <ChessKnightIcon size={44} />,
            title: `¡Bienvenido, ${currentUser.name.split(' ')[0]}!`,
            desc: 'Sales-Arena Matcher coordina los role-plays de tu equipo cruzando la disponibilidad horaria de todos, sin importar en qué país estén. Esta mini guía te muestra cómo funciona en 3 pasos.'
          },
          {
            icon: <CalendarRange size={34} />,
            title: '1 · Carga tu disponibilidad',
            desc: 'Entra a "Cargar Disponibilidad" y marca en el calendario los horarios en los que podés hacer un role-play esta semana (en tu hora local). Puedes usar presets rápidos o guardar tu horario como plantilla para reutilizarlo cada semana.'
          },
          {
            icon: <Sparkles size={34} />,
            title: '2 · Descubre las coincidencias',
            desc: 'El motor cruza automáticamente los horarios de todo el equipo. En el Panel de Control verás los mejores horarios en común, con el % de match y la etiqueta "Coincides" cuando tú estás incluido.'
          },
          {
            icon: <Video size={34} />,
            title: '3 · Agenda y comparte',
            desc: 'Con un clic agendas el role-play en Google Calendar con link de Meet. Ese link queda visible para toda la sala en el Panel de Control: cualquier compañero puede sumarse a mirar o participar, no solo la dupla emparejada.'
          }
        ];
        const step = steps[onboardingStep];
        const isLast = onboardingStep === steps.length - 1;

        return (
          <div className="onboarding-overlay" role="dialog" aria-modal="true">
            <div className="onboarding-card glass">
              <button className="onboarding-close" onClick={closeOnboarding} title="Cerrar guía" aria-label="Cerrar guía de bienvenida">
                <X size={16} aria-hidden="true" />
              </button>

              <div className={`onboarding-icon ${onboardingStep === 0 ? 'brand' : ''}`}>
                {step.icon}
              </div>
              <h3 className="onboarding-title">{step.title}</h3>
              <p className="onboarding-desc">{step.desc}</p>

              <div className="onboarding-dots">
                {steps.map((_, i) => (
                  <button
                    key={i}
                    className={`onboarding-dot ${i === onboardingStep ? 'active' : ''}`}
                    onClick={() => setOnboardingStep(i)}
                    aria-label={`Paso ${i + 1}`}
                  />
                ))}
              </div>

              <div className="onboarding-actions">
                {onboardingStep > 0 ? (
                  <button className="btn btn-outline" onClick={() => setOnboardingStep(onboardingStep - 1)}>
                    <ChevronLeft size={14} /> Atrás
                  </button>
                ) : (
                  <button className="btn btn-outline" onClick={closeOnboarding}>
                    Saltar guía
                  </button>
                )}
                {isLast ? (
                  <button className="btn btn-indigo" onClick={() => { closeOnboarding(); setActiveTab('wizard'); setWizardStep(1); }}>
                    <CalendarCheck size={14} /> Cargar mi disponibilidad
                  </button>
                ) : (
                  <button className="btn btn-indigo" onClick={() => setOnboardingStep(onboardingStep + 1)}>
                    Siguiente <ChevronRight size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
