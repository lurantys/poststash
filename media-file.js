// Validate the bytes, rather than trusting a CDN URL, extension, or Content-Type.
function inspectMediaFile(buffer, expectedKind) {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  if (bytes.length < 32) throw new Error('The media server returned an empty or incomplete media file.');
  const text = (start, length) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) {
    if (expectedKind === 'video') throw new Error('The media server returned a thumbnail instead of a video.');
    return {mime: 'image/jpeg', ext: 'jpg'};
  }
  if (text(1, 3) === 'PNG' && text(bytes.length - 8, 4) === 'IEND') return image('image/png', 'png');
  if (text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP' && view.getUint32(4, true) + 8 === bytes.length) return image('image/webp', 'webp');
  if (/^GIF8[79]a$/.test(text(0, 6)) && bytes[bytes.length - 1] === 0x3b) return image('image/gif', 'gif');
  if (view.getUint32(0) === 0x1a45dfa3 && bytes.length > 256) return {mime: 'video/webm', ext: 'webm'};
  const boxes = new Set();
  let moovStart = -1, moovEnd = -1, mediaBytes = 0;
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    let size = view.getUint32(offset), header = 8;
    if (size === 1) {
      if (offset + 16 > bytes.length) throw new Error('The media server returned a truncated MP4 header.');
      size = Number(view.getBigUint64(offset + 8)); header = 16;
    } else if (size === 0) size = bytes.length - offset;
    if (size < header || offset + size > bytes.length) break;
    const type = text(offset + 4, 4);
    if (type === 'moov') { moovStart = offset + header; moovEnd = offset + size; }
    if (type === 'mdat') mediaBytes += size - header;
    boxes.add(type); offset += size;
  }
  if (boxes.has('ftyp') && /avif|avis/.test(text(8, 24)) && boxes.has('meta') && offset === bytes.length) return image('image/avif', 'avif');
  const hasVideoTrack = (start, end, depth = 0) => {
    for (let cursor = start; cursor >= 0 && cursor + 8 <= end;) {
      const size = view.getUint32(cursor), type = text(cursor + 4, 4);
      if (size < 8 || cursor + size > end) return false;
      if (type === 'hdlr' && size >= 20 && text(cursor + 16, 4) === 'vide') return true;
      if (depth < 3 && ['trak', 'mdia'].includes(type) && hasVideoTrack(cursor + 8, cursor + size, depth + 1)) return true;
      cursor += size;
    }
    return false;
  };
  if (boxes.has('ftyp') && boxes.has('moov') && mediaBytes > 0 && offset === bytes.length && hasVideoTrack(moovStart, moovEnd)) {
    if (expectedKind === 'image') throw new Error('The media server returned a video instead of the selected image.');
    return {mime: 'video/mp4', ext: 'mp4'};
  }
  if (boxes.has('moof') || boxes.has('ftyp')) throw new Error('The media server returned a video fragment, not a complete MP4.');
  throw new Error('The media server returned an error page or unsupported media instead of a file.');
  function image(mime, ext) {
    if (expectedKind === 'video') throw new Error('The media server returned a thumbnail instead of a video.');
    return {mime, ext};
  }
}
