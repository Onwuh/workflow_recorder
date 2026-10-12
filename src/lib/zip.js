/* Minimaler ZIP-Schreiber und -Leser ohne Fremdbibliothek.
   Schreiben: „stored“ oder „deflate“ (CompressionStream).
   Lesen: nur über das zentrale Verzeichnis, mit harten Grenzen gegen ZIP-Bomben und Pfadtricks. */
'use strict';

var Zip = (() => {
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  async function streamBytes(bytes, transform) {
    const s = new Blob([bytes]).stream().pipeThrough(transform);
    return new Uint8Array(await new Response(s).arrayBuffer());
  }

  function dosDateTime(d) {
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
  }

  /**
   * files: [{ name, data: Uint8Array|Blob|string, compress?: bool }]
   * Liefert einen Blob (application/zip).
   */
  async function create(files) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    const { time, date } = dosDateTime(new Date());

    for (const f of files) {
      const name = enc.encode(f.name);
      let raw;
      if (typeof f.data === 'string') raw = enc.encode(f.data);
      else if (f.data instanceof Uint8Array) raw = f.data;
      else raw = new Uint8Array(await f.data.arrayBuffer());
      const crc = crc32(raw);
      let method = 0;
      let body = raw;
      if (f.compress && typeof CompressionStream !== 'undefined') {
        const z = await streamBytes(raw, new CompressionStream('deflate-raw'));
        if (z.length < raw.length) { body = z; method = 8; }
      }
      if (raw.length >= 0xFFFFFFFF || body.length >= 0xFFFFFFFF) throw new Error('Datei zu groß für ZIP');

      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034B50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true); // UTF-8-Namen
      lh.setUint16(8, method, true);
      lh.setUint16(10, time, true);
      lh.setUint16(12, date, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, body.length, true);
      lh.setUint32(22, raw.length, true);
      lh.setUint16(26, name.length, true);
      lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, body);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014B50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, method, true);
      ch.setUint16(12, time, true);
      ch.setUint16(14, date, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, body.length, true);
      ch.setUint32(24, raw.length, true);
      ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);

      offset += 30 + name.length + body.length;
    }

    const cdSize = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054B50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  const DEFAULT_LIMITS = {
    maxArchive: 1024 * 1024 * 1024,   // 1 GB Archiv
    maxEntries: 5000,
    maxEntry: 64 * 1024 * 1024,       // 64 MB pro Datei entpackt
    maxTotal: 1536 * 1024 * 1024,     // 1,5 GB entpackt insgesamt
    maxRatio: 200                     // Kompressionsverhältnis
  };

  function safeName(n) {
    if (!n || n.length > 255) return false;
    if (n.startsWith('/') || n.includes('\\') || n.includes('\0')) return false;
    if (/^[A-Za-z]:/.test(n)) return false;
    return !n.split('/').some((p) => p === '..' || p === '.');
  }

  async function inflateLimited(bytes, expected, limit) {
    const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = s.getReader();
    const out = new Uint8Array(expected);
    let pos = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (pos + value.length > expected || pos + value.length > limit) {
        reader.cancel().catch(() => {});
        throw new Error('ZIP-Eintrag größer als angegeben');
      }
      out.set(value, pos);
      pos += value.length;
    }
    if (pos !== expected) throw new Error('ZIP-Eintrag unvollständig');
    return out;
  }

  /**
   * Liest ein ZIP. Liefert Map name -> { read(): Promise<Uint8Array>, size }.
   * Dateien werden erst beim Lesen entpackt und geprüft (Größe, CRC).
   */
  async function read(blob, limits = {}) {
    const L = { ...DEFAULT_LIMITS, ...limits };
    if (blob.size > L.maxArchive) throw new Error('Archiv ist zu groß');
    if (blob.size < 22) throw new Error('Keine gültige ZIP-Datei');
    const buf = new Uint8Array(await blob.arrayBuffer());
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

    // Ende des zentralen Verzeichnisses suchen (Kommentar max. 64 KB).
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xFFFF); i--) {
      if (dv.getUint32(i, true) === 0x06054B50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Keine gültige ZIP-Datei');
    const count = dv.getUint16(eocd + 10, true);
    const cdSize = dv.getUint32(eocd + 12, true);
    const cdOff = dv.getUint32(eocd + 16, true);
    if (count === 0xFFFF || cdOff === 0xFFFFFFFF) throw new Error('ZIP64 wird nicht unterstützt');
    if (count > L.maxEntries) throw new Error('Archiv enthält zu viele Dateien');
    if (cdOff + cdSize > eocd) throw new Error('Beschädigte ZIP-Datei');

    const dec = new TextDecoder('utf-8', { fatal: true });
    const entries = new Map();
    let total = 0;
    let p = cdOff;
    for (let i = 0; i < count; i++) {
      if (p + 46 > eocd || dv.getUint32(p, true) !== 0x02014B50) throw new Error('Beschädigte ZIP-Datei');
      const flags = dv.getUint16(p + 8, true);
      const method = dv.getUint16(p + 10, true);
      const crc = dv.getUint32(p + 16, true);
      const csize = dv.getUint32(p + 20, true);
      const usize = dv.getUint32(p + 24, true);
      const nlen = dv.getUint16(p + 28, true);
      const xlen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      if (p + 46 + nlen > eocd) throw new Error('Beschädigte ZIP-Datei');
      let name;
      try { name = dec.decode(buf.subarray(p + 46, p + 46 + nlen)); } catch (_) { throw new Error('Ungültiger Dateiname im Archiv'); }
      p += 46 + nlen + xlen + clen;

      if (flags & 0x1) throw new Error('Verschlüsselte ZIP-Dateien werden nicht unterstützt');
      if (name.endsWith('/')) continue; // Ordner
      if (!safeName(name)) throw new Error('Unsicherer Pfad im Archiv');
      if (entries.has(name)) throw new Error('Doppelter Eintrag im Archiv');
      if (method !== 0 && method !== 8) throw new Error('Nicht unterstützte Kompression');
      if (usize > L.maxEntry) throw new Error('Datei im Archiv ist zu groß');
      if (method === 0 && csize !== usize) throw new Error('Beschädigte ZIP-Datei');
      if (method === 8 && usize > Math.max(1024 * 1024, csize * L.maxRatio)) throw new Error('Verdächtiges Kompressionsverhältnis');
      total += usize;
      if (total > L.maxTotal) throw new Error('Archiv ist entpackt zu groß');

      if (lho + 30 > buf.length || dv.getUint32(lho, true) !== 0x04034B50) throw new Error('Beschädigte ZIP-Datei');
      const dataStart = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      if (dataStart + csize > buf.length) throw new Error('Beschädigte ZIP-Datei');

      const slice = buf.subarray(dataStart, dataStart + csize);
      entries.set(name, {
        size: usize,
        async read() {
          const out = method === 0 ? slice.slice() : await inflateLimited(slice, usize, L.maxEntry);
          if (crc32(out) !== crc) throw new Error('Prüfsumme stimmt nicht');
          return out;
        }
      });
    }
    return entries;
  }

  return { create, read, crc32, safeName };
})();

if (typeof module !== 'undefined') module.exports = Zip;
