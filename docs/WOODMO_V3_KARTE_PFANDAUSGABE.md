# WOODMO V3 – Kartenzahlung mit Pfand-Retoure

**Stand:** 14.11.2026 · **Vorgabe:** Betreiber · **Umsetzung:** `src/lib/checkoutTransactions.ts`

## Regel

| Bon enthält | Zahlungsart | Gebucht wird | Kassenbestand (bar) | Karte |
|---|---|---|---|---|
| nur Ware | Bar | 1 Barbeleg | + Betrag | – |
| nur Ware | Karte | 1 Kartenbeleg | unverändert | + Betrag |
| Ware + Pfand-Retoure | Bar | 1 Barbeleg, verrechnet (Gast zahlt nur die Differenz) | + Saldo | – |
| **Ware + Pfand-Retoure** | **Karte** | **2 Belege:** Kartenbeleg (Ware inkl. Ware-Pfand) **und** Barbeleg „Pfandausgabe“ (nur Retoure) | **− Retoure** (bar ausgezahlt) | **+ Ware inkl. Pfand** |
| nur Pfand-Retoure | (egal) | 1 Barbeleg „Pfandausgabe“ | − Retoure | – |

Beide Belege einer geteilten Zahlung tragen dieselbe `paymentSplitId`
(`paymentSplitRole`: `card-goods` bzw. `cash-pfand-payout`). Sie werden in **einem**
IndexedDB-Schritt gespeichert: entweder beide oder keiner.

## Beispiel (Bregenz, 20 % MwSt)
2× Glühwein Weiß (4,50 € + 3,00 € Pfand) und 5× Pfand-Retoure (−15,00 €):

| Beleg | Zahlungsart | Umsatz | MwSt | Pfand | Betrag |
|---|---|---|---|---|---|
| Kartenbeleg | Karte | 9,00 € | 1,50 € | +6,00 € | **15,00 €** |
| Pfandausgabe | Bar | 0,00 € | 0,00 € | −15,00 € | **−15,00 €** |

Kassenbestand −15,00 €, Kartenumsatz +15,00 €, Saldo 0,00 €.

## Anzeige im Bezahldialog
Bei Karte mit Retoure steht „Per Karte“ (Ware inkl. Pfand) und darunter „Pfand bar auszahlen“.
Die Bestätigung zeigt „Karte belasten“ und „Pfand bar auszahlen“, Zahlungsart „Karte + Pfandausgabe bar“.

## Warum
- Ein Kartenterminal kann weder 0 € noch negative Beträge sinnvoll abbuchen; der Gast bekommt Pfand in der Praxis bar.
- Vorher: Karte + Retoure ergab eine einzige verrechnete Kartenbuchung (z. B. 0 € oder sogar negativ) – Bargeld floss aus der Kasse, ohne im Kassenbestand zu erscheinen.
- Der Pfandausgabe-Beleg hat genau die Form, die die Backup-Wiederherstellung (`20261114080000`) für negative Barbelege erlaubt.

## Tests
`scripts/check-v3-card-pfand-split.mjs` (in `npm test`): Rechnung, Kassenbestand, unveränderte Altfälle, Backup-Wiederherstellung in PGlite.

## Bekannte Folgepunkte
- Tagesabschluss zählt reine Pfandausgaben in „Verkäufe“ mit (Befund 13) – betrifft auch diese Belege.
- Storno: Kartenbeleg und Pfandausgabe werden getrennt storniert.
