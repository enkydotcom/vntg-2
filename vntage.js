// Test push sur le repo public vntg-2
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
puppeteer.use(StealthPlugin());
import fs from 'fs';
import axios from 'axios';
import { setTimeout } from 'timers/promises';
import cron from 'node-cron';  // Ajout de node-cron pour les tâches planifiées
import dotenv from 'dotenv';
dotenv.config();

// const OPENAI_API_KEY = 'sk-...';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const proxy = process.env.PROXY_URL;
const username = process.env.PROXY_USERNAME;
const password = process.env.PROXY_PASSWORD;

const designers = {
  "klein-gallery": { currentPage: 1, urls: new Set() },
  "depot09": { currentPage: 1, urls: new Set() },
  "dasnice": { currentPage: 1, urls: new Set() },
  "bold-design": { currentPage: 1, urls: new Set() },
  "kameleon-design": { currentPage: 1, urls: new Set() },
  "vintage-venue-furniture": { currentPage: 1, urls: new Set() },
  "decennia-design": { currentPage: 1, urls: new Set() },
  "the-house-of-cool": { currentPage: 1, urls: new Set() },
  "jac-ard": { currentPage: 1, urls: new Set() },
  "calm-shapes": { currentPage: 1, urls: new Set() },
  "tandt-antiques": { currentPage: 1, urls: new Set() },
  "%28re%29approved": { currentPage: 1, urls: new Set() },
  "timeless-art": { currentPage: 1, urls: new Set() },
  "rijp-vintage": { currentPage: 1, urls: new Set() },
  "zo-goed-als-oud": { currentPage: 1, urls: new Set() },
  "svenska-fynd": { currentPage: 1, urls: new Set() },
  "modern-artifacts": { currentPage: 1, urls: new Set() },
  "brocanteurs": { currentPage: 1, urls: new Set() },
  "fussy-people": { currentPage: 1, urls: new Set() },
  "vintage-hoarder": { currentPage: 1, urls: new Set() },
  "royal-crown": { currentPage: 1, urls: new Set() },
  "tim-tom": { currentPage: 1, urls: new Set() },
  "b22-design": { currentPage: 1, urls: new Set() },
  "retrohuis.nl": { currentPage: 1, urls: new Set() },
  "bij-de-tijd": { currentPage: 1, urls: new Set() },
};

// Configuration
const BATCH_SIZE = 5;
const MAX_RETRIES = 3;
const DELAY_BETWEEN_BATCHES = 1000; // ms
const TIMEOUT = 15000; // ms

// Charger les URLs déjà stockées
let existingUrls = new Set();

// Lecture ligne par ligne du fichier output.json (format JSONL)
if (fs.existsSync('output.json')) {
  try {
    const lines = fs.readFileSync('output.json', 'utf8').split('\n').filter(Boolean);
    lines.forEach(line => {
      try {
        const item = JSON.parse(line);
        if (item.url || item.URL) {
          existingUrls.add(item.url || item.URL);
        }
      } catch (e) { /* ligne invalide ignorée */ }
    });
    console.log(`📊 Données existantes chargées: ${existingUrls.size} URLs.`);
  } catch (error) {
    console.error('❌ Erreur lors du chargement des données existantes:', error);
  }
}

// Ajoute cette fonction utilitaire pour appeler OpenAI
async function extractDimensionsWithAI(text) {
  const apiKey = OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('⚠️ Clé OpenAI manquante, dimensions à null');
    return { largeur: null, profondeur: null, hauteur: null };
  }
  try {
    const prompt = `Voici un texte de fiche produit. Peux-tu extraire la largeur (width), la profondeur (depth) et la hauteur (height) en cm si possible ? Donne-moi un JSON du type {\"largeur\": ..., \"profondeur\": ..., \"hauteur\": ...}. Si tu ne trouves pas une dimension, mets null.\n\nTexte :\n${text}`;
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Tu es un assistant qui extrait des dimensions de meubles à partir de texte.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 100,
      temperature: 0
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    const content = response.data.choices[0].message.content;
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    return { largeur: null, profondeur: null, hauteur: null };
  } catch (e) {
    console.warn('⚠️ Erreur OpenAI:', e.message);
    return { largeur: null, profondeur: null, hauteur: null };
  }
}

// Fonction principale de scraping
const scrapeData = async () => {
  let result = [];
  let browser;

  // On ne récupère plus les URLs existantes via l'API Enky
  // let enkyExistingUrls = new Set();

  try {
    for (const designer in designers) {
      console.log(`🔍 Démarrage du scraping pour ${designer}`);

      // Phase 1: Collecte des URLs des produits
      let newUrlsFound;
      do {
        try {
          const url = `https://www.vntg.com/dealer/${designer}/${designers[designer].currentPage}/`;
          console.log(`🔎 Page en cours: ${url}`);

          browser = await launchBrowser();
          const page = await createNewPage(browser);

          await page.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUT });
          console.log('🌍 Page ouverte via proxy :', url);
          await page.waitForSelector('.collage', { timeout: 5000 }).catch(() => null);

          const urls = await page.evaluate(() =>
            Array.from(document.querySelectorAll('.collage a')).map(a => a.href).filter(Boolean)
          );

          newUrlsFound = false;
          for (const url of urls) {
            if (!designers[designer].urls.has(url)) {
              designers[designer].urls.add(url);
              newUrlsFound = true;
            }
          }

          console.log(`📑 ${urls.length} URLs trouvées sur la page ${designers[designer].currentPage}`);
          designers[designer].currentPage++;

          await page.close();
          await browser.close();
        } catch (error) {
          console.error(`❌ Erreur lors de la collecte d'URLs: ${error.message}`);
          designers[designer].currentPage++;
          newUrlsFound = false;

          if (browser) {
            try { await browser.close(); } catch (e) { /* ignore */ }
          }
        }

        // Pause entre les pages
        await setTimeout(1000);
      } while (newUrlsFound);

      // Phase 2: Traitement des nouvelles URLs
      const allUrls = Array.from(designers[designer].urls);
      // On ne filtre que sur les URLs déjà présentes dans output.json
      const newUrls = allUrls.filter(url => !existingUrls.has(url));

      console.log(`\n📌 Nouvelles URLs pour ${designer}: ${newUrls.length}\n`);

      browser = await launchBrowser();
      for (let i = 0; i < newUrls.length; i++) {
        const url = newUrls[i];
        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`🔗 [${i + 1}/${newUrls.length}] Traitement de l'URL : ${url}`);
        let itemResult = null;
        try {
          const [item] = await processBatch(browser, [url]);
          itemResult = item;
          if (itemResult) {
            // Mapping au format Enky
            const lienArticle = itemResult.additionalData?.finalUrl || itemResult.additionalData?.pageTitle || "";
            const dimensions = itemResult.additionalData?.dimensions_text
              ? await extractDimensionsWithAI(itemResult.additionalData.dimensions_text)
              : { largeur: null, profondeur: null, hauteur: null };
            const formattedItem = {
              "URL": itemResult.url,
              "Titre": itemResult.title,
              "Description": itemResult.description,
              "Quantité": parseInt(itemResult.quantity, 10) || 1,
              "Prix": itemResult.price,
              "Prix unitaire": itemResult.unit_price,
              "Designer": itemResult.designer,
              "Producteur": itemResult.producer,
              "Modèle": itemResult.model,
              "Période": itemResult.period,
              "Mesures": itemResult.measurements || "-",
              "Condition": itemResult.condition,
              "Nom du vendeur": itemResult.dealer_name,
              "Localisation du vendeur": itemResult.dealer_location,
              "Depuis": itemResult.dealer_since,
              "Lien vers l'article": lienArticle,
              "Lien de la photo": itemResult.image_url,
              "Les photos": Array.isArray(itemResult.additionalData?.externalImgs) ? itemResult.additionalData.externalImgs.join(",") : "",
              "Date ajoutée": new Date().toLocaleString("fr-FR"),
              "largeur": dimensions.largeur,
              "profondeur": dimensions.profondeur,
              "hauteur": dimensions.hauteur
            };

            // === FILTRES ENKY ===
            const allowedLocations = ["The Netherlands", "Belgium", "France"];
            const allowedConditions = ["Excellent", "Very Good", "Restored", "", "-", "Reupholstered"];
            const allowedDescriptions = ["Seating /", "Tables /", "Storage /", "Various / Miscellaneous"];
            // Si Prix vide, mettre SOLD
            if (!formattedItem["Prix"] || formattedItem["Prix"].toString().trim() === "") {
              formattedItem["Prix"] = "SOLD";
            }
            // Vérification des filtres (description insensible à la casse et espaces)
            const descNorm = formattedItem["Description"].toLowerCase().replace(/\s+/g, " ").trim();
            const allowedDescriptionsNorm = allowedDescriptions.map(d => d.toLowerCase());
            const isDescriptionOk = allowedDescriptionsNorm.some(desc => descNorm.includes(desc));
            const isLocationOk = allowedLocations.includes(formattedItem["Localisation du vendeur"]);
            const isConditionOk = allowedConditions.includes(formattedItem["Condition"]);
            if (!isLocationOk || !isConditionOk || !isDescriptionOk) {
              let cause = [];
              if (!isLocationOk) cause.push('localisation');
              if (!isConditionOk) cause.push('condition');
              if (!isDescriptionOk) cause.push('description');
              console.log('⛔️ Item filtré (non conforme aux critères Enky):',
                '\n  Titre:', formattedItem["Titre"],
                '\n  Description:', formattedItem["Description"],
                '\n  Localisation:', formattedItem["Localisation du vendeur"],
                '\n  Condition:', formattedItem["Condition"],
                '\n  Critères description:', allowedDescriptions,
                '\n  Description normalisée:', descNorm,
                '\n  Résultat localisation:', isLocationOk,
                '\n  Résultat condition:', isConditionOk,
                '\n  Résultat description:', isDescriptionOk,
                '\n  Cause du rejet:', cause.join(', ')
              );
              // Ajout au JSON local même si rejeté
              try {
                const rejectedItem = { ...formattedItem, rejet: true, cause_rejet: cause };
                fs.appendFileSync('output.json', JSON.stringify(rejectedItem) + '\n');
                existingUrls.add(formattedItem.URL || formattedItem.url);
                console.log('💾 [JSON] Donnée rejetée ajoutée à output.json (append)');
              } catch (error) {
                console.error('❌ [JSON] Erreur lors de l\'écriture du fichier output.json:', error.message);
              }
              continue; // On passe à l'item suivant
            }

            // Envoi à l'API Enky (optionnel, tu peux commenter si tu ne veux plus envoyer)
            try {
              const response = await axios.post(
                'https://my.enky.com/api/1.1/wf/vintage',
                [formattedItem],
                {
                  headers: {
                    'Authorization': 'Bearer cccd9fff2b82f7cd24ae3ce68564e9c6',
                    'Content-Type': 'application/json'
                  }
                }
              );
              if (response.status === 200) {
                console.log('✅ [API] Envoi réussi à Enky.');
              } else {
                console.warn(`⚠️ [API] Statut inattendu: ${response.status}`);
              }
              console.log('📝 [API] Donnée envoyée :');
              console.log(JSON.stringify(formattedItem, null, 2));
              console.log('🟢 [API] Réponse reçue :', JSON.stringify(response.data, null, 2));
            } catch (error) {
              console.error('❌ [API] Erreur lors de l\'envoi à Enky:', error.message);
            }

            // Ajout au JSON local (append ligne par ligne)
            try {
              fs.appendFileSync('output.json', JSON.stringify(formattedItem) + '\n');
              existingUrls.add(formattedItem.URL || formattedItem.url);
              console.log('💾 [JSON] Donnée ajoutée à output.json (append)');
            } catch (error) {
              console.error('❌ [JSON] Erreur lors de l\'écriture du fichier output.json:', error.message);
            }
          } else {
            console.warn('⚠️ Aucun résultat extrait pour cette URL.');
          }
        } catch (error) {
          console.error('❌ [Traitement] Erreur lors du traitement de l\'URL:', error.message);
        }
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
        await setTimeout(500); // Petite pause entre chaque URL
      }
      await browser.close();
    }

    // Mise à jour des URLs existantes avec les nouvelles (plus nécessaire ici)
    // result.forEach(item => existingUrls.add(item.url));

    console.log(`✅ Scraping terminé: ${result.length} nouveaux items collectés.`);

    return result;
  } catch (error) {
    console.error('❌ Erreur générale:', error);
    if (browser) {
      try { await browser.close(); } catch (e) { /* ignore */ }
    }
    return result;
  }
};

// Lancement du navigateur avec configuration
const launchBrowser = async () => {
  return puppeteer.launch({
    args: [
      `--proxy-server=${proxy}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu'
    ],
    headless: false,
    ignoreHTTPSErrors: true
  });
};

// Création d'une nouvelle page avec authentification
const createNewPage = async (browser) => {
  const page = await browser.newPage();
  await page.authenticate({ username, password });
  console.log('✅ Proxy authentifié pour la page.');

  // Optimisations - mais on garde les images car on en a besoin
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const resourceType = request.resourceType();
    if (resourceType === 'font' || resourceType === 'media') {
      request.abort();
    } else {
      request.continue();
    }
  });

  return page;
};

// Traitement d'un batch d'URLs
const processBatch = async (browser, batch) => {
  const batchResults = [];

  for (const url of batch) {
    console.log(`🔗 Traitement de ${url}`);
    let attempts = MAX_RETRIES;

    while (attempts > 0) {
      let page = null;

      try {
        page = await createNewPage(browser);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUT });
        console.log('🌍 Page ouverte via proxy :', url);
        await page.waitForSelector('#title h1', { timeout: 5000 }).catch(() => null);

        // Extraction des données de base
        const basicData = await page.evaluate(() => {
          const extractPrice = (priceText) => {
            const match = priceText?.match(/[\d\s,.]+/g);
            return match ? match[0].replace(/\s/g, '').replace(',', '.') : '';
          };

          const rawPrice = document.querySelector('#item_price span:nth-child(2)')?.innerText.trim() || '';
          const price = extractPrice(rawPrice);
          const rawQuantity = document.querySelector('#item_quantity span:nth-child(2)')?.innerText.trim() || '';
          const quantity = parseInt(rawQuantity.match(/\d+/)?.[0] || '1', 10);
          const unitPrice = price && quantity ? (parseFloat(price) / quantity).toFixed(2) : price;

          const websiteElement = document.querySelector('#visit_website');
          const itemUrl = websiteElement?.getAttribute('data-url') || '';
          const isAvailable = websiteElement?.innerText.includes("View item on Website") || false;

          return {
            url: window.location.href,
            title: document.querySelector('#title h1')?.innerText.trim() || '',
            description: document.querySelector('#item_description h2')?.innerText.trim() || '',
            status: document.querySelector('#item_status .green')?.innerText.trim() === "Available" ? "Available" : 'Not Available',
            quantity: quantity.toString(),
            price: price,
            unit_price: unitPrice,
            designer: document.querySelector('#item_designer span a')?.innerText.trim() || '',
            producer: document.querySelector('#item_producer span a')?.innerText.trim() || '',
            model: document.querySelector('#item_model span:nth-child(2)')?.innerText.trim() || '',
            period: document.querySelector('#item_period span:nth-child(2)')?.innerText.trim() || '',
            measurements: document.querySelector('#item_measurements span:nth-child(2)')?.innerText.trim() || '',
            condition: document.querySelector('#item_condition span:nth-child(2)')?.innerText.trim() || '',
            dealer_name: document.querySelector('#item_dealer span a')?.innerText.trim() || '',
            dealer_location: document.querySelector('#item_location span a')?.innerText.trim() || '',
            dealer_since: document.querySelector('#item_dealer_since span:nth-child(2)')?.innerText.trim() || '',
            image_url: document.querySelector('#item_image a')?.href || '',
            isAvailableOnWebsite: isAvailable
          };
        });

        // Si le produit est disponible sur le site Web externe, cliquez pour récupérer l'URL externe
        if (basicData.isAvailableOnWebsite) {
          try {
            console.log(`🌐 Tentative de récupération de l'URL externe via le clic...`);

            const websiteButton = await page.waitForSelector('#visit_website', { visible: true });

            if (websiteButton) {
              const dataUrl = await page.evaluate(el => el.getAttribute('data-url'), websiteButton);
              const fullUrl = new URL(dataUrl, page.url()).href; // Assurer que c'est une URL absolue
              console.log(`🔗 URL extraite depuis "data-url": ${fullUrl}`);

              // Préparation à la détection du nouvel onglet
              let newPage = null;
              const targetPromise = new Promise(resolve => {
                const listener = async target => {
                  if (target.type() === 'page') {
                    browser.off('targetcreated', listener); // Nettoyage
                    const p = await target.page();
                    resolve(p);
                  }
                };
                browser.on('targetcreated', listener);
              });

              await websiteButton.click();
              // Attendre max 5s l'ouverture du nouvel onglet
              try {
                newPage = await Promise.race([
                  targetPromise,
                  setTimeout(5000).then(() => null)
                ]);
              } catch (e) {
                newPage = null;
              }

              if (newPage) {
                await newPage.bringToFront();
                await newPage.waitForSelector('img', { timeout: 5000 }).catch(() => null);

                const finalUrl = newPage.url();
                console.log(`✅ URL du nouvel onglet : ${finalUrl}`);

                const additionalData = await newPage.evaluate(async () => {
                  return {
                    finalUrl: window.location.href,
                    externalImgs: Array.from(document.querySelectorAll('img'))
                      .map(img => img.src)
                      .filter(src => src && /\.(jpe?g|png)$/i.test(src)),
                    dimensions_text: document.body.innerText
                  };
                });

                console.log(`✅ Données extraites: ${JSON.stringify(additionalData, null, 2)}`);

                // Ajouter les données additionnelles au basicData
                basicData.additionalData = additionalData;
                await newPage.close();
              } else {
                console.log('❌ Aucun nouvel onglet détecté (headless). Fallback sur data-url.');
                basicData.additionalData = { finalUrl: fullUrl, externalImgs: [] };
              }
            } else {
              console.log('❌ Bouton "View item on Website" introuvable.');
            }

          } catch (error) {
            console.error(`❌ Erreur lors de la récupération de l'URL externe: ${error.message}`);
            basicData.externalError = error.message;
          }
        }

        batchResults.push(basicData);
        console.log(`✅ Données extraites pour: ${basicData.title}`);

        if (page) await page.close();
        break; // Sortir de la boucle de tentatives si réussi
      } catch (error) {
        attempts--;
        console.error(`❌ Erreur sur ${url}. Tentatives restantes: ${attempts}. Erreur: ${error.message}`);

        if (page) {
          try { await page.close(); } catch (e) { /* ignore */ }
        }

        if (attempts === 0) {
          console.warn(`⚠️ Échec après ${MAX_RETRIES} tentatives pour ${url}`);
          // Ajouter une entrée minimale pour éviter de retenter cette URL
          batchResults.push({
            url,
            title: 'ERROR - Failed to scrape',
            error: error.message,
            timestamp: new Date().toISOString()
          });
        }

        await setTimeout(1000); // Pause avant nouvelle tentative
      }
    }
  }

  return batchResults;
};

// Fonction principale
async function main() {
  console.log('🚀 Démarrage du script Enky...');
  await scrapeData();
}

// Exécution immédiate
main();

// Configuration du cron pour s'exécuter tous les jours à 8h00
cron.schedule('0 8 * * *', () => {
  console.log('🕒 Exécution planifiée du scraping Enky...');
  main();
});

// Gestion des erreurs non capturées
process.on('uncaughtException', (error) => {
  console.error('❌ Erreur non capturée:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Promesse rejetée non gérée:', error);
});