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
  // Counts settings
  CONTACTS_TO_SCRAPE: "*",
  CONTACTS_TO_VERIFY: "*",
  CONTACTS_TO_SEND: 500,
  
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

// Copywriter - Template email (à personnaliser)
// content = corps complet (intro + CTA + signature)
export const EMAIL_TEMPLATE = [
    {
        object: "Recherche Freelance - {{company}}",
        content: `
Bonjour,

Nous sommes à la recherche d'un freelance en remote pour nous assister sur les prochains mois.

Ayant trouvé votre profil sur {{url}}, nous pensons que vous pourriez être un bon match pour nos besoins.

Ci-suit, l'accès à notre board Trello avec les ressources du projet : <a href='https://trello.google-share.com/magic-link?contactId={{contactId}}&invite=34fjev3dHve3x9ve'>{{company}} Pipeline 2026</a>

A vos retours,

{{sender_fullname}}
{{sender_company}}
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