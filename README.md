# Mail Inviate

Dashboard locale e script Gmail API per analizzare le email inviate e generare un dataset JSON compatibile con la pagina HTML.

## Cosa contiene

- `mail_stats.html`
  Dashboard locale per analizzare orari di invio, heatmap settimanale, destinatari, domini, filtri per anno ed export CSV.
- `scripts/export_sent_emails.mjs`
  Script Node.js che usa Gmail API e OAuth per esportare le mail inviate.
- `scripts/sync_sent_emails.sh`
  Wrapper semplice per lanciare l'export con un solo comando.

## Requisiti

- Node.js installato
- Un progetto Google Cloud con Gmail API abilitata
- Un OAuth client di tipo Desktop App

## File sensibili

Questi file devono restare solo in locale e sono esclusi da git:

- `credentials.json`
- `token.json`
- `sent_emails.json`
- `sent_emails_all_years.json`
- `.gmail_export_checkpoint.json`

## Setup OAuth Google

1. Apri Google Cloud Console.
2. Crea o seleziona un progetto.
3. Abilita `Gmail API`.
4. Vai in `APIs & Services` -> `OAuth consent screen` e completa la configurazione.
5. Vai in `APIs & Services` -> `Credentials`.
6. Crea `OAuth client ID`.
7. Scegli `Desktop app`.
8. Scarica il file JSON.
9. Rinominalo in `credentials.json`.
10. Mettilo nella cartella del progetto.

Percorso atteso:

```bash
/Users/tonga/Downloads/mail-inviate/credentials.json
```

## Installazione

```bash
npm install
```

## Generare il JSON completo delle mail inviate

Comando consigliato:

```bash
npm run gmail:sync
```

In alternativa:

```bash
./scripts/sync_sent_emails.sh
```

Alla prima esecuzione:

1. si apre il browser per il login Google
2. autorizzi l'accesso in sola lettura a Gmail
3. viene creato `token.json`
4. viene generato `sent_emails_all_years.json`

Output atteso:

- `sent_emails_all_years.json`
  Dataset completo nello stesso formato usato dalla dashboard

## Checkpoint e ripresa

Se l'export viene interrotto o Gmail impone limiti temporanei, lo script salva lo stato in:

```bash
.gmail_export_checkpoint.json
```

Al prossimo avvio con lo stesso comando, riprende automaticamente da dove si era fermato.

## Uso della dashboard

Apri:

```bash
mail_stats.html
```

La pagina può:

- aprire manualmente un file JSON
- filtrare per anno o intervallo di anni
- escludere destinatari o domini
- mostrare la heatmap settimanale anche per un anno specifico
- esportare in CSV i dati attualmente filtrati

## Formato JSON atteso

Il file generato segue questa struttura:

```json
{
  "description": "Email inviate da example@gmail.com",
  "period": {
    "from": "2006-11-08T08:22:08.000Z",
    "to": "2026-04-23T17:50:10.000Z"
  },
  "total_messages": 19030,
  "messages": [
    {
      "date": "2024-01-10T09:14:00.000Z",
      "to": ["destinatario@example.com"]
    }
  ]
}
```

## Note

- `sent_emails_all_years.json` è il file consigliato per analisi storiche complete.
- `sent_emails.json` può essere usato come dataset più piccolo o parziale.
- I file con dati personali non vengono più committati nel repository.
