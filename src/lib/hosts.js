/* Freigabe-Muster für Website-Zugriff (optionale Host-Berechtigungen).
   Reine Funktionen, laufen im Hintergrund, auf Erweiterungsseiten und in Node-Tests. */
'use strict';

var Hosts = (() => {
  // Domains, unter denen viele getrennte Instanzen liegen: einmal für alle freigeben.
  const MULTI = ['odoo.com', 'odoo.sh'];
  // Zweistufige Endungen, unter denen „alle Subdomains“ zu weit wäre.
  const TWO_PART = /\.(co|com|net|org|gov|ac|edu)\.[a-z]{2}$/i;

  function parse(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u;
    } catch (_) {
      return null;
    }
  }

  /** Muster für genau diese Website, z. B. https://firma.odoo.com/* */
  function sitePattern(url) {
    const u = parse(url);
    return u ? `${u.protocol}//${u.hostname}/*` : null;
  }

  /**
   * Muster für alle Instanzen derselben Domain, z. B. *://*.odoo.com/*.
   * Nur für bekannte Mehr-Instanz-Domains und Hosts mit Subdomain, nie für IP-Adressen.
   */
  function domainPattern(url) {
    const u = parse(url);
    if (!u) return null;
    const host = u.hostname.toLowerCase();
    if (/^[\d.]+$/.test(host) || host.includes(':') || !host.includes('.')) return null;
    const known = MULTI.find((d) => host === d || host.endsWith('.' + d));
    if (known) return { pattern: `*://*.${known}/*`, label: known };
    const parts = host.split('.');
    if (parts.length < 3 || TWO_PART.test(host)) return null;
    const base = parts.slice(-2).join('.');
    return { pattern: `*://*.${base}/*`, label: base };
  }

  /** Content-Script-Muster aus erteilten Freigaben (nur http/https). */
  function scriptMatches(origins) {
    const list = Array.isArray(origins) ? origins : [];
    if (list.includes('<all_urls>') || list.includes('*://*/*')) return ['http://*/*', 'https://*/*'];
    return list.filter((o) => /^(https?|\*):\/\/[^/]+\/\*$/.test(o));
  }

  /** Lesbarer Name einer Freigabe für die Einstellungen. */
  function label(pattern) {
    if (pattern === '<all_urls>' || pattern === '*://*/*') return 'Alle Websites';
    const m = /^(\*|https?):\/\/([^/]+)\/\*$/.exec(pattern);
    if (!m) return pattern;
    return m[2].startsWith('*.') ? `Alle Instanzen von ${m[2].slice(2)}` : m[2];
  }

  return { sitePattern, domainPattern, scriptMatches, label };
})();

if (typeof module !== 'undefined') module.exports = Hosts;
