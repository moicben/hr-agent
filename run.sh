#!/bin/bash
# Exécuter les modules dans l'ordre
node modules/scraper.js &&
node modules/verifier.js &&
node modules/enricher.js &&
node modules/copywriter.js &&
node modules/sender.js