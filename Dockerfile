# Utiliser une image Node.js légère et récente
FROM node:20-alpine

# Installer OpenSSL (requis par Prisma)
RUN apk add --no-cache openssl

# Définir le dossier de travail dans le conteneur
WORKDIR /app

# Copier les fichiers de définition des dépendances
COPY package.json package-lock.json* ./

# Installer toutes les dépendances
RUN npm install

# Copier le reste du projet
COPY . .

# Générer le client Prisma (indispensable avant le build)
RUN npx prisma generate

# Construire l'application Next.js
RUN npm run build

# Exposer le port sur lequel l'app va tourner
EXPOSE 3000

# Lancer la DB push (créer les tables SQLite si elles n'existent pas) puis démarrer Next.js
CMD ["sh", "-c", "npx prisma db push && npm run start"]
