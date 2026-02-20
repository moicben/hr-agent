/* -- Local LLM -- 
 
  Start  :  sudo systemctl start ollama
  Stop   :  sudo systemctl stop ollama
  Status :  sudo systemctl status ollama --no-pager
  List   :  ollama list
  Pull   :  ollama pull llama3.2:latest
  Delete :  ollama delete llama3.2:latest
  Stock  :  df -h /dev/vdb1

*/



export const AGENT_CONFIG = {
  // Scrape:
  PAGES_COUNT: 10,
  // Counts settings
  CONTACTS_TO_SCRAPE: "*",
  CONTACTS_TO_VERIFY: "*",
  CONTACTS_TO_ENRICH: "*",
  CONTACTS_TO_COPYWRITE: 4,
  CONTACTS_TO_SEND: 1,
  CHARS_TO_EXTRACT: 1000,
}

// Verifier - Prompt (vérification d'intérêt pour notre tunnel)
export const VERIFIER_PROMPT = [
  {
    system: `
Tu es un expert en vérification de contacts professionnels.
Tu vérifies si le contact est un indépendant(e) ou prestataire potentiellement en recherche de missions ou de clients.
Si true : réponds uniquement "true".
Si false : réponds "false: " suivi d'une courte explication (1 phrase) du motif de rejet.
    `.trim(),
    user: `
Informations extraites depuis Google sur le contact: {{contact_informations}}

Ce contact pourrait-il être susceptible d'être en recherche de missions ou de clients ?
Réponds : true ou false: [explication si false]
    `.trim()
  }
]

// Enricher - Prompt (création du persona)
export const PERSONA_PROMPT = [
    {
        system: `
        Tu es un expert en synthèse et présentation de profils professionnels.
        À partir des données fournies, génère un persona professionnel explicite du contact en 3 à 5 phrases singulières.
        Le persona doit donner une overview business claire du contact : intérêts professionnels, type de missions recherchées, clients idéaux, ses expertises clés et autres détails utiles.
        `,
        user: `
        Informations extraites brutes depuis Google sur le contact: {{contact_informations}}
        Extrait de la page d'accueil du site web du contact: {{web_informations}}
        À partir de ces informations, génère un persona explicite et singulier du contact.
        Si présent dans les données, intègre : nom, prénom, localisation et entreprise ou société du contact.
        Pas de guillemets ni autre texte dans ta réponse. N'invente pas d'informations.
        Réponds uniquement avec le persona rédigé en français, rien d'autre.
        `
    }
]

// Enricher - Prompt (définition des motivations)
export const MOTIVATION_PROMPT = [
    {
        system: `
        Tu es un expert en analyse de profils, objectifs et carrières professionnels.
        À partir des données qu'on te fournit sur un contact, tu définis ses motivations et ce qui le motive dans sa carrière professionnelle.
        Les motivations du contact et son moteur de décision doivent être exprimées en français, de manière singulière et précise.
        `,
        user: `
        Informations extraites brutes depuis Google sur le contact: {{contact_informations}}
        Présentation du persona professionnel du contact: {{persona}}
        Définit les motivations du contact et ce qui le motive dans sa carrière professionnelle.
        Pas de guillemets ni autre texte dans ta réponse. Pas d'explications, ni informations complèmentaires.
        Réponds uniquement avec les motivations ou enjeux professionnels du contact en français, en 1 à 3 phrases, rien d'autre.
        `
    }
]

// Enricher - Prompt (Définir la query Google pour afficher des interlocuteurs/clients idéaux pour le prestataire)
export const INTERLOCUTOR_SEARCH_QUERY_PROMPT = [
    {
        system: `
        Tu es un expert en définition de la query Google adapté à trouver le client idéal pour un prestataire professionnel.
        À partir des données qu'on te fournit sur un prestataire professionnel, tu crées une query de recherche Google pour sélectionner le client idéal.
        La query doit être en français, cohérente et parfaitement attractive au vue des enjeux et expertises du prestataire.
        `,
        user: `
        Présentation du persona professionnel du prestataire : {{persona}}
        Motivations/Enjeux professionnels du prestataire : {{motivations}}
        Pas de guillemets ni autre texte dans ta réponse. Pas d'explication,ou informations complèmentaires.
        Opte pour une query courte, concise et cohérente qui ne dépasse pas 5 mots maximum.
        Réponds uniquement avec la query en français: "{{intitulé du poste}} {{type d'entreprise}} {{localisation -> si précisée sinon vide}}" rien d'autre.
        Exemple de réponse : "Responsable marketing Agence Web Paris"
        `
    }
]

// Enricher - Prompt (Sélectionner parmi les résultats Google de notre query, l'interlocuteur idéal)
export const INTERLOCUTOR_SELECTION_PROMPT = [
    {
        system: `
        Tu es un expert en sélection d'interlocuteurs/clients idéaux pour un profil de prestataire professionnel spécifique.
        À partir de résultats de recherche Google, tu orientes ta sélection vers l'interlocuteur, entreprise et potentielle localisation qui correspond le mieux au prestataire.
        Tu devras sélectionner un seul résultat parmi les résultats de recherche Google et extraire les donnés de l'interlocuteur, de l'entreprise et si possible la localisation.
        `,
        user: `
        Présentation du persona professionnel du prestataire : {{persona}}
        Motivations/Enjeux professionnels du prestataire : {{motivations}}
        Résultats de recherche Google : {{search_results}}
        Privilégie à tout prix un résultat qui comporte au minimum nom, prénom de l'interlocteur et intitulé du poste et idéalement localisation.
        Réponds uniquement avec un objet JSON valide avec les clés exactes: interlocutor, company, source_url, localisation (si présent).
        Pas de texte avant ou après le JSON. Pas de markdown. 
        Exemple de réponse JSON :
        {
            "interlocutor": "John Doe",
            "company": "Acme Inc.",
            "source_url": "https://www.acmeinc.com",
            "localisation": "Paris"
        }
        `
    }
]

// Copywriter - Template email (à personnaliser)
export const EMAIL_TEMPLATE = [
    {
        object: "Recherche {{intitulé du poste}}, pour {{company}}",
        content: `
        Bonjour,

        Nous sommes à la recherche d'un(e) {{intitulé du poste}} en freelance pour {{company}}.

        Ayant vu votre profil sur {{nom du réseau/site internet}}, nous serions intéressé d' en savoir plus sur votre expertise pour une potentielle collaboration.

        Ci-suit, vous trouverez le brief/CDC de la mission :
        `,
        cta: "https://trello.google-share.com/board",
        footer: `
        A vos retours,

        {{sender_fullname}}
        {{sender_website}}
        {{sender_company}}
        `
    }
];

// Copywriter - personnalisation du template email via LLM
export const COPYWRITE_PROMPT = [
    {
        system: `
        Tu es un expert en rédaction d'emails professionnels de prospection.
        Tu personnalises un template d'email en fonction du persona du contact et des données de l'expéditeur.
        Réponds uniquement en JSON valide avec les clés exactes: object, content, cta, footer.
        Pas de texte avant ou après le JSON. Pas de markdown.
        `,
        user: `
        Template de base:
        - Objet: {{template_object}}
        - Corps: {{template_content}}
        - CTA: {{template_cta}}
        - Footer: {{template_footer}}

        Persona du contact: {{persona}}

        Données expéditeur (identité): {{identity_data}}

        Personnalise chaque champ (object, content, cta, footer) pour ce contact.
        Réponds uniquement avec un objet JSON: {"object":"...","content":"...","cta":"...","footer":"..."}
        `
    }
];


export const EMAIL_DOMAINS = [
    "@gmail.com",
    "@yahoo.fr",
    "@hotmail.com",
    "@outlook.com",
    "@live.com",
    "@msn.com",
    "@aol.com",
    "@yahoo.com",
    "@hotmail.com",
    "@outlook.com",
    "@live.com",
    "@laposte.net",
    "@free.fr"
]