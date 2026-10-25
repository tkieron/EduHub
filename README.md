# EduHub v0.2

Przeglądarkowa biblioteka szkolnych, jednoplikowych aplikacji HTML. Hosting na GitHub Pages udostępnia wyłącznie samą powłokę PWA; zaimportowane HTML-e, postępy i klucz Groq są przechowywane lokalnie w urządzeniu użytkownika.

## Instalacja

Otwórz https://tkieron.github.io/EduHub/ w Chrome na Androidzie → ⋮ → „Zainstaluj aplikację” albo „Dodaj do ekranu głównego”. Po aktualizacji może być potrzebne ponowne uruchomienie i odświeżenie, aby Service Worker przejął nowe zasoby.

## Nawigacja

**Klasa → przedmiot → aplikacje.** Gdy jest tylko jedna klasa, EduHub automatycznie przechodzi do listy przedmiotów. Dodatkowo wspieramy klasę „Bez klasy”, aby starsze pliki bez metadanych nie znikały. Klasy można poprawić ikoną ✎ przy aplikacji.

## Konwencja metadanych nowej aplikacji

W `<head>` pliku HTML umieść:

```html
<meta name="eduhub:class" content="4">
<meta name="eduhub:subject" content="Przyroda">
<meta name="eduhub:name" content="Okiem badacza">
```

Alternatywnie stosuj nazwy: `kl4__przyroda__Okiem_badacza.html`, `kl4__matematyka__Kolejnosc_dzialan.html` (części oddzielone **podwójnym podkreśleniem**). Priorytet: metadane HTML → konwencja nazwy pliku → tytuł/heurystyka. Jeśli brakuje klasy, trafia do „Bez klasy”. Przy imporcie można poprawić rozpoznane pola, nie trzeba edytować kodu.

## Wspólny klucz Groq

W EduHub wybierz „🔑 Klucz Groq” i wpisz klucz własnego konta. Domyślnie **pusty**. Przechowywany w `localStorage` pod kluczem `eduhub:groq-key` i **nie** przesyłany do GitHub Pages ani **nie** eksportowany w kopii biblioteki.

Aplikacje zgodne z v0.2 mogą odczytać klucz tak:

```js
const key = window.EduHub?.getGroqKey?.() || localStorage.getItem('eduhub:groq-key') || '';
```

Wirtualny serwer Service Workera wstrzykuje obiekt `window.EduHub` przed skryptami nowo uruchomionej aplikacji. Starsze HTML-e z własnym na stałe zapisanym kluczem **nie przejmą automatycznie** konfiguracji centralnej; trzeba zaktualizować je do nowego kontraktu (np. Misja Przyroda v1.6).

⚠️ To wygodny tryb domowy, nie magazyn bezpiecznych sekretów: wszystkie importowane HTML-e działają pod wspólnym originem i mogą odczytać klucz oraz cudze dane lokalne. Importuj tylko zaufane pliki, ogranicz wykorzystanie klucza i nigdy nie publikuj go w repozytorium. Pytania opisowe nie działają offline, reszta aplikacji nadal działa.

## Aktualizacje i kopie

Przycisk ↻ podmienia HTML przy zachowaniu identyfikatora aplikacji (a przez to adresu w EduHub), zaś ✎ zmienia klasę, przedmiot i nazwę. Eksport/import kopii przenosi zaimportowane pliki, **bez** klucza Groq i bez wyników przechowywanych w localStorage.

## Bezpieczeństwo i kompatybilność

- Importy są przechowywane w IndexedDB, PWA jest dostarczana przez HTTPS, a Service Worker udostępnia pliki lokalnie pod `/EduHub/apps/<id>/`.
- Nie instaluj EduHub z `content://` ani `file://`: wymagane jest HTTPS lub localhost.
- Appka może działać offline, ale dyktowanie w Chrome może wymagać usług sieciowych. W razie problemu użyj dyktowania Gboard.
- W obecnym modelu importuj jednoplikowe, samodzielne aplikacje HTML; osobne względne zasoby nie są automatycznie importowane.
- Wcześniejsze dane biblioteki z EduHub v0.1 są zachowywane (ta sama IndexedDB `eduhub-v1`).
