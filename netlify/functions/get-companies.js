// Importe le Client depuis la librairie HubSpot en utilisant la syntaxe ES Modules
import { Client } from '@hubspot/api-client';
import { verifyAccessOrResponse } from './auth-shared.js';

// Le système de cache pour les entreprises
let cachedCompanies = null;
let cacheTimestamp = 0;
const CACHE_DURATION_MINUTES = 30; // Cache réduit à 30 minutes pour des données plus fraîches
const COMPANIES_PER_PAGE = 20; // Pagination côté serveur

// La fonction est maintenant un "export default"
export default async (request, context) => {
    const authError = verifyAccessOrResponse(request);
    if (authError) return authError;

    // Récupérer les paramètres de pagination depuis l'URL
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page')) || 1;
    const limit = parseInt(url.searchParams.get('limit')) || COMPANIES_PER_PAGE;
    const search = url.searchParams.get('search') || '';
    const region = url.searchParams.get('region') || '';
    const secteur = url.searchParams.get('secteur') || '';
    const taille = url.searchParams.get('taille') || '';
    const hasImpactScore = url.searchParams.get('hasImpactScore') === 'true';
    const impact40120 = (url.searchParams.get('impact40120') || '').trim();
    const sortBy = url.searchParams.get('sortBy') || 'default';
    
    // On vérifie le cache
    const now = Date.now();
    if (cachedCompanies && (now - cacheTimestamp < CACHE_DURATION_MINUTES * 60 * 1000)) {
        console.log("Servi depuis le cache.");
        
        // Appliquer les filtres côté serveur si demandé
        let filteredCompanies = cachedCompanies;
        
        if (search || region || secteur || taille || hasImpactScore || impact40120) {
            filteredCompanies = cachedCompanies.filter(company => {
                // Filtre par recherche textuelle
                if (search) {
                    const name = (company.name || '').toLowerCase();
                    const secteurComplet = (company.secteur_d_activite || '').toLowerCase();
                    const secteurName = secteurComplet.split(';')[0].trim();
                    const regionName = (company.region___standardise || '').toLowerCase();
                    const website = (company.website || '').toLowerCase();
                    
                    const matchesSearch = name.includes(search.toLowerCase()) || 
                                        secteurName.includes(search.toLowerCase()) || 
                                        regionName.includes(search.toLowerCase()) || 
                                        website.includes(search.toLowerCase());
                    
                    if (!matchesSearch) return false;
                }
                
                // Filtres par sélection
                if (region && company.region___standardise !== region) return false;
                if (secteur) {
                    const secteurComplet = company.secteur_d_activite || '';
                    const secteurName = secteurComplet.split(';')[0].trim();
                    if (secteurName !== secteur) return false;
                }
                if (taille && company.hs_employee_range !== taille) return false;
                
                // Filtre par Impact Score réalisé
                if (hasImpactScore) {
                    const hasScore = company.note_impact_score && 
                                    company.note_impact_score_publique === 'Oui';
                    if (!hasScore) return false;
                }

                // Filtre Impact 40/120 (valeur exacte)
                if (impact40120) {
                    const v = (company.impact_40_120 || '').trim();
                    if (v !== impact40120) return false;
                }
                
                return true;
            });
        }
        
        // Tri selon le paramètre sortBy
        const sortedCompanies = filteredCompanies.sort((a, b) => {
            if (sortBy === 'score_asc') {
                // Tri par Impact Score croissant (0→100)
                const scoreA = parseFloat(a.note_impact_score) || -1; // -1 pour les entreprises sans score
                const scoreB = parseFloat(b.note_impact_score) || -1;
                if (scoreA === scoreB) {
                    // En cas d'égalité, trier par nom
                    const nameA = (a.name || '').trim().toLowerCase();
                    const nameB = (b.name || '').trim().toLowerCase();
                    return nameA.localeCompare(nameB, 'fr');
                }
                return scoreA - scoreB;
            } else if (sortBy === 'score_desc') {
                // Tri par Impact Score décroissant (100→0)
                const scoreA = parseFloat(a.note_impact_score) || -1; // -1 pour les entreprises sans score
                const scoreB = parseFloat(b.note_impact_score) || -1;
                if (scoreA === scoreB) {
                    // En cas d'égalité, trier par nom
                    const nameA = (a.name || '').trim().toLowerCase();
                    const nameB = (b.name || '').trim().toLowerCase();
                    return nameA.localeCompare(nameB, 'fr');
                }
                return scoreB - scoreA;
            } else {
                // Tri par défaut (alphabétique A-Z)
                const nameA = (a.name || '').trim().toLowerCase();
                const nameB = (b.name || '').trim().toLowerCase();
                return nameA.localeCompare(nameB, 'fr');
            }
        });
        
        // Pagination
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedCompanies = sortedCompanies.slice(startIndex, endIndex);
        
        const response = {
            companies: paginatedCompanies,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(sortedCompanies.length / limit),
                totalItems: sortedCompanies.length,
                itemsPerPage: limit
            }
        };
        
        // Compression et optimisation de la réponse
        const jsonResponse = JSON.stringify(response);
        
        return new Response(jsonResponse, {
            headers: { 
                "Content-Type": "application/json",
                "Cache-Control": "no-store",
                "ETag": `"${Buffer.from(jsonResponse).toString('base64').slice(0, 16)}"` // ETag pour le cache
            },
        });
    }
    
    console.log("Cache périmé. Récupération depuis HubSpot...");

    // On récupère les secrets avec Netlify.env.get()
    const HUBSPOT_ACCESS_TOKEN = Netlify.env.get("HUBSPOT_ACCESS_TOKEN");
    const HUBSPOT_COMPANY_LIST_ID = Netlify.env.get("HUBSPOT_COMPANY_LIST_ID") || "412";

    if (!HUBSPOT_ACCESS_TOKEN || !HUBSPOT_COMPANY_LIST_ID) {
        return new Response(JSON.stringify({ error: "Variables d'environnement HubSpot manquantes." }), {
            status: 500,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
    }

    // L'instanciation du client HubSpot ne change pas
    const hubspotClient = new Client({ accessToken: HUBSPOT_ACCESS_TOKEN });

    // Les propriétés des entreprises que tu veux récupérer
    const propertiesToGet = [
        "name", 
        "domain",
        "secteur_d_activite",
        "hs_employee_range",
        "region___standardise",
        "website",
        "note_impact_score",
        "note_impact_score_publique",
        "hs_logo_url",
        "impact_40_120"
    ];

    try {
        let allCompanies = [];
        let after = undefined;
        
        console.log("Récupération des entreprises de la liste spécifique:", HUBSPOT_COMPANY_LIST_ID);
        
        // Utilisation de l'API REST directe de HubSpot pour récupérer les entreprises d'une liste
        try {
            console.log("Récupération des entreprises de la liste ID:", HUBSPOT_COMPANY_LIST_ID);
            
            // Utilisons l'API REST v3 de HubSpot avec token d'accès pour les entreprises
            const listCompaniesUrl = `https://api.hubapi.com/crm/v3/lists/${HUBSPOT_COMPANY_LIST_ID}/memberships`;
            
            let after = undefined;
            const limit = 100; // Limite maximale de HubSpot
            
            do {
                let url = `${listCompaniesUrl}?limit=${limit}`;
                if (after) {
                    url += `&after=${after}`;
                }
                
                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
                        'Content-Type': 'application/json'
                    }
                });
                
                if (!response.ok) {
                    throw new Error(`Erreur API HubSpot: ${response.status} ${response.statusText}`);
                }
                
                const data = await response.json();
                
                if (data.results && data.results.length > 0) {
                    // Récupérons les IDs des entreprises (le champ s'appelle recordId)
                    const companyIds = data.results.map(member => member.recordId).filter(id => id);
                    
                    if (companyIds.length > 0) {
                        // Traitement par lots pour éviter les limites de l'API
                        const batchSize = 100; // Limite de HubSpot pour les requêtes batch
                        for (let i = 0; i < companyIds.length; i += batchSize) {
                            const batch = companyIds.slice(i, i + batchSize);
                            
                            try {
                                const companiesDetails = await hubspotClient.crm.companies.batchApi.read({
                                    inputs: batch.map(id => ({ id: id.toString() })),
                                    properties: propertiesToGet
                                });
                                
                                const formattedCompanies = companiesDetails.results.map(c => ({
                                    ...c.properties,
                                    hubspotId: c.id
                                }));
                                allCompanies.push(...formattedCompanies);
                                
                                // Petit délai pour éviter de surcharger l'API
                                if (i + batchSize < companyIds.length) {
                                    await new Promise(resolve => setTimeout(resolve, 100));
                                }
                                
                            } catch (batchError) {
                                console.error(`Erreur lors du traitement du lot ${i}-${i + batchSize}:`, batchError);
                                // Continuer avec le lot suivant même en cas d'erreur
                            }
                        }
                        
                        console.log(`Récupéré ${companyIds.length} entreprises de la liste (total: ${allCompanies.length})`);
                    }
                    
                    // Vérifier s'il y a plus d'entreprises
                    after = data.paging?.next?.after;
                } else {
                    break;
                }
                
            } while (after && allCompanies.length < 5000); // Limite pour éviter les timeouts
            
            if (allCompanies.length === 0) {
                console.log("Aucune entreprise trouvée dans la liste. Vérifiez l'ID de liste:", HUBSPOT_COMPANY_LIST_ID);
            }
            
        } catch (error) {
            console.error("Erreur lors de la récupération:", error);
            throw new Error(`Impossible de récupérer les entreprises de la liste ${HUBSPOT_COMPANY_LIST_ID}: ${error.message}`);
        }
        
        console.log(`Récupération terminée. ${allCompanies.length} entreprises de la liste spécifique.`);

        // Mise à jour du cache
        cachedCompanies = allCompanies;
        cacheTimestamp = Date.now();
        console.log(`Récupération réussie. ${allCompanies.length} entreprises mises en cache.`);

        // Appliquer les filtres si demandé
        let filteredCompanies = allCompanies;
        
        if (search || region || secteur || taille || hasImpactScore || impact40120) {
            filteredCompanies = allCompanies.filter(company => {
                // Filtre par recherche textuelle
                if (search) {
                    const name = (company.name || '').toLowerCase();
                    const secteurComplet = (company.secteur_d_activite || '').toLowerCase();
                    const secteurName = secteurComplet.split(';')[0].trim();
                    const regionName = (company.region___standardise || '').toLowerCase();
                    const website = (company.website || '').toLowerCase();
                    
                    const matchesSearch = name.includes(search.toLowerCase()) || 
                                        secteurName.includes(search.toLowerCase()) || 
                                        regionName.includes(search.toLowerCase()) || 
                                        website.includes(search.toLowerCase());
                    
                    if (!matchesSearch) return false;
                }
                
                // Filtres par sélection
                if (region && company.region___standardise !== region) return false;
                if (secteur) {
                    const secteurComplet = company.secteur_d_activite || '';
                    const secteurName = secteurComplet.split(';')[0].trim();
                    if (secteurName !== secteur) return false;
                }
                if (taille && company.hs_employee_range !== taille) return false;
                
                // Filtre par Impact Score réalisé
                if (hasImpactScore) {
                    const hasScore = company.note_impact_score && 
                                    company.note_impact_score_publique === 'Oui';
                    if (!hasScore) return false;
                }

                // Filtre Impact 40/120 (valeur exacte)
                if (impact40120) {
                    const v = (company.impact_40_120 || '').trim();
                    if (v !== impact40120) return false;
                }
                
                return true;
            });
        }
        
        // Tri selon le paramètre sortBy
        const sortedCompanies = filteredCompanies.sort((a, b) => {
            if (sortBy === 'score_asc') {
                // Tri par Impact Score croissant (0→100)
                const scoreA = parseFloat(a.note_impact_score) || -1; // -1 pour les entreprises sans score
                const scoreB = parseFloat(b.note_impact_score) || -1;
                if (scoreA === scoreB) {
                    // En cas d'égalité, trier par nom
                    const nameA = (a.name || '').trim().toLowerCase();
                    const nameB = (b.name || '').trim().toLowerCase();
                    return nameA.localeCompare(nameB, 'fr');
                }
                return scoreA - scoreB;
            } else if (sortBy === 'score_desc') {
                // Tri par Impact Score décroissant (100→0)
                const scoreA = parseFloat(a.note_impact_score) || -1; // -1 pour les entreprises sans score
                const scoreB = parseFloat(b.note_impact_score) || -1;
                if (scoreA === scoreB) {
                    // En cas d'égalité, trier par nom
                    const nameA = (a.name || '').trim().toLowerCase();
                    const nameB = (b.name || '').trim().toLowerCase();
                    return nameA.localeCompare(nameB, 'fr');
                }
                return scoreB - scoreA;
            } else {
                // Tri par défaut (alphabétique A-Z)
                const nameA = (a.name || '').trim().toLowerCase();
                const nameB = (b.name || '').trim().toLowerCase();
                return nameA.localeCompare(nameB, 'fr');
            }
        });
        
        // Pagination
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedCompanies = sortedCompanies.slice(startIndex, endIndex);
        
        const response = {
            companies: paginatedCompanies,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(sortedCompanies.length / limit),
                totalItems: sortedCompanies.length,
                itemsPerPage: limit
            }
        };

        // Compression et optimisation de la réponse
        const jsonResponse = JSON.stringify(response);
        
        // On retourne la nouvelle liste avec une réponse standard
        return new Response(jsonResponse, {
            headers: { 
                "Content-Type": "application/json",
                "Cache-Control": "no-store",
                "ETag": `"${Buffer.from(jsonResponse).toString('base64').slice(0, 16)}"` // ETag pour le cache
            },
        });

    } catch (e) {
        console.error("Erreur HubSpot:", e);
        return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
    }
};