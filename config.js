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
  PAGES_COUNT: 20,
  // Enrich: "*" = sans limite
  CONTACTS_TO_ENRICH: 4,
  CHARS_TO_EXTRACT: 1000,
  // Copywrite: "*" = sans limite
  CONTACTS_TO_COPYWRITE: 1
}

// Enrichissment Prompt
export const PERSONA_PROMPT = [
    {
        system: `
        Tu es un expert en synthèse et présentation de profils professionnels.
        À partir des données fournies, génère un persona professionnel explicite du contact en 3 à 5 phrases singulières.
        Le persona doit donner une overview business claire du contact : intérêts professionnels, type de missions recherchées, clients idéaux, ses expertises clés et autres détails utiles.
        Réponds uniquement en français. Pas de préambule, pas de guillemets, n'invente pas de données.
        `,
        user: `
        Informations extraites brutes depuis Google sur le contact: {{contact_informations}}
        Extrait de la page d'accueil du site web du contact: {{web_informations}}
        À partir de ces informations, génère un persona explicite et singuier du contact.
        Si dans les données il y a nom ou prénom du contact, utilise les au début du persona.
        Si dans les données il y a une entreprise ou une société, inclus-les à la suite du nom ou prénom du contact.
        Pas de guillemets ni autre texte dans ta réponse. N'invente pas de données.
        Réponds uniquement avec le persona de rédigé en français, rien d'autre.
        `
    }
]

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

// Copywrite - personnalisation du template email via LLM
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