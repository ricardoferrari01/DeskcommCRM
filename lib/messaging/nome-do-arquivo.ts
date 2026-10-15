/**
 * Nome de arquivo de um anexo: limpar, escolher o que vai ao canal e o que a tela mostra.
 *
 * Antes o nome enviado ao WhatsApp era o do objeto no armazenamento
 * (`out-<uuid>.pdf`), então o destinatário via um nome aleatório. O nome original
 * viaja agora em `messages.metadata.filename`.
 *
 * O nome vem de fora (o computador do atendente, o aparelho do cliente), então é
 * higienizado antes de qualquer uso: sem caminho, sem caracteres de controle nem
 * os que invertem o sentido do texto (usados para disfarçar a extensão), com
 * limite de tamanho.
 */
const MAX = 120;

const EXT_POR_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "application/zip": "zip",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/vnd.dxf": "dxf",
  "video/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "text/plain": "txt",
  "text/csv": "csv",
};

export function limparNomeDeArquivo(bruto: unknown): string | null {
  if (typeof bruto !== "string") return null;
  // eslint-disable-next-line no-control-regex
  let n = bruto.normalize("NFC").replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "");
  n = n.split(/[\\/]/).pop() ?? "";
  n = n.replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  if (n === "") return null;
  if (n.length > MAX) {
    const ponto = n.lastIndexOf(".");
    const ext = ponto > 0 && n.length - ponto <= 10 ? n.slice(ponto) : "";
    n = n.slice(0, MAX - ext.length) + ext;
  }
  return n;
}

function extensaoPorMime(mime: string | null | undefined): string | undefined {
  return mime ? EXT_POR_MIME[(mime.split(";")[0] ?? "").trim().toLowerCase()] : undefined;
}

/** O nome que o destinatário vê no WhatsApp. */
export function nomeParaEnvio(
  nomeOriginal: unknown,
  storagePath: string | null | undefined,
  mime: string | null | undefined,
): string {
  const limpo = limparNomeDeArquivo(nomeOriginal);
  const extMime = extensaoPorMime(mime);
  if (limpo) {
    const temExtensao = /\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(limpo);
    return temExtensao || !extMime ? limpo : `${limpo}.${extMime}`;
  }
  const extPath = storagePath?.split(".").pop()?.toLowerCase();
  const ext = extPath && extPath !== "bin" && /^[a-z0-9]{1,8}$/.test(extPath) ? extPath : extMime;
  return ext ? `documento.${ext}` : "documento";
}

/** O nome que a bolha mostra: o guardado na mensagem, ou nada. */
export function nomeExibido(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  return limparNomeDeArquivo((metadata as Record<string, unknown>)["filename"]);
}
