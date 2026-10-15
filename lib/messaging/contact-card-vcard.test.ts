import { describe, expect, it } from "vitest";

import { parseVcard } from "./contact-card";

const doWhatsApp = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "N:*_*;Amor;;;",
  "FN:Amor *_*",
  "item1.TEL;waid=555599914147:+55 55 9991-4147",
  "item1.X-ABLabel:Celular",
  "END:VCARD",
].join("\n");

describe("parseVcard — formatos reais do WhatsApp", () => {
  it("le o nome e o telefone de uma linha `item1.TEL;waid=...` (o caso que ficava sem numero)", () => {
    const r = parseVcard(doWhatsApp);
    expect(r?.name).toBe("Amor *_*");
    expect(r?.phone_number).toMatch(/9991.?4147/);
  });
  it("continua lendo `TEL;type=CELL;...` sem prefixo (o vCard que o proprio CRM envia)", () => {
    const r = parseVcard("BEGIN:VCARD\nVERSION:3.0\nFN:Cliente\nTEL;type=CELL;type=VOICE;waid=5555999999999:+5555999999999\nEND:VCARD");
    expect(r?.name).toBe("Cliente");
    expect(r?.phone_number).toMatch(/5555999999999|55999999999/);
  });
  it("aceita fim de linha do Windows", () => {
    const r = parseVcard("BEGIN:VCARD\r\nFN:Maria\r\nTEL;TYPE=CELL:(55) 99999-0000\r\nEND:VCARD");
    expect(r?.name).toBe("Maria");
    expect(r?.phone_number).toMatch(/99999.?0000/);
  });
});
