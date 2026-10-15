# Testfall Projektübergabe „Leergutlager Lohne“ (fiktive Daten)

## Eingaben in der App

| Feld | Wert |
|---|---|
| Angebot | Angebot_Brennecke_AN-2026-1187.docx |
| Kundenspezifikation | Kundenspezifikation_Brennecke_LH-LAG-Spec_v1.4.pdf |
| Projektnummer | P-2026-0457 |
| Kunde | Brennecke Getränkelogistik GmbH & Co. KG |
| Standort der Anlage | Lohne (Oldenburg) |
| Geplanter Liefertermin | KW 14/2027 |
| Besonderheiten aus Kundengesprächen | Herr Albers hat beim Termin am 15.07. angedeutet, dass die Saison 2028 auf keinen Fall gefährdet werden darf. Die IT von Brennecke ist sehr streng, Fernwartung war ein großes Thema. Einkauf will die Vertragsstrafe nachverhandeln. |

## Diese Punkte sollte die KI finden (eingebaute Stolpersteine)

1. **Versionskonflikt:** Das Angebot basiert auf Spezifikation v1.3, beigelegt ist v1.4 mit geänderten Anforderungen.
2. **Durchsatz:** Angebot 180 Doppelspiele pro Stunde, gefordert 200 in der Spitze.
3. **Verfügbarkeit:** Angebot 98,5 %, gefordert 99 % im Jahresmittel.
4. **Temperatur:** Angebot ab +5 °C, Halle im Winter bis −5 °C.
5. **Palettengewicht:** Angebot max. 1.000 kg, Kunde bis 1.050 kg (schwere Paletten würden ausgeschleust).
6. **Industriepaletten:** rund 8 % 1.200 × 1.000 mm, im Angebot nur „nach Rücksprache“.
7. **Abnahmetermin:** Angebot spätestens KW 40/2027, Kunde wünscht KW 36/2027.
8. **Vertragsstrafe:** Angebot 0,3 % je Woche, max. 5 %; Kunde fordert 0,5 % je Woche, max. 10 %, dazu 10 % Erfüllungsbürgschaft. Muss im Protokoll oben und rot stehen.
9. **Gewährleistung:** Angebot 24 Monate, Kunde 36 Monate.
10. **IT-Sicherheit:** Kunde fordert IEC 62443 SL2 und SBOM, Angebot schließt IEC 62443 aus. Fernwartung: Angebot Körber-VPN, Kunde nur eigene Lösung.
11. **SAP-Schnittstelle:** Kunde plant kundenspezifische IDoc-Erweiterung, Angebot geht von Standard aus; Beschreibung fehlt noch.
12. **Datenmigration:** Kunde erwartet sie vom Lieferanten, im Angebot ausdrücklich ausgeschlossen.
13. **Bindefrist:** Angebot gültig bis 30.09.2026.

Gute Ergebnisse markieren Punkte 1 bis 12 als Risiko oder offene Frage, bewerten 2, 8, 10 und 12 als hoch und stellen die Vertragsstrafe ganz oben dar.
