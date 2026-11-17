#!/usr/bin/env python3
"""WOODMO – Korrekturblatt Pfand-MwSt zu einem Tagesabschluss.

Liest ein Voll-Backup (kasse-backup-JJJJ-MM-TT.json) NUR LESEND und erzeugt je
abgeschlossener Kassensitzung ein PDF, das man zum Original-Tagesabschluss legt.
Das Original bleibt unverändert. Keine Passwortdaten aus dem Backup werden ausgegeben.

Rechenweg (siehe Projektdoc claude/auftrag-korrekturblatt-pfand-mwst.md):
- Pfand beim Verkauf teilt den Steuersatz des Getränks (Satz der Bon-Zeile).
- Pfand-Rückgabe = Entgeltminderung mit dem Satz der ursprünglichen Ware.
  Gibt es am Standort/Tag nur EINEN Satz für Pfandverkäufe, ist er eindeutig.
  Bei mehreren Sätzen wird anteilig nach den Pfandverkäufen des Tages verteilt
  (Annahme, im Blatt ausgewiesen).
- Werte laut App = eingefrorene Bon-Werte (taxByRate/totalNet), unverändert.

Aufruf: python3 pfand-korrekturblatt.py BACKUP.json AUSGABEORDNER [JJJJ-MM-TT ...]
Ohne Datum: alle abgeschlossenen Tage im Backup, die noch im alten Format gebucht sind.
"""
import hashlib
import json
import sys
from collections import defaultdict
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from zoneinfo import ZoneInfo

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

TZ = ZoneInfo('Europe/Berlin')
D0 = Decimal('0')
CENT = Decimal('0.01')


def dec(x) -> Decimal:
    return Decimal(str(x)) if x is not None else D0


def r2(x: Decimal) -> Decimal:
    return x.quantize(CENT, rounding=ROUND_HALF_UP)


def eur(x: Decimal) -> str:
    q = r2(x)
    s = f'{abs(q):,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
    return ('−' if q < 0 else '') + s + ' €'


def ts(ms) -> str:
    return datetime.fromtimestamp(ms / 1000, TZ).strftime('%d.%m.%Y, %H:%M:%S Uhr')


def net_of(gross: Decimal, rate: Decimal) -> Decimal:
    return gross / (1 + rate / 100)


def analyse_session(session, txs, stornos):
    """Return per-rate figures for one cash session."""
    sid = session['id']
    stx = [t for t in txs if t.get('cashSessionId') == sid]
    sst = [s for s in stornos if (s.get('cashSessionId') or s.get('originalSnapshot', {}).get('cashSessionId')) == sid]

    app = defaultdict(lambda: {'gross': D0, 'tax': D0})      # Ware laut App (ohne Pfand)
    pfand_sold = defaultdict(lambda: D0)                      # Pfand-Verkauf brutto je Satz
    returned = D0                                             # Pfand-Rückgabe brutto (positiv)
    pfand_cash_in = D0
    pfand_card_in = D0
    receipts = len(stx)

    def add_tx(t, sign: int):
        nonlocal returned, pfand_cash_in, pfand_card_in
        new_format = 'pfandTaxByRate' in t
        for it in t['items']:
            rate = dec(it.get('taxRate'))
            if new_format:
                # Bon nach der Umstellung: Pfand-USt ist schon gebucht und steht
                # im Bericht -> zu den Werten "laut Tagesabschluss", keine Korrektur.
                if it.get('pfandTaxRate') is not None:
                    pr_ = dec(it.get('pfandTaxRate'))
                    app[pr_]['gross'] += sign * dec(it.get('pfand'))
                    app[pr_]['tax'] += sign * dec(it.get('pfandTax'))
                if it.get('isPfandRetoure'):
                    continue
                app[rate]['gross'] += sign * dec(it.get('price')) * dec(it.get('quantity'))
                app[rate]['tax'] += sign * dec(it.get('taxAmount'))
                continue
            if it.get('isPfandRetoure'):
                returned += sign * -dec(it.get('pfand'))
                continue
            gross = dec(it.get('price')) * dec(it.get('quantity'))
            app[rate]['gross'] += sign * gross
            app[rate]['tax'] += sign * dec(it.get('taxAmount'))
            p = dec(it.get('pfand'))
            if p:
                pfand_sold[rate] += sign * p
                if t.get('paymentMethod') == 'card':
                    pfand_card_in += sign * p
                else:
                    pfand_cash_in += sign * p

    for t in stx:
        add_tx(t, 1)
    for s in sst:
        snap = s.get('originalSnapshot')
        if snap:
            add_tx(snap, -1)

    # Rückgabe auf Sätze verteilen (eindeutig, wenn nur ein Pfand-Satz).
    total_sold = sum(pfand_sold.values(), D0)
    ret_by_rate = {}
    mixed = len([r for r, v in pfand_sold.items() if v]) > 1
    if returned and total_sold:
        for rate, v in pfand_sold.items():
            ret_by_rate[rate] = returned * v / total_sold
    elif returned:
        default = Decimal('20') if session.get('location') == 'Bregenz' else Decimal('19')
        ret_by_rate[default] = returned
        mixed = True

    rates = sorted(set(app) | set(pfand_sold) | set(ret_by_rate), key=lambda r: -r)
    rows = []
    for rate in rates:
        if rate == 0 and not app[rate]['gross']:
            continue
        g_app = app[rate]['gross']
        t_app = app[rate]['tax']
        n_app = g_app - t_app
        ps = pfand_sold.get(rate, D0)
        pr = ret_by_rate.get(rate, D0)
        ps_t = ps - net_of(ps, rate)
        pr_t = pr - net_of(pr, rate)
        g_ok = g_app + ps - pr
        t_ok = t_app + ps_t - pr_t
        rows.append({
            'rate': rate, 'g_app': g_app, 'n_app': n_app, 't_app': t_app,
            'ps': ps, 'ps_n': ps - ps_t, 'ps_t': ps_t,
            'pr': pr, 'pr_n': pr - pr_t, 'pr_t': pr_t,
            'g_ok': g_ok, 'n_ok': g_ok - t_ok, 't_ok': t_ok,
        })
    return {
        'receipts': receipts, 'stornos': len(sst), 'rows': rows,
        'pfand_sold': total_sold, 'returned': returned, 'mixed': mixed,
        'pfand_cash_in': pfand_cash_in, 'pfand_card_in': pfand_card_in,
    }


def build_pdf(path: Path, session, res, backup_name: str, backup_sha: str, created: str):
    styles = getSampleStyleSheet()
    base = ParagraphStyle('b', parent=styles['Normal'], fontName='Helvetica', fontSize=9, leading=12)
    small = ParagraphStyle('s', parent=base, fontSize=7.5, leading=10, textColor=colors.HexColor('#444444'))
    h1 = ParagraphStyle('h1', parent=base, fontName='Helvetica-Bold', fontSize=16, leading=20, spaceAfter=2)
    h2 = ParagraphStyle('h2', parent=base, fontName='Helvetica-Bold', fontSize=11, leading=14, spaceBefore=8, spaceAfter=4)
    cellr = ParagraphStyle('cr', parent=base, alignment=2, fontSize=8.5, leading=11)
    cell = ParagraphStyle('c', parent=base, fontSize=8.5, leading=11)

    loc = session.get('location', '')
    nr = session.get('dailyCloseReceiptNumber')
    yr = session.get('dailyCloseReceiptYear')
    code = 'BR' if loc == 'Bregenz' else 'FN'
    ta = f'TA-{code}-{yr}-{int(nr):06d}' if nr and yr else '(ohne Nummer)'
    doc = SimpleDocTemplate(str(path), pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm,
                            topMargin=14 * mm, bottomMargin=14 * mm,
                            title=f'Korrekturblatt Pfand-MwSt {loc} {ta}', author='WOODMO Kasse')
    story = []
    story.append(Paragraph('Korrekturblatt Pfand-Umsatzsteuer', h1))
    story.append(Paragraph(f'<b>Ergänzung zum Tagesabschluss {ta}</b> · Standort <b>{loc}</b>', base))
    story.append(Paragraph(
        f'Kasse geöffnet {ts(session["openedAt"])} · Tagesabschluss {ts(session["closedAt"])} · '
        f'{res["receipts"]} Bons, {res["stornos"]} Stornos', base))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        'Der Original-Tagesabschluss bleibt unverändert. Dieses Blatt rechnet die Umsatzsteuer auf das '
        '<b>Pfand</b> nach, das die Kasse beim Verkauf ohne Umsatzsteuer und bei der Rückgabe ohne '
        'Entgeltminderung gebucht hat. Bruttobeträge, Bar/Karte und Kassenbestand sind davon nicht betroffen.', base))

    story.append(Paragraph('1. Umsatzsteuer je Steuersatz', h2))
    head = ['Satz', 'Ware laut\nTagesabschluss', 'Pfand-Verkauf\n(+)', 'Pfand-Rückgabe\n(−)', 'Richtig\ngesamt']
    data = [[Paragraph(f'<b>{h}</b>'.replace('\n', '<br/>'), cell if i == 0 else cellr) for i, h in enumerate(head)]]
    tot = defaultdict(lambda: D0)
    for r in res['rows']:
        rate = f'{r["rate"].normalize():f} %'
        for label, gk, nk, tk in (('Brutto', 'g', 'n', 't'),):
            pass
        data.append([Paragraph(f'<b>{rate}</b><br/>Brutto<br/>Netto<br/>USt', cell),
                     Paragraph(f'<br/>{eur(r["g_app"])}<br/>{eur(r["n_app"])}<br/>{eur(r["t_app"])}', cellr),
                     Paragraph(f'<br/>{eur(r["ps"])}<br/>{eur(r["ps_n"])}<br/>{eur(r["ps_t"])}', cellr),
                     Paragraph(f'<br/>{eur(-r["pr"])}<br/>{eur(-r["pr_n"])}<br/>{eur(-r["pr_t"])}', cellr),
                     Paragraph(f'<br/><b>{eur(r["g_ok"])}</b><br/><b>{eur(r["n_ok"])}</b><br/><b>{eur(r["t_ok"])}</b>', cellr)])
        for k in ('g_app', 'n_app', 't_app', 'ps', 'ps_n', 'ps_t', 'pr', 'pr_n', 'pr_t', 'g_ok', 'n_ok', 't_ok'):
            tot[k] += r[k]
    # Summenzeile: je Satz gerundet addiert, wie im Tagesabschluss gedruckt
    # Summenzeile wie im Tagesabschluss: ungerundet addiert, erst die Summe gerundet
    rs = lambda k: tot[k]
    data.append([Paragraph('<b>Summe</b><br/>Brutto<br/>Netto<br/>USt', cell),
                 Paragraph(f'<br/>{eur(rs("g_app"))}<br/>{eur(rs("n_app"))}<br/>{eur(rs("t_app"))}', cellr),
                 Paragraph(f'<br/>{eur(rs("ps"))}<br/>{eur(rs("ps_n"))}<br/>{eur(rs("ps_t"))}', cellr),
                 Paragraph(f'<br/>{eur(-rs("pr"))}<br/>{eur(-rs("pr_n"))}<br/>{eur(-rs("pr_t"))}', cellr),
                 Paragraph(f'<br/><b>{eur(rs("g_ok"))}</b><br/><b>{eur(rs("n_ok"))}</b><br/><b>{eur(rs("t_ok"))}</b>', cellr)])
    t = Table(data, colWidths=[24 * mm, 38 * mm, 36 * mm, 36 * mm, 38 * mm])
    t.setStyle(TableStyle([
        ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#999999')),
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e8f1ec')),
        ('BACKGROUND', (-1, 1), (-1, -1), colors.HexColor('#f3faf5')),
        ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#eeeeee')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    story.append(t)

    diff = rs('t_ok') - rs('t_app')
    story.append(Spacer(1, 6))
    box = Table([[Paragraph(
        f'<b>Umsatzsteuer laut Tagesabschluss: {eur(rs("t_app"))} · richtig: {eur(rs("t_ok"))} · '
        f'Nachzuweisen: {eur(diff)}</b><br/>'
        f'Umsatz (Entgelt) brutto inkl. Pfand-Saldo: {eur(rs("g_ok"))} · netto: {eur(rs("n_ok"))}', base)]],
        colWidths=[172 * mm])
    box.setStyle(TableStyle([('BOX', (0, 0), (-1, -1), 1, colors.HexColor('#2f6b45')),
                             ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#f3faf5')),
                             ('LEFTPADDING', (0, 0), (-1, -1), 6), ('TOPPADDING', (0, 0), (-1, -1), 5),
                             ('BOTTOMPADDING', (0, 0), (-1, -1), 5)]))
    story.append(box)

    story.append(Paragraph('2. Pfand im Überblick', h2))
    story.append(Paragraph(
        f'Pfand eingenommen {eur(res["pfand_sold"])} (davon bar {eur(res["pfand_cash_in"])}, Karte {eur(res["pfand_card_in"])}) · '
        f'Pfand ausgezahlt {eur(-res["returned"])} · Pfand-Saldo {eur(res["pfand_sold"] - res["returned"])}. '
        'Diese Beträge stimmen mit dem Tagesabschluss überein; geändert wird nur ihre steuerliche Aufteilung in Netto und Umsatzsteuer.', base))

    story.append(Paragraph('3. Grundlage und Annahmen', h2))
    rates_txt = ', '.join(f'{r["rate"].normalize():f} %' for r in res['rows'] if r['ps'])
    ann = ('Alle Pfandverkäufe dieses Tages hatten denselben Steuersatz (' + rates_txt + '); die Rückgaben sind deshalb eindeutig '
           'mit diesem Satz als Entgeltminderung angesetzt.') if not res['mixed'] else (
           'Pfandverkäufe mit mehreren Steuersätzen: die Rückgaben (ohne Artikelbezug gebucht) sind anteilig nach den '
           'Pfandverkäufen des Tages auf die Sätze verteilt. Diese Annahme bitte mit dem Steuerberater abstimmen.')
    for p in [
        'Mehrweg-Pfand ist Teil des Entgelts für das Getränk und teilt dessen Steuersatz. Die Rückzahlung des Pfands ist eine '
        'Entgeltminderung mit dem Steuersatz der ursprünglichen Lieferung (DE § 17 UStG, AT § 16 UStG).',
        ann,
        'Rechenweg: Netto = Brutto ÷ (1 + Satz/100), USt = Brutto − Netto, je Bon-Zeile ungerundet berechnet, je Steuersatz auf Cent gerundet. '
        'Die Werte „laut Tagesabschluss“ sind die in den Bons gespeicherten Werte, unverändert. Wie im Tagesabschluss wird die Summe '
        'aus den ungerundeten Werten gebildet; die Summe der gerundeten Einzelsätze kann deshalb um 1 Cent abweichen.',
        'Österreich: Ein möglicher „Rückgabeüberhang“ (mehr Leergut zurück als verkauft) ist hier nicht berücksichtigt; bitte bei der '
        'Jahresbetrachtung mit dem Steuerberater klären.',
        'Dieses Blatt ist eine nachvollziehbare Nachberechnung, keine Steuerberatung. Die steuerliche Behandlung bestätigt der Steuerberater.',
    ]:
        story.append(Paragraph('• ' + p, base))

    story.append(Spacer(1, 8))
    story.append(Paragraph(
        f'Erstellt {created} aus dem Voll-Backup <b>{backup_name}</b> (nur gelesen). '
        f'SHA-256 des Backups: {backup_sha}<br/>Kassensitzung {session["id"]}', small))
    doc.build(story)


def main():
    backup = Path(sys.argv[1])
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    raw = backup.read_bytes()
    sha = hashlib.sha256(raw).hexdigest()
    data = json.loads(raw)['data']
    txs = data.get('transactions', [])
    stornos = data.get('stornos', [])
    created = datetime.now(TZ).strftime('%d.%m.%Y, %H:%M Uhr')
    only = set(sys.argv[3:])  # optional: nur bestimmte Tage JJJJ-MM-TT
    for s in data.get('cashSessions', []):
        if not s.get('closed') or not s.get('closedAt'):
            continue
        day = datetime.fromtimestamp(s['closedAt'] / 1000, TZ).strftime('%Y-%m-%d')
        if only and day not in only:
            continue
        # Nur Tage mit Bons im ALTEN Format brauchen ein Blatt. Bons ab der
        # App-Umstellung tragen pfandTaxByRate und sind im Bericht schon richtig.
        stx = [t for t in txs if t.get('cashSessionId') == s['id']]
        old_fmt = [t for t in stx if 'pfandTaxByRate' not in t and any(i.get('pfand') for i in t.get('items', []))]
        if not old_fmt:
            print(json.dumps({'tag': day, 'standort': s.get('location'), 'hinweis': 'bereits richtig gebucht, kein Korrekturblatt noetig'}, ensure_ascii=False))
            continue
        if len(old_fmt) != len([t for t in stx if any(i.get('pfand') for i in t.get('items', []))]):
            print(json.dumps({'tag': day, 'standort': s.get('location'), 'WARNUNG': 'Tag mit altem UND neuem Bon-Format - nur alte Bons korrigieren, bitte pruefen'}, ensure_ascii=False))
        res = analyse_session(s, txs, stornos)
        name = f'{s["location"]}_Korrekturblatt_Pfand-MwSt_{day}.pdf'
        build_pdf(out / name, s, res, backup.name, sha, created)
        rows = {f'{r["rate"]:f}': {k: str(r2(v)) for k, v in r.items() if k != 'rate'} for r in res['rows']}
        print(json.dumps({'datei': name, 'bons': res['receipts'], 'stornos': res['stornos'], 'mixed': res['mixed'],
                          'pfand_verkauft': str(res['pfand_sold']), 'pfand_zurueck': str(res['returned']), 'saetze': rows},
                         ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
