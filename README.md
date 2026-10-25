# EduHub PWA v0.1

Prywatny katalog szkolnych aplikacji HTML. **Nie wymaga własnego backendu ani bazy na serwerze.**

## Instalacja na Androidzie

PWA nie da się prawidłowo zainstalować bezpośrednio z `file://` / `content://`.

1. Wgraj **zawartość tego katalogu**, a nie sam plik ZIP, na prosty hosting statyczny HTTPS, np. GitHub Pages.
2. Dla GitHub Pages: utwórz repozytorium `eduhub`, dodaj do głównego katalogu pliki `index.html`, `app.js`, `style.css`, `sw.js`, `manifest.webmanifest` oraz katalog `icons/`.
3. Otwórz repozytorium → Settings → Pages → Deploy from branch → `main` / `(root)` → Save.
4. Wejdź telefonem w podany adres HTTPS (`https://TWOJ_LOGIN.github.io/eduhub/`).
5. Chrome → menu `⋮` → „Zainstaluj aplikację” lub „Dodaj do ekranu głównego” (nazwa opcji zależy od Androida/Chrome).
6. Otwórz EduHub z ikonki → „Dodaj aplikację HTML” → wskaż np. `Misja_Przyroda_Okiem_Badacza_v1.5_Mikrofon_Diagnostyka_AI.html` w Pobranych.
7. Uruchom ją z katalogu. Adres będzie miał postać `https://TWOJ_LOGIN.github.io/eduhub/apps/a_.../`, mimo że plik HTML jest przechowywany lokalnie.

## Jak działa

- Pliki HTML są importowane **wyłącznie do IndexedDB danej przeglądarki**. Nie są wysyłane na GitHub Pages.
- Service Worker przechwytuje nawigację pod `/apps/<id>/` i zwraca lokalny plik jako odpowiedź `text/html` pod adresem HTTPS.
- Katalog i zaimportowane pliki działają po instalacji także offline. Sama usługa dyktowania w Chrome i ocena odpowiedzi przez Groq mogą wymagać internetu.
- Zmiana HTML na nowszą wersję: przycisk `↻` na kafelku – nie czyści historii wyników zapisanej w localStorage.
- Z telefonu do katalogu wrócisz systemowym przyciskiem Wstecz.
- Użytkownik może eksportować/odtwarzać zaimportowane pliki HTML jako JSON. **Eksport nie obejmuje historii localStorage**, zatem nie jest pełną kopią wyników edukacyjnych.

## Ważne ograniczenia

1. API Web Speech (`SpeechRecognition`) i pozwolenia mikrofonu zależą od Chrome / Androida. HTTPS rozwiązuje problem niebezpiecznego `content://`, ale nie gwarantuje działania każdej usługi głosowej.
2. Nie importuj niezaufanych plików HTML. Uruchamiane aplikacje mają ten sam origin HTTPS co EduHub i mogą mieć dostęp do wspólnego localStorage/IndexedDB. Nie jest to izolacja bezpieczeństwa dla obcego kodu.
3. HTML z wbudowanym kluczem Groq **nie jest publikowany na hostingu**, jednak klucz pozostaje widoczny w zaimportowanym kodzie i może być dostępny dla każdego, kto dysponuje tym plikiem lub dostępem do przeglądarki.
4. Dane pozostają na danym urządzeniu/profilu przeglądarki. Wyczyszczenie danych witryny usuwa importowane pliki i może usunąć historię wyników.
5. Dla obecnych aplikacji monolitycznych wszystkie zasoby muszą być osadzone w jednym HTML. Osobne zasoby w relatywnych ścieżkach nie są importowane wraz z plikiem.
6. **PWA musi zostać raz pobrana z HTTPS**. Hosting może być tylko statyczny, bez serwera aplikacyjnego.

## Lokalny test na komputerze

W katalogu: `python3 -m http.server 8765`, następnie otwórz `http://localhost:8765`. `localhost` jest wyjątkowo traktowany jako bezpieczny kontekst. Do instalacji na telefonie użyj HTTPS.

7. Wyniki zapisane wcześniej przez plik uruchamiany jako `content://` nie migrują automatycznie do nowej domeny HTTPS. Nowe wyniki w EduHub pozostaną lokalne i będą dostępne po podmianie HTML, o ile aplikacja zachowuje klucze localStorage.
