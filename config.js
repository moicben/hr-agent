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
  PAGES_COUNT: 15,
  REQUEST_DELAY_MIN_MS: 2000,
  REQUEST_DELAY_MAX_MS: 6000,
  // Enrich
  CHARS_TO_EXTRACT: 1000,
  // Counts settings
  CONTACTS_TO_SCRAPE: "*",
  CONTACTS_TO_VERIFY: "*",
  CONTACTS_TO_ENRICH: "*",
  CONTACTS_TO_COPYWRITE: "*",
  CONTACTS_TO_SEND: "*",
  
}

// Verifier - Prompt (vérification d'intérêt pour notre tunnel)
export const VERIFIER_PROMPT = [
  {
    system: `
Tu es un expert en vérification de contacts professionnels.
Tu vérifies si le contact estprestataire potentiellement en recherche de missions ou de clients.
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

// Copywriter - Template email (à personnaliser)
// content = corps complet (intro + CTA + signature)
export const EMAIL_TEMPLATE = [
    {
        object: "Recherche {{intitulé du poste en 2 mots max}} Freelance - {{company}}",
        content: `
Bonjour {{prenom du contact}},

Nous sommes à la recherche d'un(e) {{intitulé du poste}} en freelance pour {{description en 4 à 8 mots de la mission}}.

Ayant passé en revu votre expérience sur {{nom du réseau/site internet}}, nous pensons que vous pourriez être un bon match pour nos besoins.

Ci-suit, vous trouverez notre cahier des charges : https://trello.google-share.com

A vos retours,

{{sender_fullname}}
{{sender_company}}
        `.trim()
    }
];

// Copywriter - personnalisation du template email via LLM
export const COPYWRITE_PROMPT = [
    {
        system: `
        Tu es un expert en rédaction d'emails professionnels de prospection.
        Tu personnalises un template d'email en fonction du persona du contact et des données de l'expéditeur.
        Réponds uniquement en JSON valide avec les clés exactes: object, content.
        Pas de texte avant ou après le JSON. Pas de markdown.
        `.trim(),
        user: `
        Template de base:
        - object: {{template_object}}
        - content: {{template_content}}

        Persona du contact: {{persona}}

        Données expéditeur (identité): {{identity_data}}

        Personnalise chaque champ (object, content) pour ce contact. Le content inclut tout le corps de l'email (intro, CTA, signature).
        Réponds uniquement avec un objet JSON: {"object":"...","content":"..."}
        `.trim()
    }
];


export const EMAIL_DOMAINS = [
    "@gmail.com",
    "@yahoo.fr",
    "@msn.com",
    "@yahoo.com",
    "@hotmail.com",
    "@outlook.com",
    "@laposte.net"
]