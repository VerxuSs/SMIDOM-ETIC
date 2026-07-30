import { test } from '@playwright/test';

test('Générer les captures des formulaires d\'upload avec tous les workflows', async ({ page }) => {
    // Mettre la fenêtre en plein écran pour avoir un beau rendu
    await page.setViewportSize({ width: 1920, height: 1080 });

    // Liste des pages d'upload avec un préfixe pour nommer les images proprement
    const uploadRoutes = [
        { url: '/omr', name: '1-OMR' },
        { url: '/decheterie', name: '2-Decheteries' },
        { url: '/ri', name: '3-RI' },
        { url: '/cs', name: '4-CS' },
    ];

    for (const route of uploadRoutes) {
        // 1. Aller sur la page
        await page.goto(`http://localhost:3000${route.url}`);

        // Attendre que la page soit complètement chargée
        await page.waitForLoadState('networkidle');

        // 2. Trouver tous les boutons de la grille "Type de fichier"
        // On cible les boutons qui sont dans la div qui suit le titre "1. Type de fichier"
        // Tes boutons ont les classes "flex flex-col items-start..."
        const workflowButtons = await page.locator('button').filter({ hasText: /\w/ }).all();

        // On va filtrer pour ne garder que les boutons de la grille (ceux qui ont une icône et deux textes)
        // C'est une astuce : le bouton final "Calculer et enregistrer" n'a pas la classe "flex-col"
        const validButtons = [];
        for (const btn of workflowButtons) {
            const className = await btn.getAttribute('class');
            if (className && className.includes('flex-col') && className.includes('items-start')) {
                validButtons.push(btn);
            }
        }

        // 3. Boucler sur chaque bouton de la grille
        for (let i = 0; i < validButtons.length; i++) {
            const button = validButtons[i];

            // Récupérer le texte principal du bouton (ex: "Emballages Régie") pour nommer le fichier
            // Le premier 'span' dans ton bouton contient le label
            const labelElement = button.locator('span').first();
            let labelName = `workflow-${i+1}`; // Nom par défaut

            if (await labelElement.isVisible()) {
                const text = await labelElement.innerText();
                // On nettoie le texte pour en faire un nom de fichier valide (sans espaces, sans accents)
                labelName = text.trim()
                    .toLowerCase()
                    .replace(/ /g, '-')
                    .replace(/[éèê]/g, 'e')
                    .replace(/[']/g, '')
                    .replace(/[^a-z0-9-]/g, '');
            }

            // Cliquer sur le bouton
            await button.click();

            // Attendre un tout petit peu pour que React mette à jour le composant (texte sous "2. Période" et "3. Fichier Excel")
            await page.waitForTimeout(300);

            // 4. Prendre la capture d'écran
            await page.screenshot({
                path: `screenshots/uploads/${route.name}-${i+1}-${labelName}.png`,
                fullPage: true
            });

            console.log(`📸 Capture prise : uploads/${route.name}-${i+1}-${labelName}.png`);
        }
    }
});
