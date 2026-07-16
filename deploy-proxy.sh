#!/bin/bash

# Script para desplegar la función proxy Edge
# Uso: ./deploy-proxy.sh

echo "🚀 Desplegando función proxy db-proxy..."

if ! command -v supabase &> /dev/null; then
  echo "❌ Error: Supabase CLI no encontrado"
  echo "Instala con: npm install -g supabase"
  exit 1
fi

# Verificar autenticación
if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
  echo "⚠️  No hay token de acceso configurado"
  echo "Ejecuta: supabase login"
  exit 1
fi

# Desplegar la función
supabase functions deploy db-proxy --no-verify-jwt

if [ $? -eq 0 ]; then
  echo "✅ Función desplegada exitosamente"
  echo ""
  echo "Para activar el proxy, configura en .env.local:"
  echo "  VITE_USE_PROXY=true"
  echo ""
  echo "Lee más en: DNS_BLOCKING_SOLUTION.md"
else
  echo "❌ Error durante el despliegue"
  exit 1
fi
