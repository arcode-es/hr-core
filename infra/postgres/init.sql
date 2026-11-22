-- Se ejecuta solo al crear el volumen. Las migraciones también las crean (IF NOT EXISTS).
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;
