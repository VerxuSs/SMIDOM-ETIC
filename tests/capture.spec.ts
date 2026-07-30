import { test, expect } from '@playwright/test';

test('Générer les captures d\'écran du Dashboard', async ({ page }) => {
  // 1. Se rendre sur la page (assure-toi que ton serveur Next.js tourne !)
  await page.goto('http://localhost:3000/dashboard'); // Modifie l'URL si besoin

  // Mettre la fenêtre en plein écran (ex: format PC de bureau)
  await page.setViewportSize({ width: 1920, height: 1080 });

  // Attendre que la page charge complètement (que l'API réponde)
  await page.waitForLoadState('networkidle');

  // --- CAPTURE 1 : OMR (Onglet par défaut) ---
  await page.screenshot({ path: 'screenshots/1-onglet-omr-mai-2026.png', fullPage: true });

  // --- CAPTURE 2 : DÉCHÈTERIES ---
  // Cliquer sur l'onglet Déchèteries (on cherche le texte du bouton)
  await page.getByText('Déchèteries').click();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/2-onglet-decheteries-total.png', fullPage: true });

  // Changer le filtre EGT (exemple : passer de "Total" à "Bois")
  // Il faut cibler le bon select. S'il y en a plusieurs, il faudra être plus précis
  // Changer le filtre EGT (Sélectionner la première matière disponible au lieu de "Total")
  const selects = await page.locator('select').all();
  if(selects.length > 0) {
    // On sélectionne l'option à l'index 1 (la première matière après "TOTAL" qui est à l'index 0)
    await selects[0].selectOption({ index: 1 });

    await page.waitForTimeout(1000); // Petit temps de pause pour l'animation du graphe
    await page.screenshot({ path: 'screenshots/3-onglet-decheteries-filtre-matiere.png', fullPage: true });
  }

  // --- CAPTURE 3 : RI ---
  await page.getByText('Redevance Incitative').click();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/4-onglet-ri.png', fullPage: true });

  // --- CAPTURE 4 : CS ---
  await page.getByText('Collecte Sélective').click();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/5-onglet-cs.png', fullPage: true });
});
