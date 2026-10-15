import { describe, expect, test } from "@jest/globals";
import { buildZip, crc32 } from "../../wizard/zip.js";

const bytes = (text) => new TextEncoder().encode(text);

// A small ZIP reader, enough to check what buildZip wrote.
function readZip(zip) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const entries = view.getUint16(zip.length - 22 + 10, true);
  let at = view.getUint32(zip.length - 22 + 16, true);
  const out = [];
  for (let i = 0; i < entries; i += 1) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(
      zip.slice(at + 46, at + 46 + nameLength),
    );

    expect(view.getUint32(localOffset, true)).toBe(0x04034b50);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const dataStart = localOffset + 30 + localNameLength;
    out.push({ name, crc, data: zip.slice(dataStart, dataStart + size) });
    at += 46 + nameLength;
  }
  return out;
}

describe("crc32", () => {
  test("matches the standard check value", () => {
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
  });

  test("is 0 for no data", () => {
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe("buildZip", () => {
  test("stores every file under its name with its exact bytes and CRC", () => {
    const files = [
      { name: "index.html", data: bytes("<h1>hi</h1>") },
      { name: "sub/dir/app.js", data: bytes("export const x = 1;\n") },
      { name: "empty.txt", data: new Uint8Array() },
    ];
    const entries = readZip(buildZip(files, new Date(2026, 9, 15, 10, 10)));

    expect(entries.map((e) => e.name)).toEqual(files.map((f) => f.name));
    entries.forEach((entry, i) => {
      expect(Array.from(entry.data)).toEqual(Array.from(files[i].data));
      expect(entry.crc).toBe(crc32(files[i].data));
    });
  });

  test("handles non-ASCII names and binary data", () => {
    const data = Uint8Array.from([0, 255, 1, 254, 128]);
    const [entry] = readZip(buildZip([{ name: "caf\u00e9.bin", data }]));

    expect(entry.name).toBe("caf\u00e9.bin");
    expect(Array.from(entry.data)).toEqual(Array.from(data));
  });

  test("an empty archive is just the end record", () => {
    expect(buildZip([]).length).toBe(22);
  });
});
