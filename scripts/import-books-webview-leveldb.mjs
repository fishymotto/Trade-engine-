import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { Level } from "level";

const args = process.argv.slice(2);
const getArg = (name, fallback = "") => {
  const exact = args.find((arg) => arg.startsWith(`${name}=`));
  if (exact) {
    return exact.slice(name.length + 1);
  }

  const idx = args.indexOf(name);
  if (idx >= 0 && idx + 1 < args.length) {
    return args[idx + 1];
  }

  return fallback;
};

const csvPath = getArg("--csv");
const dbPath =
  getArg("--db") ||
  path.join(
    process.env.LOCALAPPDATA ?? "",
    "com.tradeengine.desktop",
    "EBWebView",
    "Default",
    "Local Storage",
    "leveldb"
  );
const outDir = getArg("--out") || path.join(process.cwd(), "exports");

if (!csvPath) {
  throw new Error("Missing --csv path.");
}

if (!fs.existsSync(csvPath)) {
  throw new Error(`CSV not found: ${csvPath}`);
}

if (!fs.existsSync(dbPath)) {
  throw new Error(`LevelDB path not found: ${dbPath}`);
}

const nowIso = new Date().toISOString();
const nowStamp = nowIso.replace(/[:.]/g, "-");

const normalizeTitle = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]/g, "");

const normalizeGenreTag = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const slug = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "untitled";

const parseGenres = (value) =>
  String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const toBuffer = (value) => {
  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }

  return Buffer.from(String(value), "utf8");
};

const encodeUtf16Be = (text) => {
  const le = Buffer.from(text, "utf16le");
  const be = Buffer.allocUnsafe(le.length);
  for (let i = 0; i < le.length; i += 2) {
    be[i] = le[i + 1];
    be[i + 1] = le[i];
  }

  return be;
};

const decodeUtf16Be = (buffer) => {
  const evenLength = buffer.length - (buffer.length % 2);
  const swapped = Buffer.allocUnsafe(evenLength);
  for (let i = 0; i < evenLength; i += 2) {
    swapped[i] = buffer[i + 1];
    swapped[i + 1] = buffer[i];
  }

  return swapped.toString("utf16le");
};

const decodeLocalStorageStringWithKind = (rawValue) => {
  const buffer = toBuffer(rawValue);
  if (buffer.length === 0) {
    return { text: "", kind: "utf8" };
  }

  // WebView localStorage values commonly store string payloads as raw UTF-16BE.
  if (buffer.length >= 2 && buffer[0] === 0 && (buffer[1] === 0x5b || buffer[1] === 0x7b || buffer[1] === 0x22)) {
    return { text: decodeUtf16Be(buffer), kind: "utf16be" };
  }

  // Some metadata values are stored with a leading marker byte of 1 and UTF-8 JSON payload.
  if (buffer[0] === 1 && buffer.length >= 2 && (buffer[1] === 0x7b || buffer[1] === 0x5b || buffer[1] === 0x22)) {
    return { text: buffer.subarray(1).toString("utf8"), kind: "prefixed-utf8" };
  }

  return { text: buffer.toString("utf8"), kind: "utf8" };
};

const encodeLocalStorageString = (text, kind) => {
  if (kind === "utf16be") {
    return encodeUtf16Be(text);
  }

  if (kind === "prefixed-utf8") {
    return Buffer.concat([Buffer.from([1]), Buffer.from(text, "utf8")]);
  }

  return Buffer.from(text, "utf8");
};

const parseStoredJson = (rawValue) => {
  const decoded = decodeLocalStorageStringWithKind(rawValue);
  try {
    return { value: JSON.parse(decoded.text), kind: decoded.kind };
  } catch {
    const sanitized = decoded.text.replace(
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,
      (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`
    );
    return { value: JSON.parse(sanitized), kind: decoded.kind };
  }
};

const readCsvRows = () => {
  const raw = fs.readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
  const parsed = Papa.parse(raw, { header: true, skipEmptyLines: true });
  if (parsed.errors.length > 0) {
    throw new Error(`CSV parse error: ${parsed.errors[0].message}`);
  }

  return parsed.data.map((row) => {
    const cleaned = {};
    for (const [key, value] of Object.entries(row)) {
      cleaned[String(key).trim()] = String(value ?? "").trim();
    }

    return {
      title: cleaned["Book Name"] || "Untitled",
      author: cleaned["Author"] || "",
      readingStatus: cleaned["Reading Status"] || "To Read",
      rating: cleaned["Rating"] || "",
      genres: parseGenres(cleaned["Genre"]),
      review: cleaned["Review"] || "",
      summary: cleaned["Summary"] || ""
    };
  });
};

const toBookContent = (title, author, review) => ({
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: title }]
    },
    {
      type: "paragraph",
      content: author ? [{ type: "text", text: `Author: ${author}` }] : undefined
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text:
            review ||
            "Imported from CSV. Add review notes, takeaways, and trading applications here."
        }
      ]
    }
  ]
});

const isBookRow = (page) =>
  page &&
  page.collectionId === "book-club" &&
  Array.isArray(page.tags) &&
  page.tags.includes("book-row");

const makeTags = (genres) => {
  const genreTags = genres.map(normalizeGenreTag).filter(Boolean);
  return Array.from(new Set(["book-row", "csv-import", ...genreTags]));
};

const run = async () => {
  const rows = readCsvRows();
  const db = new Level(dbPath, { keyEncoding: "utf8", valueEncoding: "view" });

  const libraryEntries = [];
  const metaByPrefix = new Map();
  const machineOwnerEntries = [];
  const candidatePrefixes = new Set();

  try {
    await db.open();

    for await (const [key, value] of db.iterator()) {
      const keyText = String(key);
      if (keyText.includes("trade-engine-machine-owner-user-id")) {
        const prefix = keyText.replace("trade-engine-machine-owner-user-id", "");
        candidatePrefixes.add(prefix);
        machineOwnerEntries.push({ key: keyText, value });
        continue;
      }

      if (!keyText.includes("trade-engine-library-pages")) {
        continue;
      }

      const storagePrefix = keyText.replace("trade-engine-library-pages::sync-meta", "").replace("trade-engine-library-pages", "");
      candidatePrefixes.add(storagePrefix);

      if (keyText.includes("::sync-meta")) {
        metaByPrefix.set(storagePrefix, { key: keyText, value });
        continue;
      }

      libraryEntries.push({ key: keyText, value, storagePrefix });
    }

    if (libraryEntries.length === 0) {
      throw new Error("Could not find trade-engine-library-pages key in LevelDB.");
    }

    fs.mkdirSync(outDir, { recursive: true });
    const results = [];
    let canonicalLibrarySnapshot = null;
    const backupPayload = {
      dbPath,
      csvPath,
      capturedAt: nowIso,
      targets: [],
      machineOwnerKeys: []
    };

    for (const entry of libraryEntries) {
      const libraryParsed = parseStoredJson(entry.value);
      const existingValue = libraryParsed.value;
      if (!Array.isArray(existingValue)) {
        throw new Error(`Stored library pages value is not an array for key: ${entry.key}`);
      }

      const pages = [...existingValue];
      const idSet = new Set(pages.map((page) => String(page?.id ?? "")));
      const bookByTitle = new Map();
      for (const page of pages) {
        if (isBookRow(page)) {
          bookByTitle.set(normalizeTitle(page.title), page);
        }
      }

      let created = 0;
      let updated = 0;
      for (const row of rows) {
        const normalized = normalizeTitle(row.title);
        const existingPage = bookByTitle.get(normalized);
        const tags = makeTags(row.genres);
        const nextProperties = {
          ...(existingPage?.properties ?? {}),
          Author: row.author,
          "Reading Status": row.readingStatus,
          Rating: row.rating,
          Genre: row.genres,
          Review: row.review,
          Summary: row.summary
        };

        if (existingPage) {
          existingPage.tags = Array.from(new Set([...(Array.isArray(existingPage.tags) ? existingPage.tags : []), ...tags]));
          existingPage.properties = nextProperties;
          existingPage.updatedAt = nowIso;
          updated += 1;
          continue;
        }

        let id = `csv-book-row-${slug(row.title)}`;
        let suffix = 2;
        while (idSet.has(id)) {
          id = `csv-book-row-${slug(row.title)}-${suffix++}`;
        }

        idSet.add(id);
        pages.push({
          id,
          collectionId: "book-club",
          title: row.title,
          status: "Active",
          tags,
          sourceUrl: "",
          properties: nextProperties,
          content: toBookContent(row.title, row.author, row.review),
          createdAt: nowIso,
          updatedAt: nowIso
        });
        created += 1;
      }

      const sorted = [...pages].sort((left, right) =>
        String(right?.updatedAt ?? "").localeCompare(String(left?.updatedAt ?? ""))
      );

      const metaEntry = metaByPrefix.get(entry.storagePrefix);
      let metaKind = "utf8";
      let nextMeta = {
        dirty: true,
        localUpdatedAt: nowIso
      };
      if (metaEntry) {
        const metaDecoded = decodeLocalStorageStringWithKind(metaEntry.value);
        metaKind = metaDecoded.kind;
        try {
          const parsedMeta = JSON.parse(metaDecoded.text);
          nextMeta = {
            ...(parsedMeta && typeof parsedMeta === "object" ? parsedMeta : {}),
            dirty: true,
            localUpdatedAt: nowIso
          };
        } catch {
          nextMeta = {
            dirty: true,
            localUpdatedAt: nowIso
          };
        }
      }

      await db.put(entry.key, encodeLocalStorageString(JSON.stringify(sorted), libraryParsed.kind));
      if (metaEntry) {
        await db.put(metaEntry.key, encodeLocalStorageString(JSON.stringify(nextMeta), metaKind));
      }

      if (!canonicalLibrarySnapshot) {
        canonicalLibrarySnapshot = {
          pages: sorted,
          libraryKind: libraryParsed.kind,
          metaKind
        };
      }

      results.push({
        key: entry.key,
        prefix: entry.storagePrefix || "(root)",
        created,
        updated,
        totalPages: sorted.length,
        metaKey: metaEntry?.key ?? ""
      });
      backupPayload.targets.push({
        libraryKey: entry.key,
        libraryRawValueBase64: toBuffer(entry.value).toString("base64"),
        metaKey: metaEntry?.key ?? "",
        metaRawValueBase64: metaEntry ? toBuffer(metaEntry.value).toString("base64") : ""
      });
    }

    // If the app has multiple storage prefixes (e.g. tauri.localhost vs localhost:1420),
    // mirror the imported library payload so debug/release profiles stay in sync.
    const existingPrefixes = new Set(libraryEntries.map((entry) => entry.storagePrefix));
    const missingPrefixes = Array.from(candidatePrefixes).filter((prefix) => !existingPrefixes.has(prefix));
    if (canonicalLibrarySnapshot && missingPrefixes.length > 0) {
      for (const prefix of missingPrefixes) {
        const libraryKey = `${prefix}trade-engine-library-pages`;
        const metaKey = `${prefix}trade-engine-library-pages::sync-meta`;
        const nextMeta = {
          dirty: true,
          localUpdatedAt: nowIso
        };

        await db.put(
          libraryKey,
          encodeLocalStorageString(JSON.stringify(canonicalLibrarySnapshot.pages), canonicalLibrarySnapshot.libraryKind)
        );
        await db.put(metaKey, encodeLocalStorageString(JSON.stringify(nextMeta), canonicalLibrarySnapshot.metaKind));

        results.push({
          key: libraryKey,
          prefix: prefix || "(root)",
          created: 0,
          updated: rows.length,
          totalPages: canonicalLibrarySnapshot.pages.length,
          metaKey
        });

        backupPayload.targets.push({
          libraryKey,
          libraryRawValueBase64: "",
          metaKey,
          metaRawValueBase64: ""
        });
      }
    }

    // Reset machine-owner affinity so the next signed-in user can adopt this local import.
    // This prevents stale account ownership metadata from forcing cloud-over-local hydration.
    for (const ownerEntry of machineOwnerEntries) {
      backupPayload.machineOwnerKeys.push({
        key: ownerEntry.key,
        rawValueBase64: toBuffer(ownerEntry.value).toString("base64")
      });
      await db.del(ownerEntry.key);
    }

    const backupPath = path.join(outDir, `library-leveldb-before-book-import-${nowStamp}.json`);
    fs.writeFileSync(
      backupPath,
      JSON.stringify(backupPayload, null, 2),
      "utf8"
    );

    console.log(`Imported books from CSV into LevelDB.`);
    console.log(`rows_in_csv=${rows.length}`);
    console.log(`targets=${results.length}`);
    for (const result of results) {
      console.log(
        `target_key=${result.key} created=${result.created} updated=${result.updated} total_pages=${result.totalPages}`
      );
    }
    console.log(`machine_owner_keys_cleared=${machineOwnerEntries.length}`);
    console.log(`backup_path=${backupPath}`);
  } finally {
    await db.close();
  }
};

run().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exit(1);
});
